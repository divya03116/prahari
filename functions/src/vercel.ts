/**
 * The same service layer behind a plain HTTPS endpoint.
 *
 * On Firebase these callables are deployed as Cloud Functions, which needs the
 * Blaze plan. This module lets the identical handlers run wherever Node runs —
 * in this project as a Vercel function at /api/fn/<name> (see api/fn/[name].js)
 * — by speaking the callable protocol the web SDK already uses:
 *
 *   POST {"data": …}   Authorization: Bearer <the caller's Firebase ID token>
 *   200  {"result": …}        or        4xx/5xx {"error": {status, message}}
 *
 * Nothing about authorisation changes. Every handler still goes through
 * guard() and parse() (lib/core.ts), the ID token is verified here exactly as
 * the Functions runtime verifies it, and the browser still cannot write to the
 * register itself.
 *
 * One thing differs. Firestore triggers exist only on Firebase, so a report is
 * scored in the same request that files it, by running the very same trigger
 * handler. Scheduled jobs (the orphan-attachment sweep) do not run here.
 */

import { getApp } from 'firebase-admin/app';
import { logger } from 'firebase-functions';
import { HttpsError, type CallableRequest } from 'firebase-functions/v2/https';

import './lib/options.js';
import { auth, credentialProblem, db } from './lib/core.js';
import { createAction, deleteAction, updateAction } from './callables/actions.js';
import { getAlertSettings, sendTestAlert, setAlertSettings } from './callables/alerts.js';
import { addStatement, createHazardIncident, createPpeIncident } from './callables/incidents.js';
import { deleteReference, upsertReference } from './callables/reference.js';
import { archiveReport, recordVerdict, rescoreReport, submitReport } from './callables/reports.js';
import { claimFirstAdmin, deleteUser, setUserDisabled, setUserInstallation, setUserRole } from './callables/users.js';
import { COLLECTIONS } from './shared/constants.js';
import { scoreReport } from './triggers/scoreReport.js';

type Runnable = { run(request: CallableRequest<unknown>): unknown };

/** Exactly the callables functions/src/index.ts exports — nothing else is reachable. */
const CALLABLES: Record<string, Runnable> = {
  submitReport,
  recordVerdict,
  rescoreReport,
  archiveReport,
  createAction,
  updateAction,
  deleteAction,
  setUserRole,
  setUserDisabled,
  setUserInstallation,
  deleteUser,
  claimFirstAdmin,
  upsertReference,
  deleteReference,
  createPpeIncident,
  createHazardIncident,
  addStatement,
  getAlertSettings,
  setAlertSettings,
  sendTestAlert,
};

/** Callables that file a new report, which then has to be scored. */
const FILES_A_REPORT = new Set(['submitReport', 'createPpeIncident', 'createHazardIncident']);

export interface HttpRequest {
  method?: string;
  headers: Record<string, string | string[] | undefined>;
  /** The parsed JSON body. */
  body?: unknown;
}

export interface HttpReply {
  status: number;
  body: { result: unknown } | { error: { status: string; message: string; details?: unknown } };
}

const refuse = (status: number, code: string, message: string): HttpReply => ({ status, body: { error: { status: code, message } } });

/** Off Firebase there is no built-in identity: without the key nothing can be read or written. */
function setupProblem(): string | null {
  if (credentialProblem) return credentialProblem;
  return process.env.VERCEL && !process.env.FIREBASE_SERVICE_ACCOUNT ? 'FIREBASE_SERVICE_ACCOUNT is not set.' : null;
}

/**
 * GET /api/health — whether this deployment can act for the project. It asks
 * Google for an access token with the key (cached for the hour it lasts), so
 * it costs no database reads and says nothing that is not already public.
 */
export async function health(): Promise<{ status: number; body: { ok: boolean; problem?: string } }> {
  const problem = setupProblem();
  if (problem) return { status: 503, body: { ok: false, problem } };
  try {
    await getApp().options.credential?.getAccessToken();
    return { status: 200, body: { ok: true } };
  } catch (err) {
    logger.error('the service-account key was refused', { error: String(err) });
    return { status: 503, body: { ok: false, problem: 'Google did not accept the key in FIREBASE_SERVICE_ACCOUNT.' } };
  }
}

/** Scores the report a callable has just filed — what the Firestore trigger does on Firebase. */
async function scoreNow(result: unknown): Promise<void> {
  const { reportId, deduplicated } = (result ?? {}) as { reportId?: string | null; deduplicated?: boolean };
  if (!reportId || deduplicated) return;
  const snap = await db.collection(COLLECTIONS.reports).doc(reportId).get();
  if (!snap.exists || snap.get('status') !== 'pending') return;
  // scoreReport never throws: a report it cannot assess is marked 'failed'.
  await (scoreReport as unknown as { run(event: unknown): Promise<unknown> }).run({ data: snap, params: { reportId } });
}

export async function callFunction(name: string, req: HttpRequest): Promise<HttpReply> {
  const fn = Object.hasOwn(CALLABLES, name) ? CALLABLES[name] : undefined;
  if (!fn) return refuse(404, 'NOT_FOUND', 'No such function.');
  if (req.method !== 'POST') return refuse(405, 'INVALID_ARGUMENT', 'Use POST.');
  const body = req.body;
  if (!body || typeof body !== 'object' || !('data' in body)) return refuse(400, 'INVALID_ARGUMENT', 'Bad Request');

  // 'unavailable' is what the app treats as "try again later": a report filed
  // meanwhile waits on the device and is sent once the server is set up.
  const problem = setupProblem();
  if (problem) return refuse(503, 'UNAVAILABLE', `The server is not set up yet. ${problem}`);

  let caller: CallableRequest<unknown>['auth'];
  const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ''));
  if (bearer) {
    try {
      const token = await auth.verifyIdToken(bearer[1]);
      caller = { uid: token.uid, token, rawToken: bearer[1] };
    } catch {
      return refuse(401, 'UNAUTHENTICATED', 'Unauthenticated');
    }
  }

  try {
    const result = await fn.run({
      data: (body as { data: unknown }).data,
      auth: caller,
      rawRequest: req as never,
      acceptsStreaming: false,
    });
    if (FILES_A_REPORT.has(name)) await scoreNow(result);
    return { status: 200, body: { result: result ?? null } };
  } catch (err) {
    if (err instanceof HttpsError) return { status: err.httpErrorCode.status, body: { error: err.toJSON() } };
    logger.error('unexpected failure', { fn: name, error: String(err) });
    return refuse(500, 'INTERNAL', 'INTERNAL');
  }
}
