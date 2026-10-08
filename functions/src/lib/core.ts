/**
 * Server core: Admin SDK handles, the request guard, validation and audit.
 *
 * Every callable goes through `guard()` and `parse()`. That is the whole
 * security model of the service layer in two functions: who you are and what
 * you may do, then whether what you sent is well-formed. Nothing reaches
 * Firestore without passing both.
 */

import './options.js';
import { initializeApp, getApps } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore, type Transaction } from 'firebase-admin/firestore';
import { getStorage } from 'firebase-admin/storage';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';
import { logger } from 'firebase-functions';
import type { ZodType } from 'zod';

import { COLLECTIONS, DEFAULT_ROLE, hasRole, type Role, TRUSTED_SIGN_IN_PROVIDERS } from '../shared/constants.js';

if (!getApps().length) initializeApp();

export const db = getFirestore();
export const auth = getAuth();
export const storage = getStorage();
export { FieldValue };

export interface Caller {
  uid: string;
  role: Role;
  name: string;
  email: string;
}

/**
 * Authenticates, enforces verified email and minimum role, and rejects
 * disabled accounts.
 *
 * The role comes from the custom claim — the same source the security rules
 * read — so the service layer and the rules can never disagree about who is
 * allowed to do what. The disabled flag is read from the profile document
 * because a disabled user's existing ID token stays valid for up to an hour.
 */
export async function guard(request: CallableRequest<unknown>, minRole: Role = DEFAULT_ROLE): Promise<Caller> {
  const token = request.auth?.token;
  if (!request.auth || !token) throw new HttpsError('unauthenticated', 'Sign in to continue.');
  const provider = String(token.firebase?.sign_in_provider ?? '');
  if (token.email_verified !== true && !(TRUSTED_SIGN_IN_PROVIDERS as readonly string[]).includes(provider)) {
    throw new HttpsError('failed-precondition', 'Verify your email address before continuing.');
  }

  const role = (token.role as Role | undefined) ?? DEFAULT_ROLE;
  if (!hasRole(role, minRole)) {
    throw new HttpsError('permission-denied', 'Your account does not have permission for that.');
  }

  const profile = await db.collection(COLLECTIONS.users).doc(request.auth.uid).get();
  if (profile.exists && profile.get('disabled') === true) {
    throw new HttpsError('permission-denied', 'This account has been disabled.');
  }

  return {
    uid: request.auth.uid,
    role,
    name: (profile.get('displayName') as string | undefined) || (token.name as string | undefined) || token.email || 'User',
    email: token.email ?? '',
  };
}

/** Validates input against a shared schema; turns failures into a readable 400. */
export function parse<T>(schema: ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    const first = result.error.issues[0];
    const where = first?.path?.length ? `${first.path.join('.')}: ` : '';
    throw new HttpsError('invalid-argument', `${where}${first?.message ?? 'Invalid input.'}`);
  }
  return result.data;
}

/**
 * Append-only audit entry. Written inside the caller's transaction when there
 * is one, so the trail and the change it records commit together or not at all.
 */
export function audit(
  action: string,
  actor: Pick<Caller, 'uid' | 'name'> | null,
  target: string | null,
  detail: Record<string, unknown> = {},
  tx?: Transaction,
): Promise<unknown> | void {
  const ref = db.collection(COLLECTIONS.auditLogs).doc();
  const data = {
    action,
    actorUid: actor?.uid ?? null,
    actorName: actor?.name ?? null,
    target,
    detail,
    at: FieldValue.serverTimestamp(),
  };
  if (tx) {
    tx.set(ref, data);
    return;
  }
  return ref.set(data);
}

/**
 * Fixed-window rate limit held in Firestore. Coarse but enough to stop a
 * runaway client or a script flooding the register, which is the realistic
 * threat for an internal tool.
 */
export async function rateLimit(uid: string, bucket: string, maxPerHour: number): Promise<void> {
  const ref = db.collection(COLLECTIONS.rateLimits).doc(`${uid}__${bucket}`);
  const hour = 60 * 60 * 1000;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const now = Date.now();
    const start = (snap.get('windowStart') as number | undefined) ?? 0;
    const count = (snap.get('count') as number | undefined) ?? 0;
    if (now - start > hour) {
      tx.set(ref, { windowStart: now, count: 1 });
      return;
    }
    if (count >= maxPerHour) {
      throw new HttpsError('resource-exhausted', 'Too many submissions in the last hour. Try again later.');
    }
    tx.update(ref, { count: count + 1 });
  });
}

/** Logs unexpected failures and converts them to a generic 500 without leaking internals. */
export function internal(err: unknown, context: Record<string, unknown>): never {
  if (err instanceof HttpsError) throw err;
  logger.error('unexpected failure', { ...context, error: String(err) });
  throw new HttpsError('internal', 'Something went wrong on the server. Try again.');
}

export const dayKey = (d: Date = new Date()): string => d.toISOString().slice(0, 10);
