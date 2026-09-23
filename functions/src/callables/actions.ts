/**
 * Corrective-action service: create (manual), update, delete.
 *
 * Engine-drafted actions are opened by the scoring trigger. Officers can add
 * their own against a report, move any action through its lifecycle, and
 * reassign it. Only an administrator can delete one, and only a manual one —
 * an engine-drafted action can be cancelled but never made to disappear.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';
import { Timestamp } from 'firebase-admin/firestore';

import { audit, db, FieldValue, guard, internal, parse } from '../lib/core.js';
import { COLLECTIONS, hasRole } from '../shared/constants.js';
import { actionRefSchema, createActionSchema, updateActionSchema } from '../shared/schemas.js';

const DAY = 86_400_000;

export const createAction = onCall(async (request) => {
  const officer = await guard(request, 'hse-officer');
  const input = parse(createActionSchema, request.data);

  try {
    const report = await db.collection(COLLECTIONS.reports).doc(input.reportId).get();
    if (!report.exists) throw new HttpsError('not-found', 'That report does not exist.');
    if (report.get('archived') === true) throw new HttpsError('failed-precondition', 'The report is archived.');

    const existing = await db.collection(COLLECTIONS.actions).where('reportId', '==', input.reportId).count().get();
    const ref = db.collection(COLLECTIONS.actions).doc();
    await ref.set({
      reportId: input.reportId,
      reportedBy: report.get('reportedBy') ?? null,
      installationId: report.get('installationId'),
      installationName: report.get('installationName'),
      tier: report.get('tier') ?? 3,
      order: existing.data().count + 1,
      control: input.control,
      rationale: input.rationale,
      owner: input.owner,
      dueAt: Timestamp.fromMillis(Date.now() + input.dueInDays * DAY),
      status: 'open',
      source: 'manual',
      note: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      closedAt: null,
      closedBy: null,
    });

    await audit('action.create', officer, ref.id, { reportId: input.reportId });
    return { actionId: ref.id };
  } catch (err) {
    internal(err, { fn: 'createAction' });
  }
});

/**
 * HSE officers and administrators may change anything on any action.
 * Installation managers own delivery at their own installation: they may move
 * an action between open, in progress and closed and write a progress note,
 * but only for the installation assigned to them, and they may not reassign,
 * reschedule or cancel — those are an officer's call.
 */
export const updateAction = onCall(async (request) => {
  const officer = await guard(request, 'installation-manager');
  const input = parse(updateActionSchema, request.data);
  const scoped = !hasRole(officer.role, 'hse-officer');

  let managerInstallation: string | null = null;
  if (scoped) {
    if (input.owner !== undefined || input.dueInDays !== undefined || input.status === 'cancelled') {
      throw new HttpsError('permission-denied', 'Only an HSE officer can reassign, reschedule or cancel an action.');
    }
    const profile = await db.collection(COLLECTIONS.users).doc(officer.uid).get();
    managerInstallation = (profile.get('installationId') as string | null | undefined) ?? null;
    if (!managerInstallation) {
      throw new HttpsError('permission-denied', 'No installation is assigned to your account yet.');
    }
  }

  try {
    await db.runTransaction(async (tx) => {
      const ref = db.collection(COLLECTIONS.actions).doc(input.actionId);
      const snap = await tx.get(ref);
      if (!snap.exists) throw new HttpsError('not-found', 'That action does not exist.');
      if (scoped && snap.get('installationId') !== managerInstallation) {
        throw new HttpsError('permission-denied', 'This action belongs to a different installation.');
      }
      if (scoped && snap.get('status') === 'cancelled') {
        throw new HttpsError('permission-denied', 'A cancelled action can only be reopened by an HSE officer.');
      }

      const patch: Record<string, unknown> = { updatedAt: FieldValue.serverTimestamp() };
      const changed: Record<string, unknown> = {};

      if (input.status !== undefined && input.status !== snap.get('status')) {
        patch.status = input.status;
        changed.status = { from: snap.get('status'), to: input.status };
        if (input.status === 'closed') {
          patch.closedAt = FieldValue.serverTimestamp();
          patch.closedBy = officer.name;
        } else {
          patch.closedAt = null;
          patch.closedBy = null;
        }
      }
      if (input.owner !== undefined) {
        patch.owner = input.owner;
        changed.owner = input.owner;
      }
      if (input.dueInDays !== undefined) {
        patch.dueAt = Timestamp.fromMillis(Date.now() + input.dueInDays * DAY);
        changed.dueInDays = input.dueInDays;
      }
      if (input.note !== undefined) {
        patch.note = input.note;
        changed.note = true;
      }

      tx.update(ref, patch);
      audit('action.update', officer, ref.id, changed, tx);
    });
    return { ok: true };
  } catch (err) {
    internal(err, { fn: 'updateAction' });
  }
});

export const deleteAction = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const { actionId } = parse(actionRefSchema, request.data);

  try {
    const ref = db.collection(COLLECTIONS.actions).doc(actionId);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That action does not exist.');
    if (snap.get('source') !== 'manual') {
      throw new HttpsError(
        'failed-precondition',
        'Engine-drafted actions cannot be deleted. Cancel it instead, so the record remains.',
      );
    }
    await ref.delete();
    await audit('action.delete', admin, actionId, { control: snap.get('control') });
    return { ok: true };
  } catch (err) {
    internal(err, { fn: 'deleteAction' });
  }
});
