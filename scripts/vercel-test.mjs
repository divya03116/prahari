#!/usr/bin/env node
/**
 * Tests the Vercel server route end to end — `npm run test:vercel`.
 *
 * The real functions in api/ are served on this machine (scripts/vercel-local.mjs)
 * and called twice over: with plain HTTP, and with the Firebase web SDK exactly
 * as the browser calls them. The Admin SDK is set up the way it is on Vercel —
 * from a service-account key in FIREBASE_SERVICE_ACCOUNT, with no Firebase
 * runtime around it — except that the key is generated here, is worth nothing,
 * and everything talks to the Auth and Firestore emulators.
 *
 * The npm script starts those two emulators itself, without the Functions
 * emulator: on this route nothing but the request scores a report, and the
 * test proves it. Stop `npm run emulators` first (same ports).
 */

import { spawnSync } from 'node:child_process';
import { generateKeyPairSync } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const PROJECT = 'demo-prahari';
const AUTH_HOST = '127.0.0.1:9099';
const FIRESTORE_HOST = '127.0.0.1:8085';
const ADMIN_EMAIL = `first-admin-${Date.now().toString(36)}@prahari.test`;
const PASSWORD = 'Prahari-demo-1';

for (const [host, name] of [[AUTH_HOST, 'Auth'], [FIRESTORE_HOST, 'Firestore']]) {
  await fetch(`http://${host}/`).catch(() => {
    console.error(`\n  The ${name} emulator is not reachable at ${host}. Run this through:  npm run test:vercel\n`);
    process.exit(1);
  });
}

/** A key in the shape the Firebase console downloads. Made here, valid nowhere. */
const { privateKey } = generateKeyPairSync('rsa', {
  modulusLength: 2048,
  publicKeyEncoding: { type: 'spki', format: 'pem' },
  privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
});
const KEY = JSON.stringify({
  type: 'service_account',
  project_id: PROJECT,
  private_key: privateKey,
  client_email: `test@${PROJECT}.iam.gserviceaccount.com`,
});

// What the server sees on Vercel, plus the emulator hosts. No GCLOUD_PROJECT,
// no FIREBASE_CONFIG: the project has to come from the key.
for (const name of ['GCLOUD_PROJECT', 'GOOGLE_CLOUD_PROJECT', 'FIREBASE_CONFIG', 'GOOGLE_APPLICATION_CREDENTIALS']) delete process.env[name];
process.env.FIREBASE_AUTH_EMULATOR_HOST = AUTH_HOST;
process.env.FIRESTORE_EMULATOR_HOST = FIRESTORE_HOST;
process.env.FIREBASE_SERVICE_ACCOUNT = KEY;
process.env.BOOTSTRAP_ADMIN_EMAIL = ADMIN_EMAIL;

const { serveApi } = await import('./vercel-local.mjs');
const api = await serveApi();
const { auth, db } = await import('../functions/lib/lib/core.js');
const { analyse } = await import('../functions/lib/shared/engine.js');

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `\n         ${detail}` : ''}`);
}
const show = (v) => JSON.stringify(v);

async function post(name, data, token, { method = 'POST', body } = {}) {
  const r = await fetch(`${api.url}/api/fn/${name}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    ...(method === 'POST' ? { body: body ?? JSON.stringify({ data }) } : {}),
  });
  const json = await r.json().catch(() => ({}));
  return { status: r.status, cache: r.headers.get('cache-control'), ...json };
}

async function account(label, { role, verified = true, email } = {}) {
  email ??= `${label}-${Date.now().toString(36)}@prahari.test`;
  const user = await auth.createUser({ email, password: PASSWORD, displayName: label, emailVerified: verified });
  if (role) await auth.setCustomUserClaims(user.uid, { role });
  return { uid: user.uid, email, token: await idToken(email) };
}

async function idToken(email) {
  const r = await fetch(`http://${AUTH_HOST}/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: PASSWORD, returnSecureToken: true }),
  });
  const j = await r.json();
  if (!j.idToken) throw new Error(`sign-in failed for ${email}: ${show(j.error ?? j)}`);
  return j.idToken;
}

const newId = () => db.collection('reports').doc().id;
const daily = async () => {
  const snap = await db.collection('stats').get();
  return snap.docs.reduce((n, d) => n + Number(d.get('total') ?? 0), 0);
};

/* ---------- a register to file into ---------- */

const SITE = `site-${Date.now().toString(36)}`;
await db.collection('installations').doc(SITE).set({ name: 'Test Station', code: 'TS', area: 'Test', active: true });
const worker = await account('worker');
const officer = await account('officer', { role: 'hse-officer' });
const unverified = await account('unverified', { verified: false });

const TIER1 = 'During maintenance activity, worker entered confined space without gas testing. No standby person was present.';
const LOW = 'Housekeeping poor near the pipe rack. Scrap and empty drums lying around. Cleared by the shift crew same morning.';
const report = (text, extra = {}) => ({
  reportId: newId(),
  text,
  installationId: SITE,
  shift: 'Day',
  type: 'unsafe-act',
  contractor: false,
  ...extra,
});

/* ---------- the address and the protocol ---------- */

console.log('\nThe address and the protocol');
{
  for (const name of ['nothingHere', '__proto__', 'constructor', 'toString', 'scoreReport', 'cleanupOrphanAttachments']) {
    const r = await post(name, {});
    check(`"${name}" is not a function that can be called (404)`, r.status === 404 && r.error?.status === 'NOT_FOUND', show(r));
  }
  const get = await post('submitReport', null, null, { method: 'GET' });
  check('GET is refused (405)', get.status === 405, show(get));
  const noData = await post('submitReport', null, worker.token, { body: '{"nothing":1}' });
  check('a body without "data" is refused (400)', noData.status === 400 && noData.error?.status === 'INVALID_ARGUMENT', show(noData));
  const broken = await post('submitReport', null, worker.token, { body: '{"data":' });
  check('malformed JSON is refused (400), not a crash', broken.status === 400, show(broken));
  check('replies are never cached', get.cache === 'no-store' && noData.cache === 'no-store');
}

/* ---------- who may call ---------- */

console.log('\nWho may call');
{
  const anon = await post('submitReport', report(LOW));
  check('no sign-in → 401 with the server\'s own sentence', anon.status === 401 && anon.error?.message === 'Sign in to continue.', show(anon));
  const forged = await post('submitReport', report(LOW), 'not-a-token');
  check('a token that does not verify → 401', forged.status === 401 && forged.error?.status === 'UNAUTHENTICATED', show(forged));
  const early = await post('submitReport', report(LOW), unverified.token);
  check('an unverified email is turned away (400 failed-precondition)', early.status === 400 && early.error?.status === 'FAILED_PRECONDITION', show(early));
  const reach = await post('setUserRole', { uid: officer.uid, role: 'admin' }, worker.token);
  check('a reviewer cannot change roles (403)', reach.status === 403 && reach.error?.status === 'PERMISSION_DENIED', show(reach));
  const settings = await post('sendTestAlert', {}, worker.token);
  check('a reviewer cannot send a test alert (403)', settings.status === 403, show(settings));
}

/* ---------- filing and scoring ---------- */

console.log('\nFiling a report');
let tier1Id;
{
  const bad = await post('submitReport', report('too short'), worker.token);
  check('invalid input → 400 with a readable reason', bad.status === 400 && /at least 12 characters/.test(bad.error?.message ?? ''), show(bad));
  const nowhere = await post('submitReport', report(LOW, { installationId: 'no-such-place' }), worker.token);
  check('an unknown installation is refused', nowhere.status === 400 && nowhere.error?.status === 'FAILED_PRECONDITION', show(nowhere));

  const before = await daily();
  const input = report(TIER1);
  tier1Id = input.reportId;
  const filed = await post('submitReport', input, worker.token);
  check('a report is filed (200, result.reportId)', filed.status === 200 && filed.result?.reportId === input.reportId, show(filed));

  // No polling: the report must already be assessed when the reply arrives.
  const doc = await db.collection('reports').doc(input.reportId).get();
  const expected = analyse(TIER1);
  check('it is scored by the time the reply arrives', doc.get('status') === 'scored', `status ${doc.get('status')} ${doc.get('error') ?? ''}`);
  check('with the engine\'s own result', doc.get('score') === expected.score && doc.get('tier') === expected.tier, `${doc.get('score')}/${doc.get('tier')}`);
  check('the narrative is Tier 1 (the checks below depend on it)', expected.tier === 1);
  check('it is filed under the caller, with no attachments', doc.get('reportedBy') === worker.uid && doc.get('attachments').length === 0);
  const actions = await db.collection('actions').where('reportId', '==', input.reportId).get();
  check('corrective actions were opened', actions.size > 0, `${actions.size} actions`);
  check('the daily total went up by one', (await daily()) === before + 1, `${before} → ${await daily()}`);
  const alert = await db.collection('alerts').doc(input.reportId).get();
  check('the Tier 1 alert ran and recorded its outcome', alert.exists && alert.get('status') === 'done', show(alert.data()));

  const again = await post('submitReport', input, worker.token);
  check('filing the same report twice → 409 already-exists', again.status === 409 && again.error?.status === 'ALREADY_EXISTS', show(again));
  const after = await db.collection('reports').doc(input.reportId).get();
  check('and it is not scored twice', after.get('scoredAt').isEqual(doc.get('scoredAt')) && (await daily()) === before + 1);

  const low = report(LOW);
  await post('submitReport', low, worker.token);
  const lowDoc = await db.collection('reports').doc(low.reportId).get();
  check('a lower-tier report is scored and raises no alert', lowDoc.get('status') === 'scored' && !(await db.collection('alerts').doc(low.reportId).get()).exists, `tier ${lowDoc.get('tier')}`);

  /* ---------- the rest of the service layer ---------- */

  console.log('\nThe rest of the service layer');
  const denied = await post('recordVerdict', { reportId: input.reportId, decision: 'confirmed', note: '' }, worker.token);
  check('a reviewer cannot record a verdict (403)', denied.status === 403, show(denied));
  const verdict = await post('recordVerdict', { reportId: input.reportId, decision: 'confirmed', note: 'Checked on site.' }, officer.token);
  check('an officer records a verdict', verdict.status === 200, show(verdict));
  const rescore = await post('rescoreReport', { reportId: input.reportId }, officer.token);
  check('an officer cannot re-score a report: administrators only (403)', rescore.status === 403, show(rescore));
  const prefs = await post('getAlertSettings', {}, officer.token);
  check('alert settings can be read', prefs.status === 200 && typeof prefs.result === 'object', show(prefs));
  check('every call left an audit entry', (await db.collection('auditLogs').get()).size >= 3);
}

/* ---------- the first administrator ---------- */

console.log('\nThe first administrator');
{
  const stranger = await post('claimFirstAdmin', {}, worker.token);
  check('someone else cannot claim it (403)', stranger.status === 403, show(stranger));
  const owner = await account('owner', { email: ADMIN_EMAIL });
  const claim = await post('claimFirstAdmin', {}, owner.token);
  check('the address in BOOTSTRAP_ADMIN_EMAIL becomes the administrator', claim.status === 200 && claim.result?.ok === true, show(claim));
  check('the role is on the account itself', (await auth.getUser(owner.uid)).customClaims?.role === 'admin');
  const second = await post('claimFirstAdmin', {}, await idToken(ADMIN_EMAIL));
  check('it can be claimed only once', second.status === 400 && second.error?.status === 'FAILED_PRECONDITION', show(second));
  const admin = await idToken(ADMIN_EMAIL); // a fresh token: it carries the new role
  const promote = await post('setUserRole', { uid: officer.uid, role: 'installation-manager', installationId: SITE }, admin);
  check('the administrator can then assign roles', promote.status === 200, show(promote));
  const rescore = await post('rescoreReport', { reportId: tier1Id }, admin);
  check('and re-score a report', rescore.status === 200, show(rescore));
  const alerted = await db.collection('alerts').where('reportId', '==', tier1Id).get();
  check('which does not send its alert a second time', alerted.size === 1 && alerted.docs[0].get('status') === 'done');
}

/* ---------- the browser's own client ---------- */

console.log('\nCalled with the Firebase web SDK, as the browser does');
{
  const { initializeApp } = await import('firebase/app');
  const { connectAuthEmulator, getAuth, signInWithEmailAndPassword } = await import('firebase/auth');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const app = initializeApp({ apiKey: 'demo-key', projectId: PROJECT, appId: '1:0:web:0' });
  const webAuth = getAuth(app);
  connectAuthEmulator(webAuth, `http://${AUTH_HOST}`, { disableWarnings: true });
  await signInWithEmailAndPassword(webAuth, worker.email, PASSWORD);
  // What src/lib/firebase.ts does with VITE_FUNCTIONS_ORIGIN=/api/fn.
  const functions = getFunctions(app, `${api.url}/api/fn`);

  const input = report(TIER1);
  const reply = await httpsCallable(functions, 'submitReport')(input);
  check('httpsCallable files a report', reply.data?.reportId === input.reportId, show(reply.data));
  check('and it is scored', (await db.collection('reports').doc(input.reportId).get()).get('status') === 'scored');
  const twice = await httpsCallable(functions, 'submitReport')(input).catch((e) => e);
  check('a repeat arrives as functions/already-exists (what the offline outbox relies on)', twice.code === 'functions/already-exists', `${twice.code} ${twice.message}`);
  const refused = await httpsCallable(functions, 'setUserRole')({ uid: worker.uid, role: 'admin' }).catch((e) => e);
  check('a refusal carries its code and the server\'s sentence', refused.code === 'functions/permission-denied' && /permission/.test(refused.message), `${refused.code} ${refused.message}`);
  await webAuth.signOut();
  const anon = await httpsCallable(functions, 'submitReport')(report(LOW)).catch((e) => e);
  check('signed out → functions/unauthenticated', anon.code === 'functions/unauthenticated', `${anon.code} ${anon.message}`);
}

/* ---------- a deployment that is not set up ---------- */

console.log('\nA deployment that is not set up');
{
  const health = async () => (await fetch(`${api.url}/api/health`)).json();
  const filed = async () => (await db.collection('reports').count().get()).data().count;
  const before = await filed();
  process.env.VERCEL = '1';
  delete process.env.FIREBASE_SERVICE_ACCOUNT;
  const r = await post('submitReport', report(LOW), worker.token);
  check('no key on Vercel → 503 unavailable, so the app keeps the report and retries', r.status === 503 && r.error?.status === 'UNAVAILABLE', show(r));
  check('nothing was written', (await filed()) === before);
  const h = await health();
  check('/api/health says what is missing', h.ok === false && /FIREBASE_SERVICE_ACCOUNT is not set/.test(h.problem ?? ''), show(h));
  delete process.env.VERCEL;
  process.env.FIREBASE_SERVICE_ACCOUNT = KEY;

  // A key that is not a key is noticed when the server starts, so each case is a fresh process.
  const probe = fileURLToPath(new URL('./lib/vercel-probe.mjs', import.meta.url));
  const start = (key) => {
    const out = spawnSync(process.execPath, [probe], { env: { ...process.env, VERCEL: '1', FIREBASE_SERVICE_ACCOUNT: key }, encoding: 'utf8' });
    try {
      return JSON.parse(out.stdout);
    } catch {
      return { crashed: out.stderr.slice(0, 300) };
    }
  };
  for (const [label, key] of [['pasted text that is not JSON', 'my-key'], ['JSON that is not a key', '{"hello":"there"}']]) {
    const s = start(key);
    check(`${label}: the server still starts and says so (503)`, s.call?.status === 503 && /not a service-account key/.test(s.call?.body?.error?.message ?? ''), show(s));
    check(`${label}: nothing of what was pasted is echoed back`, !show(s).includes(key.slice(0, 6)), show(s));
  }
  const encoded = start(Buffer.from(KEY).toString('base64'));
  check('a base64-encoded key is accepted', encoded.problem === null && encoded.project === PROJECT, show(encoded));
  const plain = start(KEY);
  check('the key as downloaded is accepted, and names the project', plain.problem === null && plain.project === PROJECT, show(plain));
}

await api.close();
console.log(`\n  ${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
