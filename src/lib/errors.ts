/**
 * Turns SDK error codes into sentences a person can act on.
 *
 * Callables already throw readable messages (see functions/src/lib/core.ts),
 * so for `functions/*` codes the server's message is used as-is. Auth and
 * Firestore codes are translated here. Anything unrecognised falls back to a
 * generic line — raw stack traces and internal codes are never shown.
 */

const AUTH: Record<string, string> = {
  'auth/invalid-credential': 'Email or password is incorrect.',
  'auth/invalid-login-credentials': 'Email or password is incorrect.',
  'auth/wrong-password': 'Email or password is incorrect.',
  'auth/user-not-found': 'Email or password is incorrect.',
  'auth/invalid-email': 'Enter a valid email address.',
  'auth/email-already-in-use': 'An account with this email already exists. Sign in instead.',
  'auth/weak-password': 'Choose a stronger password — at least 8 characters.',
  'auth/too-many-requests': 'Too many attempts. Wait a few minutes and try again.',
  'auth/user-disabled': 'This account has been disabled. Contact your administrator.',
  'auth/network-request-failed': 'Network error. Check your connection and try again.',
  'auth/popup-closed-by-user': 'The sign-in window was closed before finishing.',
  'auth/cancelled-popup-request': 'The sign-in window was closed before finishing.',
  'auth/popup-blocked': 'Your browser blocked the sign-in window. Allow pop-ups for this site.',
  'auth/expired-action-code': 'This link has expired. Request a new one.',
  'auth/invalid-action-code': 'This link is invalid or has already been used.',
  'auth/requires-recent-login': 'For security, sign in again before doing that.',
  'auth/account-exists-with-different-credential':
    'An account already exists with this email using a different sign-in method.',
  'auth/operation-not-allowed': 'This sign-in method is not enabled for this project.',
  'auth/unauthorized-domain': 'This domain is not authorised for sign-in in the Firebase console.',
  'auth/user-token-expired': 'Your session has expired. Sign in again.',
  'auth/invalid-phone-number': 'Enter the phone number with its country code, e.g. +91 98765 43210.',
  'auth/missing-phone-number': 'Enter your phone number.',
  'auth/invalid-verification-code': 'That code is not right. Check the SMS and try again.',
  'auth/missing-verification-code': 'Enter the 6-digit code from the SMS.',
  'auth/code-expired': 'That code has expired. Send a new one.',
  'auth/quota-exceeded': 'The SMS limit has been reached for now. Try again later or use another sign-in method.',
  'auth/captcha-check-failed': 'The security check failed. Reload the page and try again.',
  'auth/invalid-app-credential': 'The security check failed. Reload the page and try again.',
  'auth/invalid-oauth-client-id': 'Apple sign-in is not fully set up for this project yet.',
};

const FIRESTORE: Record<string, string> = {
  'permission-denied': 'You do not have access to this.',
  unavailable: 'The service is temporarily unreachable. Retrying may help.',
  'failed-precondition': 'This view needs a database index that is still building. Try again shortly.',
  'resource-exhausted': 'Too many requests. Wait a moment and try again.',
  'deadline-exceeded': 'The request took too long. Try again.',
  unauthenticated: 'Your session has expired. Sign in again.',
  'not-found': 'That record no longer exists.',
};

interface CodedError {
  code?: string;
  message?: string;
}

export function errorMessage(err: unknown, fallback = 'Something went wrong. Try again.'): string {
  if (!err || typeof err !== 'object') return fallback;
  const { code = '', message = '' } = err as CodedError;

  // No Firebase error code means a bug, not an expected failure: say so in
  // the console (the user still sees the calm fallback).
  if (!code) console.error('Unexpected error', err);

  if (code.startsWith('auth/')) return AUTH[code] ?? fallback;

  if (code.startsWith('functions/')) {
    const short = code.slice('functions/'.length);
    // The server's message is written for people; 'internal' is deliberately generic.
    if (short === 'internal') return fallback;
    if (short === 'unavailable') return FIRESTORE.unavailable;
    return message || fallback;
  }

  if (code in FIRESTORE) {
    if (code === 'failed-precondition' && /index/i.test(message)) return FIRESTORE['failed-precondition'];
    if (code === 'failed-precondition') return message || fallback;
    return FIRESTORE[code];
  }

  if (code.startsWith('storage/')) {
    if (code === 'storage/unauthorized') return 'Upload refused. Only JPEG, PNG, WebP or PDF files up to 10 MB.';
    if (code === 'storage/canceled') return 'Upload cancelled.';
    if (code === 'storage/retry-limit-exceeded') return 'Upload timed out. Check your connection.';
    if (code === 'storage/object-not-found') return 'That file no longer exists.';
    return fallback;
  }

  return fallback;
}

export function isPermissionError(err: unknown): boolean {
  const code = (err as CodedError | null)?.code ?? '';
  return code === 'permission-denied' || code === 'functions/permission-denied';
}
