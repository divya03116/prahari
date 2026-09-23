/**
 * Report service: submit, verdict, re-score, archive.
 *
 * Reports are never written directly by a browser. The rules deny it; every
 * write comes through here, where it is authenticated, validated against the
 * shared schema, rate-limited, checked against live reference data, and
 * recorded in the audit trail.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';

import { audit, db, dayKey, FieldValue, guard, internal, parse, rateLimit, storage } from '../lib/core.js';
import { bumpDaily, openEngineActions, recomputeHeat, shiftDaily } from '../lib/rollups.js';
import { COLLECTIONS, LIMITS } from '../shared/constants.js';
import {
  archiveReportSchema,
  recordVerdictSchema,
  reportRefSchema,
  submitReportSchema,
} from '../shared/schemas.js';
import { analyse, draftCapa } from '../shared/engine.js';
import { assessmentFields } from '../triggers/scoreReport.js';

async function activeReference(kind: 'installations' | 'activities', id: string) {
  const snap = await db.collection(kind).doc(id).get();
  if (!snap.exists || snap.get('active') !== true) {
    throw new HttpsError(
      'failed-precondition',
      kind === 'installations' ? 'That installation is not available.' : 'That activity is not available.',
    );
  }
  return String(snap.get('name'));
}

/**
 * Files are uploaded by the browser before the callable runs. Trust none of
 * the metadata it sent: confirm each object lives under the caller's own
 * prefix, exists, and take its size and type from Storage itself.
 */
export async function verifyUploads(
  prefix: string,
  list: { path: string; name: string }[],
): Promise<{ path: string; name: string; size: number; contentType: string }[]> {
  const bucket = storage.bucket();
  const out = [];
  for (const a of list) {
    if (!a.path.startsWith(prefix) || a.path.includes('..')) {
      throw new HttpsError('permission-denied', 'An attachment is outside your upload area.');
    }
    const file = bucket.file(a.path);
    const [exists] = await file.exists();
    if (!exists) throw new HttpsError('failed-precondition', `Attachment "${a.name}" did not finish uploading.`);
    const [meta] = await file.getMetadata();
    const size = Number(meta.size ?? 0);
    const contentType = String(meta.contentType ?? '');
    if (size > LIMITS.attachmentBytesMax || !LIMITS.attachmentTypes.includes(contentType)) {
      throw new HttpsError('invalid-argument', `Attachment "${a.name}" is not an accepted file.`);
    }
    out.push({ path: a.path, name: a.name, size, contentType });
  }
  return out;
}

/* ------------------------------------------------------------------ */

export const submitReport = onCall(async (request) => {
  const caller = await guard(request);
  const input = parse(submitReportSchema, request.data);
  await rateLimit(caller.uid, 'submit', LIMITS.submitRatePerHour);

  try {
    const [installationName, activityName] = await Promise.all([
      activeReference('installations', input.installationId),
      input.activityId ? activeReference('activities', input.activityId) : Promise.resolve('Not specified'),
    ]);

    const ref = db.collection(COLLECTIONS.reports).doc(input.reportId);
    if ((await ref.get()).exists) throw new HttpsError('already-exists', 'This report was already filed.');

    const attachments = await verifyUploads(`attachments/${caller.uid}/${input.reportId}/`, input.attachments);
    if (input.source === 'photo' && !attachments.some((a) => a.contentType.startsWith('image/'))) {
      throw new HttpsError('invalid-argument', 'A photo report needs its photo.');
    }

    await ref.set({
      text: input.text,
      installationId: input.installationId,
      installationName,
      activityId: input.activityId ?? null,
      activityName,
      shift: input.shift,
      type: input.type,
      contractor: input.contractor,
      attachments,
      source: input.source,
      geo: input.geo,
      photoCheck: input.source === 'photo' ? input.photoCheck : null,
      status: 'pending',
      // A uid only. Scores attach to installations and activities, never to a
      // named person — blame is what kills a reporting culture.
      reportedBy: caller.uid,
      archived: false,
      verdictDecision: null,
      createdAt: FieldValue.serverTimestamp(),
    });

    await audit('report.submit', caller, ref.id, { installationId: input.installationId });
    return { reportId: ref.id };
  } catch (err) {
    internal(err, { fn: 'submitReport', uid: caller.uid });
  }
});

/* ------------------------------------------------------------------ */

/**
 * A human decides. Each verdict also appends a training label: the narrative,
 * the prediction and the judgement — worth having only because the prediction
 * was produced server-side and could not have been edited by the labeller.
 */
export const recordVerdict = onCall(async (request) => {
  const officer = await guard(request, 'hse-officer');
  const input = parse(recordVerdictSchema, request.data);

  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection(COLLECTIONS.reports).doc(input.reportId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'That report does not exist.');
      if (snap.get('status') !== 'scored') {
        throw new HttpsError('failed-precondition', 'The report has not been assessed yet.');
      }
      if (snap.get('archived') === true) throw new HttpsError('failed-precondition', 'The report is archived.');

      tx.update(ref, {
        // Flat copy of the decision, so "awaiting review" is a plain equality
        // query (verdictDecision == null) instead of a scan for a missing map.
        verdictDecision: input.decision,
        verdict: {
          decision: input.decision,
          note: input.note,
          officerUid: officer.uid,
          officerName: officer.name,
          at: Timestamp.now(),
        },
      });
      tx.set(db.collection(COLLECTIONS.labels).doc(), {
        reportId: ref.id,
        text: snap.get('text'),
        predictedScore: snap.get('score') ?? null,
        predictedTier: snap.get('tier') ?? null,
        humanLabel: input.decision,
        engineVersion: snap.get('engineVersion') ?? null,
        modelVersion: snap.get('modelVersion') ?? null,
        officerUid: officer.uid,
        createdAt: FieldValue.serverTimestamp(),
      });
      audit('report.verdict', officer, ref.id, { decision: input.decision }, tx);
    });
    return { ok: true };
  } catch (err) {
    internal(err, { fn: 'recordVerdict' });
  }
});

/* ------------------------------------------------------------------ */

/** Re-runs the current engine over a stored narrative and keeps the daily totals honest. */
export const rescoreReport = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const { reportId } = parse(reportRefSchema, request.data);

  try {
    const ref = db.collection(COLLECTIONS.reports).doc(reportId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That report does not exist.');

    const r = snap.data()!;
    if (r.archived === true) throw new HttpsError('failed-precondition', 'The report is archived.');
    const result = analyse(String(r.text ?? ''));
    const capa = draftCapa(result, { installation: r.installationName });
    const wasScored = r.status === 'scored';
    const previousTier = r.tier as number | undefined;
    const created: Date = r.createdAt?.toDate?.() ?? new Date();
    const day = dayKey(created);

    const batch = db.batch();
    batch.update(ref, assessmentFields(result, capa, `${r.text} ${r.installationName} ${r.activityName ?? ''}`, r));
    if (wasScored && previousTier) {
      shiftDaily(batch, day, previousTier, result.tier);
    } else {
      // A report that failed or never finished scoring is counted now, and
      // gets the actions it would have opened in the first place.
      bumpDaily(batch, day, result.tier, 1);
      const existing = await db.collection(COLLECTIONS.actions).where('reportId', '==', reportId).limit(1).get();
      if (result.tier <= 2 && existing.empty) {
        openEngineActions(batch, {
          reportId,
          reportedBy: typeof r.reportedBy === 'string' ? r.reportedBy : null,
          installationId: String(r.installationId ?? ''),
          installationName: String(r.installationName ?? ''),
          tier: result.tier,
          capa,
          created,
        });
      }
    }
    await batch.commit();
    // Peak may have gone down as well as up; rebuild that installation-day.
    await recomputeHeat(String(r.installationId ?? ''), String(r.installationName ?? ''), day);

    await audit('report.rescore', admin, reportId, {
      from: r.score ?? null,
      to: result.score,
      engineVersion: result.engineVersion,
    });
    return { ok: true, score: result.score, tier: result.tier };
  } catch (err) {
    internal(err, { fn: 'rescoreReport' });
  }
});

/* ------------------------------------------------------------------ */

/**
 * Archive, never delete. A safety register whose entries can be erased cannot
 * be trusted in an investigation. Archived reports leave the working queue and
 * their open actions are cancelled, but the record and its trail remain.
 */
export const archiveReport = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const input = parse(archiveReportSchema, request.data);

  try {
    const ref = db.collection(COLLECTIONS.reports).doc(input.reportId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That report does not exist.');
    if (snap.get('archived') === true) throw new HttpsError('failed-precondition', 'Already archived.');

    const open = await db
      .collection(COLLECTIONS.actions)
      .where('reportId', '==', input.reportId)
      .where('status', 'in', ['open', 'in_progress'])
      .get();

    const batch = db.batch();
    batch.update(ref, {
      archived: true,
      archivedAt: FieldValue.serverTimestamp(),
      archivedBy: admin.uid,
      archiveReason: input.reason,
    });
    open.docs.forEach((d) =>
      batch.update(d.ref, { status: 'cancelled', updatedAt: FieldValue.serverTimestamp(), note: 'Report archived' }),
    );
    // Archived reports leave the dashboard totals and the heat map too.
    const scored = snap.get('status') === 'scored' && typeof snap.get('tier') === 'number';
    const created: Date = snap.get('createdAt')?.toDate?.() ?? new Date();
    const day = dayKey(created);
    if (scored) bumpDaily(batch, day, snap.get('tier') as number, -1);
    await batch.commit();
    if (scored) {
      await recomputeHeat(String(snap.get('installationId') ?? ''), String(snap.get('installationName') ?? ''), day);
    }

    await audit('report.archive', admin, input.reportId, { reason: input.reason, actionsCancelled: open.size });
    return { ok: true, actionsCancelled: open.size };
  } catch (err) {
    internal(err, { fn: 'archiveReport' });
  }
});
