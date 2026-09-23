/**
 * Automatic incidents from camera PPE detection, and worker statements that
 * attach to an existing incident.
 *
 * A camera incident becomes a normal report (source 'camera'), so it is
 * scored, gets corrective actions, appears in the register and can be
 * reviewed like any other. De-duplication is enforced here, not only in the
 * browser: one incident per camera and PPE type per cooldown window, however
 * many browser tabs are watching.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';

import { audit, db, FieldValue, guard, internal, parse, rateLimit } from '../lib/core.js';
import { COLLECTIONS } from '../shared/constants.js';
import { describeHazard, HAZARDS } from '../shared/hazards.js';
import { PPE_LABEL, type PpeType } from '../shared/ppe.js';
import { hazardIncidentSchema, ppeIncidentSchema, statementSchema } from '../shared/schemas.js';
import { verifyUploads } from './reports.js';

const COOLDOWNS = 'ppeCooldowns';
const MAX_STATEMENTS = 20;

/** Day shift 06:00–18:00 at the site's clock (India Standard Time). */
function shiftAt(date: Date): 'Day' | 'Night' {
  const hour = Number(new Intl.DateTimeFormat('en-GB', { hour: 'numeric', hour12: false, timeZone: 'Asia/Kolkata' }).format(date));
  return hour >= 6 && hour < 18 ? 'Day' : 'Night';
}

/** A factual description of what was detected — no more, no less. */
function describe(input: ReturnType<typeof ppeIncidentSchema.parse>, types: PpeType[]): string {
  const missing = types.map((t) => PPE_LABEL[t].toLowerCase()).join(' and ');
  const workers = new Set(input.violations.filter((v) => types.includes(v.type)).map((v) => v.trackId)).size;
  const longest = Math.max(...input.violations.filter((v) => types.includes(v.type)).map((v) => v.seconds));
  const frames = Math.max(...input.violations.filter((v) => types.includes(v.type)).map((v) => v.frames));
  return (
    `Camera "${input.camera.label}" detected ${workers === 1 ? 'a worker' : `${workers} workers`} without the required ${missing}. ` +
    `Confirmed over ${frames} consecutive frames (${longest.toFixed(1)} s) by the ${input.model.name} model ` +
    `(${input.model.architecture}, minimum confidence ${input.settings.minConfidence}).`
  );
}

export const createPpeIncident = onCall(async (request) => {
  const caller = await guard(request);
  const input = parse(ppeIncidentSchema, request.data);
  await rateLimit(caller.uid, 'ppe', 120);

  try {
    const inst = await db.collection(COLLECTIONS.installations).doc(input.installationId).get();
    if (!inst.exists || inst.get('active') !== true) {
      throw new HttpsError('failed-precondition', 'That installation is not available.');
    }
    const ref = db.collection(COLLECTIONS.reports).doc(input.reportId);
    const [evidence] = await verifyUploads(`attachments/${caller.uid}/${input.reportId}/`, [input.evidence]);
    if (!evidence.contentType.startsWith('image/')) {
      throw new HttpsError('invalid-argument', 'Evidence must be an image.');
    }

    const now = Timestamp.now();
    const cooldownMs = input.settings.incidentCooldownSeconds * 1000;
    const types = [...new Set(input.violations.map((v) => v.type))];

    const result = await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) throw new HttpsError('already-exists', 'This incident was already filed.');
      const cooldownRefs = types.map((t) => db.collection(COOLDOWNS).doc(`${input.camera.id}__${t}`));
      const snaps = await Promise.all(cooldownRefs.map((r) => tx.get(r)));
      const fresh = types.filter((t, i) => {
        const last = snaps[i].get('lastAt') as Timestamp | undefined;
        return !last || now.toMillis() - last.toMillis() >= cooldownMs;
      });
      const duplicateOf = snaps.find((s) => s.exists)?.get('reportId') as string | undefined;
      if (!fresh.length) return { deduplicated: true as const, reportId: duplicateOf ?? null };

      fresh.forEach((t) => {
        tx.set(db.collection(COOLDOWNS).doc(`${input.camera.id}__${t}`), {
          cameraId: input.camera.id,
          type: t,
          lastAt: now,
          reportId: ref.id,
        });
      });
      tx.set(ref, {
        text: describe(input, fresh),
        installationId: input.installationId,
        installationName: String(inst.get('name')),
        activityId: null,
        activityName: 'Not specified',
        shift: shiftAt(now.toDate()),
        type: 'unsafe-act',
        contractor: false,
        attachments: [evidence],
        source: 'camera',
        geo: input.geo,
        camera: input.camera,
        ppe: {
          violations: input.violations.filter((v) => fresh.includes(v.type)),
          workers: input.workers,
          required: input.required,
          frame: input.frame,
          evidencePath: evidence.path,
          model: input.model,
          settings: input.settings,
          detectedAt: now,
        },
        status: 'pending',
        reportedBy: caller.uid,
        archived: false,
        verdictDecision: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      audit('incident.ppe', caller, ref.id, { camera: input.camera.id, types: fresh }, tx);
      return { deduplicated: false as const, reportId: ref.id, types: fresh };
    });
    return result;
  } catch (err) {
    internal(err, { fn: 'createPpeIncident', uid: caller.uid });
  }
});

/**
 * A confirmed camera hazard — unsafe act, unsafe condition or near miss — as a
 * report of that type. Same guarantees as PPE incidents: the evidence frame is
 * verified in Storage, and one incident per camera and hazard (per zone for
 * zone rules) per cooldown window, enforced in a transaction.
 */
export const createHazardIncident = onCall(async (request) => {
  const caller = await guard(request);
  const input = parse(hazardIncidentSchema, request.data);
  await rateLimit(caller.uid, 'hazard', 120);

  try {
    const inst = await db.collection(COLLECTIONS.installations).doc(input.installationId).get();
    if (!inst.exists || inst.get('active') !== true) {
      throw new HttpsError('failed-precondition', 'That installation is not available.');
    }
    const ref = db.collection(COLLECTIONS.reports).doc(input.reportId);
    const [evidence] = await verifyUploads(`attachments/${caller.uid}/${input.reportId}/`, [input.evidence]);
    if (!evidence.contentType.startsWith('image/')) {
      throw new HttpsError('invalid-argument', 'Evidence must be an image.');
    }

    const now = Timestamp.now();
    const e = input.event;
    const cooldownRef = db.collection(COOLDOWNS).doc(`${input.camera.id}__${e.key}`);
    const models = input.models.map((m) => `the ${m.name} model`).join(' and ');

    return await db.runTransaction(async (tx) => {
      if ((await tx.get(ref)).exists) throw new HttpsError('already-exists', 'This incident was already filed.');
      const last = await tx.get(cooldownRef);
      const lastAt = last.get('lastAt') as Timestamp | undefined;
      if (lastAt && now.toMillis() - lastAt.toMillis() < input.settings.incidentCooldownSeconds * 1000) {
        return { deduplicated: true as const, reportId: (last.get('reportId') as string | undefined) ?? null };
      }
      tx.set(cooldownRef, { cameraId: input.camera.id, type: e.key, lastAt: now, reportId: ref.id });
      tx.set(ref, {
        text: describeHazard(e, input.camera.label, models),
        installationId: input.installationId,
        installationName: String(inst.get('name')),
        activityId: null,
        activityName: 'Not specified',
        shift: shiftAt(now.toDate()),
        type: HAZARDS[e.type].kind,
        contractor: false,
        attachments: [evidence],
        source: 'camera',
        geo: input.geo,
        camera: input.camera,
        hazard: {
          ...e,
          frame: input.frame,
          evidencePath: evidence.path,
          models: input.models,
          settings: input.settings,
          detectedAt: now,
        },
        status: 'pending',
        reportedBy: caller.uid,
        archived: false,
        verdictDecision: null,
        createdAt: FieldValue.serverTimestamp(),
      });
      audit('incident.hazard', caller, ref.id, { camera: input.camera.id, hazard: e.key }, tx);
      return { deduplicated: false as const, reportId: ref.id, type: e.type };
    });
  } catch (err) {
    internal(err, { fn: 'createHazardIncident', uid: caller.uid });
  }
});

export const addStatement = onCall(async (request) => {
  const caller = await guard(request);
  const input = parse(statementSchema, request.data);
  await rateLimit(caller.uid, 'statement', 60);

  try {
    const id = db.collection('_').doc().id;
    await db.runTransaction(async (tx) => {
      const ref = db.collection(COLLECTIONS.reports).doc(input.reportId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'That incident does not exist.');
      if (snap.get('archived') === true) throw new HttpsError('failed-precondition', 'The incident is archived.');
      const existing = (snap.get('statements') as unknown[] | undefined) ?? [];
      if (existing.length >= MAX_STATEMENTS) {
        throw new HttpsError('resource-exhausted', `An incident can hold at most ${MAX_STATEMENTS} statements.`);
      }
      tx.update(ref, {
        statements: FieldValue.arrayUnion({ id, text: input.text, source: input.source, by: caller.uid, at: Timestamp.now() }),
      });
      audit('report.statement', caller, ref.id, { source: input.source }, tx);
    });
    return { ok: true, id };
  } catch (err) {
    internal(err, { fn: 'addStatement' });
  }
});
