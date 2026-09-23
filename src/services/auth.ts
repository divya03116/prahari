/**
 * Authentication service: account lifecycle and the caller's own profile.
 *
 * The profile document (users/{uid}) is the one thing a browser writes to
 * Firestore directly, and the rules pin its shape: created once at the lowest
 * role, after which only displayName and lastSeenAt may change.
 */

import {
  applyActionCode,
  checkActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPhoneNumber,
  signInWithPopup,
  RecaptchaVerifier,
  type ConfirmationResult,
  signOut as fbSignOut,
  updateProfile,
  verifyPasswordResetCode,
  type ActionCodeSettings,
  type User,
} from 'firebase/auth';
import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';

import { firebase, googleProvider, appleProvider } from '@/lib/firebase';
import { COLLECTIONS, DEFAULT_ROLE } from '@/shared/constants';

/** Where the links in verification and reset emails land. */
function actionSettings(path: string): ActionCodeSettings {
  return { url: `${window.location.origin}${path}`, handleCodeInApp: false };
}

export async function signIn(email: string, password: string): Promise<User> {
  const cred = await signInWithEmailAndPassword(firebase.auth, email.trim(), password);
  return cred.user;
}

export async function signUp(name: string, email: string, password: string): Promise<User> {
  const cred = await createUserWithEmailAndPassword(firebase.auth, email.trim(), password);
  await updateProfile(cred.user, { displayName: name.trim() });
  await ensureProfile(cred.user, name.trim());
  // The auth listener may have created the profile first, from the email
  // address alone; make sure it carries the name that was typed.
  await updateDoc(doc(firebase.db, COLLECTIONS.users, cred.user.uid), { displayName: name.trim() });
  await sendEmailVerification(cred.user, actionSettings('/signin?verified=1'));
  return cred.user;
}

export async function signInWithGoogle(): Promise<User> {
  const cred = await signInWithPopup(firebase.auth, googleProvider);
  return cred.user;
}

export async function signInWithApple(): Promise<User> {
  const cred = await signInWithPopup(firebase.auth, appleProvider);
  return cred.user;
}

/* Phone number: an SMS code, protected by an invisible reCAPTCHA. */
let verifier: RecaptchaVerifier | null = null;

export function resetPhoneVerifier(): void {
  verifier?.clear();
  verifier = null;
}

export async function sendPhoneCode(phoneNumber: string, container: HTMLElement): Promise<ConfirmationResult> {
  resetPhoneVerifier();
  // A fresh element every time: reCAPTCHA cannot render twice into one node.
  const host = document.createElement('div');
  container.replaceChildren(host);
  verifier = new RecaptchaVerifier(firebase.auth, host, { size: 'invisible' });
  try {
    return await signInWithPhoneNumber(firebase.auth, phoneNumber, verifier);
  } catch (err) {
    resetPhoneVerifier();
    throw err;
  }
}

export async function confirmPhoneCode(result: ConfirmationResult, code: string): Promise<User> {
  const cred = await result.confirm(code);
  resetPhoneVerifier();
  return cred.user;
}

export function signOut(): Promise<void> {
  return fbSignOut(firebase.auth);
}

export function resendVerification(user: User): Promise<void> {
  return sendEmailVerification(user, actionSettings('/signin?verified=1'));
}

export function requestPasswordReset(email: string): Promise<void> {
  return sendPasswordResetEmail(firebase.auth, email.trim(), actionSettings('/signin?reset=1'));
}

export const verifyResetCode = (code: string) => verifyPasswordResetCode(firebase.auth, code);
export const confirmReset = (code: string, password: string) => confirmPasswordReset(firebase.auth, code, password);
export const inspectActionCode = (code: string) => checkActionCode(firebase.auth, code);
export const applyCode = (code: string) => applyActionCode(firebase.auth, code);

/**
 * Creates users/{uid} if it does not exist yet. Runs after every sign-in, so
 * an account created in the console, by Google sign-in or by a signup that
 * lost its connection half-way still ends up with a profile.
 */
const inflight = new Map<string, Promise<void>>();

export function ensureProfile(user: User, name?: string): Promise<void> {
  // The auth listener and the signup flow both call this for a new account;
  // share one attempt so the second never tries to "create" an existing doc.
  let pending = inflight.get(user.uid);
  if (!pending) {
    pending = createProfileIfMissing(user, name).finally(() => inflight.delete(user.uid));
    inflight.set(user.uid, pending);
  }
  return pending;
}

async function createProfileIfMissing(user: User, name?: string): Promise<void> {
  const ref = doc(firebase.db, COLLECTIONS.users, user.uid);
  const snap = await getDoc(ref);
  if (snap.exists()) return;
  const displayName =
    (name || user.displayName || user.email?.split('@')[0] || user.phoneNumber || 'User').trim().slice(0, 80) || 'User';
  await setDoc(ref, {
    email: user.email ?? '',
    displayName,
    role: DEFAULT_ROLE,
    installationId: null,
    disabled: false,
    createdAt: serverTimestamp(),
    lastSeenAt: serverTimestamp(),
  });
}

export async function touchLastSeen(uid: string): Promise<void> {
  await updateDoc(doc(firebase.db, COLLECTIONS.users, uid), { lastSeenAt: serverTimestamp() });
}

export async function updateDisplayName(user: User, displayName: string): Promise<void> {
  const name = displayName.trim();
  await updateDoc(doc(firebase.db, COLLECTIONS.users, user.uid), { displayName: name });
  await updateProfile(user, { displayName: name });
}
