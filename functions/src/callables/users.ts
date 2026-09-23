/**
 * User administration: role, enable/disable, installation, delete.
 *
 * Role changes write BOTH the Auth custom claim and the Firestore profile. The
 * security rules read the claim; the UI reads the profile. Writing them in one
 * place is what stops the two ever drifting apart.
 */

import { defineString } from 'firebase-functions/params';
import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { audit, auth, db, guard, internal, parse, type Caller } from '../lib/core.js';
import { COLLECTIONS } from '../shared/constants.js';
import {
  setUserDisabledSchema,
  setUserInstallationSchema,
  setUserRoleSchema,
  userRefSchema,
} from '../shared/schemas.js';

/** An administrator must never be able to lock themselves out. */
function notSelf(caller: Caller, uid: string, what: string): void {
  if (caller.uid === uid) throw new HttpsError('failed-precondition', `You cannot ${what} your own account.`);
}

async function mustExist(uid: string): Promise<void> {
  try {
    await auth.getUser(uid);
  } catch {
    throw new HttpsError('not-found', 'That user does not exist.');
  }
}

export const setUserRole = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const { uid, role } = parse(setUserRoleSchema, request.data);
  notSelf(admin, uid, 'change the role of');

  try {
    await mustExist(uid);
    const existing = (await auth.getUser(uid)).customClaims ?? {};
    await auth.setCustomUserClaims(uid, { ...existing, role });
    await db.collection(COLLECTIONS.users).doc(uid).set({ role }, { merge: true });
    // Force the next token refresh so the new role takes effect promptly.
    await auth.revokeRefreshTokens(uid);
    await audit('user.role', admin, uid, { role });
    return { ok: true };
  } catch (err) {
    internal(err, { fn: 'setUserRole' });
  }
});

export const setUserDisabled = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const { uid, disabled } = parse(setUserDisabledSchema, request.data);
  notSelf(admin, uid, disabled ? 'disable' : 'enable');

  try {
    await mustExist(uid);
    await auth.updateUser(uid, { disabled });
    if (disabled) await auth.revokeRefreshTokens(uid);
    await db.collection(COLLECTIONS.users).doc(uid).set({ disabled }, { merge: true });
    await audit(disabled ? 'user.disable' : 'user.enable', admin, uid);
    return { ok: true };
  } catch (err) {
    internal(err, { fn: 'setUserDisabled' });
  }
});

export const setUserInstallation = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const { uid, installationId } = parse(setUserInstallationSchema, request.data);

  try {
    await mustExist(uid);
    if (installationId) {
      const inst = await db.collection(COLLECTIONS.installations).doc(installationId).get();
      if (!inst.exists) throw new HttpsError('not-found', 'That installation does not exist.');
    }
    await db.collection(COLLECTIONS.users).doc(uid).set({ installationId }, { merge: true });
    await audit('user.installation', admin, uid, { installationId });
    return { ok: true };
  } catch (err) {
    internal(err, { fn: 'setUserInstallation' });
  }
});

/**
 * Deletes the account and its profile. Reports the person filed are kept —
 * they reference a uid, never a name, so the register stays intact and no
 * longer points at anyone identifiable.
 */
export const deleteUser = onCall(async (request) => {
  const admin = await guard(request, 'admin');
  const { uid } = parse(userRefSchema, request.data);
  notSelf(admin, uid, 'delete');

  try {
    await mustExist(uid);
    const profile = await db.collection(COLLECTIONS.users).doc(uid).get();
    await auth.deleteUser(uid);
    await db.collection(COLLECTIONS.users).doc(uid).delete();
    await audit('user.delete', admin, uid, { email: profile.get('email') ?? null });
    return { ok: true };
  } catch (err) {
    internal(err, { fn: 'deleteUser' });
  }
});

/**
 * First administrator of a fresh project. Roles are granted only by an
 * administrator, so a new project needs one person promoted once. This works
 * only for the address in BOOTSTRAP_ADMIN_EMAIL (functions/.env.<project-id>,
 * set at deploy time), only once (a lock document records the claim) and only
 * while no administrator exists. After that it refuses everyone.
 */
const BOOTSTRAP_ADMIN_EMAIL = defineString('BOOTSTRAP_ADMIN_EMAIL', { default: '' });

export const claimFirstAdmin = onCall(async (request) => {
  const caller = await guard(request);
  const wanted = BOOTSTRAP_ADMIN_EMAIL.value().trim().toLowerCase();
  if (!wanted || caller.email.toLowerCase() !== wanted) {
    throw new HttpsError('permission-denied', 'This account is not the configured first administrator.');
  }
  try {
    await db.runTransaction(async (tx) => {
      const lock = db.collection('meta').doc('bootstrap');
      const admins = await tx.get(db.collection(COLLECTIONS.users).where('role', '==', 'admin').limit(1));
      if ((await tx.get(lock)).exists || !admins.empty) {
        throw new HttpsError('failed-precondition', 'An administrator already exists.');
      }
      tx.create(lock, { uid: caller.uid, email: caller.email, at: new Date() });
      tx.set(db.collection(COLLECTIONS.users).doc(caller.uid), { role: 'admin' }, { merge: true });
    });
    const existing = (await auth.getUser(caller.uid)).customClaims ?? {};
    await auth.setCustomUserClaims(caller.uid, { ...existing, role: 'admin' });
    await audit('user.role', caller, caller.uid, { role: 'admin', bootstrap: true });
    return { ok: true };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    internal(err, { fn: 'claimFirstAdmin' });
  }
});
