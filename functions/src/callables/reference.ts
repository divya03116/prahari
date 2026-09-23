/**
 * Reference data: installations and activities.
 *
 * These were hard-coded constants in the previous build. They are now real
 * documents an administrator manages, which is what lets a new rig or a new
 * activity type exist without a deploy.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { audit, db, FieldValue, guard, internal, parse } from '../lib/core.js';
import { COLLECTIONS } from '../shared/constants.js';
import { deleteReferenceSchema, upsertReferenceSchema } from '../shared/schemas.js';

export const upsertReference = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const { kind, id, ...fields } = parse(upsertReferenceSchema, request.data);

  try {
    const col = db.collection(kind);

    // Names are the thing people pick from a dropdown, so they must be unique.
    const clash = await col.where('name', '==', fields.name).limit(2).get();
    if (clash.docs.some((d) => d.id !== id)) {
      throw new HttpsError('already-exists', `"${fields.name}" already exists.`);
    }

    if (id) {
      const ref = col.doc(id);
      if (!(await ref.get()).exists) throw new HttpsError('not-found', 'That record does not exist.');
      await ref.update({ ...fields, updatedAt: FieldValue.serverTimestamp() });
      await audit(`${kind}.update`, admin, id, { name: fields.name, active: fields.active });
      return { id };
    }

    const ref = col.doc();
    await ref.set({
      ...fields,
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
    });
    await audit(`${kind}.create`, admin, ref.id, { name: fields.name });
    return { id: ref.id };
  } catch (err) {
    internal(err, { fn: 'upsertReference', kind });
  }
});

/**
 * Deletion is refused while reports still point at the record — otherwise the
 * register would show reports against an installation that no longer exists.
 * Deactivating removes it from pickers while keeping history intact.
 */
export const deleteReference = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const { kind, id } = parse(deleteReferenceSchema, request.data);

  try {
    const ref = db.collection(kind).doc(id);
    const snap = await ref.get();
    if (!snap.exists) throw new HttpsError('not-found', 'That record does not exist.');

    const field = kind === 'installations' ? 'installationId' : 'activityId';
    const inUse = await db.collection(COLLECTIONS.reports).where(field, '==', id).limit(1).count().get();
    if (inUse.data().count > 0) {
      throw new HttpsError(
        'failed-precondition',
        `"${snap.get('name')}" is referenced by existing reports. Deactivate it instead.`,
      );
    }

    await ref.delete();
    await audit(`${kind}.delete`, admin, id, { name: snap.get('name') });
    return { ok: true };
  } catch (err) {
    internal(err, { fn: 'deleteReference', kind });
  }
});
