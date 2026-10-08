/**
 * Turns SDK error codes into sentences a person can act on.
 *
 * Callables already throw readable messages (see functions/src/lib/core.ts),
 * so for `functions/*` codes the server's message is used as-is. Auth and
 * Firestore codes are translated here. Anything unrecognised falls back to a
 * generic line — raw stack traces and internal codes are never shown. The
 * sentences are in the interface language; the server's own are in English.
 */

import { translate, type MessageKey } from '@/i18n';

const AUTH: Record<string, MessageKey> = {
  'auth/invalid-credential': 'err.credentials',
  'auth/invalid-login-credentials': 'err.credentials',
  'auth/wrong-password': 'err.credentials',
  'auth/user-not-found': 'err.credentials',
  'auth/invalid-email': 'err.invalidEmail',
  'auth/email-already-in-use': 'err.emailInUse',
  'auth/weak-password': 'err.weakPassword',
  'auth/too-many-requests': 'err.tooManyAttempts',
  'auth/user-disabled': 'err.userDisabled',
  'auth/network-request-failed': 'err.network',
  'auth/popup-closed-by-user': 'err.popupClosed',
  'auth/cancelled-popup-request': 'err.popupClosed',
  'auth/popup-blocked': 'err.popupBlocked',
  'auth/expired-action-code': 'err.linkExpired',
  'auth/invalid-action-code': 'err.linkInvalid',
  'auth/requires-recent-login': 'err.recentLogin',
  'auth/account-exists-with-different-credential':
    'err.differentMethod',
  'auth/operation-not-allowed': 'err.methodNotEnabled',
  'auth/unauthorized-domain': 'err.domainNotAuthorised',
  'auth/user-token-expired': 'err.sessionExpired',
  'auth/invalid-phone-number': 'err.phoneInvalid',
  'auth/missing-phone-number': 'err.phoneMissing',
  'auth/invalid-verification-code': 'err.codeWrong',
  'auth/missing-verification-code': 'err.codeMissing',
  'auth/code-expired': 'err.codeExpired',
  'auth/quota-exceeded': 'err.smsQuota',
  'auth/captcha-check-failed': 'err.securityCheck',
  'auth/invalid-app-credential': 'err.securityCheck',
  'auth/invalid-oauth-client-id': 'err.appleNotSetUp',
};

const FIRESTORE: Record<string, MessageKey> = {
  'permission-denied': 'err.noAccess',
  unavailable: 'err.unavailable',
  'failed-precondition': 'err.indexBuilding',
  'resource-exhausted': 'err.tooManyRequests',
  'deadline-exceeded': 'err.tookTooLong',
  unauthenticated: 'err.sessionExpired',
  'not-found': 'err.notFound',
};

interface CodedError {
  code?: string;
  message?: string;
}

export function errorMessage(err: unknown, fallback = translate('err.fallback')): string {
  if (!err || typeof err !== 'object') return fallback;
  const { code = '', message = '' } = err as CodedError;

  // No Firebase error code means a bug, not an expected failure: say so in
  // the console (the user still sees the calm fallback).
  if (!code) console.error('Unexpected error', err);

  if (code.startsWith('auth/')) return code in AUTH ? translate(AUTH[code]) : fallback;

  if (code.startsWith('functions/')) {
    const short = code.slice('functions/'.length);
    // The server's message is written for people; 'internal' is deliberately generic.
    // A bare "internal [0]" comes from the SDK itself: no usable reply at all
    // (offline, or the server functions are not deployed), so say that instead.
    if (short === 'internal') return /^internal(?: \[0\])?$/.test(message) ? translate('err.unreachable') : fallback;
    if (short === 'unavailable') return translate(FIRESTORE.unavailable);
    return message || fallback;
  }

  if (code in FIRESTORE) {
    if (code === 'failed-precondition' && /index/i.test(message)) return translate(FIRESTORE['failed-precondition']);
    if (code === 'failed-precondition') return message || fallback;
    return translate(FIRESTORE[code]);
  }

  if (code.startsWith('storage/')) {
    if (code === 'storage/unauthorized') return translate('err.uploadRefused');
    if (code === 'storage/canceled') return translate('err.uploadCancelled');
    if (code === 'storage/retry-limit-exceeded') return translate('err.uploadTimedOut');
    if (code === 'storage/object-not-found') return translate('err.fileGone');
    return fallback;
  }

  return fallback;
}

export function isPermissionError(err: unknown): boolean {
  const code = (err as CodedError | null)?.code ?? '';
  return code === 'permission-denied' || code === 'functions/permission-denied';
}
