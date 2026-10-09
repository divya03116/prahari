#!/usr/bin/env node
/**
 * Adversarial security checks against the running emulator suite — `npm run test:rules`.
 *
 * Every request uses a REAL ID token from the Auth emulator, so Firestore and
 * Storage rules and the callables' guard() are genuinely evaluated. Three
 * layers are attacked:
 *
 *   1. Firestore rules  — browsers read only what their role may see (all
 *      reports for HSE officers/admins, their installation's for a manager,
 *      their own for everyone else); they may not write anything but their
 *      own profile, and never their role.
 *   2. Storage rules    — uploads only into your own folder, only allowed
 *      types, only before the report is filed.
 *   3. The service layer — each callable enforces the role and scope it claims.
 *
 * Requires `npm run seed` to have run (it creates the four role accounts).
 * If any expectation fails, the process exits non-zero.
 */

import {
  AUTH_REST,
  auth,
  bucket,
  callFn,
  db,
  FS_REST,
  HOSTS,
  PROJECT,
  signIn,
  STORAGE_REST,
  assertEmulatorsUp,
  tinyPng,
} from './lib/emulator.mjs';

await assertEmulatorsUp();

const PASSWORD = 'Prahari-demo-1';
let pass = 0;
let fail = 0;
const failures = [];

function record(ok, label, got, want, detail) {
  if (ok) pass++;
  else {
    fail++;
    failures.push(label);
  }
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${String(got).padEnd(20)} ${label}`);
  if (!ok && detail) console.log(`         want ${want} → ${String(detail).slice(0, 240)}`);
}

/** HTTP-level check for REST calls against rules. */
async function expectHttp(label, want, run) {
  const res = await run();
  const got = res.status < 300 ? 'ALLOWED' : 'DENIED';
  record(got === want, label, got, want, got === want ? null : await res.text());
}

/** Callable check: `want` is 'ok' or an HttpsError status such as 'PERMISSION_DENIED'. */
async function expectCall(label, want, name, data, token) {
  const res = await callFn(name, data, token);
  const got = res.status === 200 ? 'ok' : res.error?.status ?? `HTTP ${res.status}`;
  record(got === want, label, got, want, got === want ? null : res.error?.message);
  return res;
}

const S = (v) => ({ stringValue: v });
const I = (v) => ({ integerValue: String(v) });
const H = (token) => ({ 'Content-Type': 'application/json', Authorization: `Bearer ${token}` });

/** Firestore commit with server-time transforms — how the web SDK writes serverTimestamp(). */
function commitCreate(token, path, fields, timeFields) {
  return fetch(`${FS_REST}:commit`, {
    method: 'POST',
    headers: H(token),
    body: JSON.stringify({
      writes: [
        {
          update: { name: `projects/${PROJECT}/databases/(default)/documents/${path}`, fields },
          updateTransforms: timeFields.map((f) => ({ fieldPath: f, setToServerValue: 'REQUEST_TIME' })),
          currentDocument: { exists: false },
        },
      ],
    }),
  });
}

/**
 * Multipart upload with explicit metadata — the request the web SDK sends.
 * (A bare media upload carries no contentType metadata, so it would be
 * refused by the type rule for the wrong reason.)
 */
function upload(token, path, body, contentType) {
  const boundary = `prahari${Date.now()}`;
  const meta = JSON.stringify({ name: path, contentType });
  const payload = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Type: application/json; charset=utf-8\r\n\r\n${meta}\r\n--${boundary}\r\nContent-Type: ${contentType}\r\n\r\n`),
    body,
    Buffer.from(`\r\n--${boundary}--`),
  ]);
  return fetch(`${STORAGE_REST}?name=${encodeURIComponent(path)}`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/related; boundary=${boundary}`,
      'X-Goog-Upload-Protocol': 'multipart',
      ...(token ? { Authorization: `Firebase ${token}` } : {}),
    },
    body: payload,
  });
}

/* ---------------------------------------------------------------- setup */

const admin = await signIn('admin@prahari.test', PASSWORD);
const officer = await signIn('officer@prahari.test', PASSWORD);
const manager = await signIn('manager@prahari.test', PASSWORD);
const reviewer = await signIn('reviewer@prahari.test', PASSWORD);

// A fresh, UNVERIFIED account, signed up through the REST API like a browser.
const probeEmail = `probe-${Date.now()}@prahari.test`;
const signUp = await (
  await fetch(`${AUTH_REST}/accounts:signUp?key=demo-key`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: probeEmail, password: PASSWORD, returnSecureToken: true }),
  })
).json();
const unverified = { token: signUp.idToken, uid: signUp.localId };

// The other trusted sign-in methods, through the Auth emulator's REST API:
// a phone number with an SMS code (no email at all) and Sign in with Apple.
const postAuth = async (path, body) =>
  (await fetch(`${AUTH_REST}/${path}?key=demo-key`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })).json();
const phoneNumber = `+9199${Date.now().toString().slice(-8)}`;
const { sessionInfo } = await postAuth('accounts:sendVerificationCode', { phoneNumber });
const { verificationCodes = [] } = await (await fetch(`http://${HOSTS.auth}/emulator/v1/projects/${PROJECT}/verificationCodes`)).json();
const smsCode = verificationCodes.filter((c) => c.phoneNumber === phoneNumber).at(-1)?.code;
const phoneIn = await postAuth('accounts:signInWithPhoneNumber', { sessionInfo, code: smsCode });
const phone = { token: phoneIn.idToken, uid: phoneIn.localId };
const appleEmail = `apple-probe-${Date.now()}@privaterelay.appleid.com`;
const appleIn = await postAuth('accounts:signInWithIdp', {
  requestUri: 'http://localhost',
  postBody: `providerId=apple.com&id_token=${encodeURIComponent(JSON.stringify({ sub: `apple-probe-${Date.now()}`, email: appleEmail }))}`,
  returnSecureToken: true,
});
const apple = { token: appleIn.idToken, uid: appleIn.localId };
if (!phone.token || !apple.token) {
  console.error('\n  Could not sign in with a phone number or Apple on the Auth emulator.\n', phoneIn.error ?? appleIn.error ?? '');
  process.exit(1);
}

const someReport = (await db.collection('reports').where('status', '==', 'scored').limit(1).get()).docs[0];
if (!someReport) {
  console.error('\n  No scored reports found. Run `npm run seed` first.\n');
  process.exit(1);
}
const reportPath = `reports/${someReport.id}`;
const managerInstallation = (await db.collection('users').doc(manager.uid).get()).get('installationId');
const ownAction = (
  await db.collection('actions').where('installationId', '==', managerInstallation).where('status', 'in', ['open', 'in_progress']).limit(1).get()
).docs[0];
const otherAction = (
  await db.collection('actions').where('installationId', '!=', managerInstallation).limit(1).get()
).docs[0];

// Visibility fixtures — whose report is whose (canSee() in firestore.rules).
const reportsBy = async (uid) => (await db.collection('reports').where('reportedBy', '==', uid).get()).docs;
const reviewerReport = (await reportsBy(reviewer.uid))[0];
const officerElsewhere = (await reportsBy(officer.uid)).find((d) => d.get('installationId') !== managerInstallation);
const managerSiteReport = (await db.collection('reports').where('installationId', '==', managerInstallation).get()).docs.find(
  (d) => d.get('reportedBy') !== manager.uid,
);
const actionBy = async (uid) => (await db.collection('actions').where('reportedBy', '==', uid).limit(1).get()).docs[0];
const reviewerAction = await actionBy(reviewer.uid);
const officerAction = await actionBy(officer.uid);
if (!reviewerReport || !officerElsewhere || !managerSiteReport || !reviewerAction || !officerAction) {
  console.error('\n  Visibility fixtures are missing. Re-seed a fresh emulator (`npm run seed`).\n');
  process.exit(1);
}

/** A list query as the web SDK sends it, with optional equality filters. */
function listQuery(token, collectionId, filters = {}) {
  const conds = Object.entries(filters).map(([fieldPath, value]) => ({ fieldFilter: { field: { fieldPath }, op: 'EQUAL', value: S(value) } }));
  const structuredQuery = { from: [{ collectionId }], limit: 5 };
  if (conds.length === 1) structuredQuery.where = conds[0];
  if (conds.length > 1) structuredQuery.where = { compositeFilter: { op: 'AND', filters: conds } };
  return fetch(`${FS_REST}:runQuery`, { method: 'POST', headers: H(token), body: JSON.stringify({ structuredQuery }) });
}
const getDoc = (token, path) => fetch(`${FS_REST}/${path}`, { headers: H(token) });

console.log('\n  1. Firestore rules\n');

await expectHttp('reviewer can read a report they filed', 'ALLOWED', () => getDoc(reviewer.token, `reports/${reviewerReport.id}`));
await expectHttp('reviewer cannot read someone else’s report', 'DENIED', () => getDoc(reviewer.token, `reports/${officerElsewhere.id}`));
await expectHttp('reviewer cannot list the whole register', 'DENIED', () => listQuery(reviewer.token, 'reports'));
await expectHttp('reviewer can list the reports they filed', 'ALLOWED', () => listQuery(reviewer.token, 'reports', { reportedBy: reviewer.uid }));
await expectHttp('reviewer cannot list someone else’s reports', 'DENIED', () => listQuery(reviewer.token, 'reports', { reportedBy: officer.uid }));
await expectHttp('manager can read a report at their installation', 'ALLOWED', () => getDoc(manager.token, `reports/${managerSiteReport.id}`));
await expectHttp('manager cannot read a report at another installation', 'DENIED', () => getDoc(manager.token, `reports/${officerElsewhere.id}`));
await expectHttp('manager can list their installation’s reports', 'ALLOWED', () => listQuery(manager.token, 'reports', { installationId: managerInstallation }));
await expectHttp('manager cannot list the whole register', 'DENIED', () => listQuery(manager.token, 'reports'));
await expectHttp('officer can list the whole register', 'ALLOWED', () => listQuery(officer.token, 'reports'));
await expectHttp('admin can read anyone’s report', 'ALLOWED', () => getDoc(admin.token, `reports/${reviewerReport.id}`));
await expectHttp('reviewer can read an action on their own report', 'ALLOWED', () => getDoc(reviewer.token, `actions/${reviewerAction.id}`));
await expectHttp('reviewer cannot read an action on someone else’s report', 'DENIED', () => getDoc(reviewer.token, `actions/${officerAction.id}`));
await expectHttp('reviewer cannot list all actions', 'DENIED', () => listQuery(reviewer.token, 'actions'));
await expectHttp('reviewer can list the actions on their reports', 'ALLOWED', () => listQuery(reviewer.token, 'actions', { reportedBy: reviewer.uid }));
await expectHttp('reviewer cannot read site-wide daily totals', 'DENIED', () => fetch(`${FS_REST}/stats?pageSize=1`, { headers: H(reviewer.token) }));
await expectHttp('reviewer cannot read the site heat map', 'DENIED', () => fetch(`${FS_REST}/heat?pageSize=1`, { headers: H(reviewer.token) }));
await expectHttp('officer can read site-wide daily totals', 'ALLOWED', () => fetch(`${FS_REST}/stats?pageSize=1`, { headers: H(officer.token) }));
await expectHttp('unverified account cannot read the register', 'DENIED', () => fetch(`${FS_REST}/${reportPath}`, { headers: H(unverified.token) }));
await expectHttp('unauthenticated request cannot read the register', 'DENIED', () => fetch(`${FS_REST}/${reportPath}`));

await expectHttp('reviewer cannot create a report directly (must use submitReport)', 'DENIED', () =>
  fetch(`${FS_REST}/reports`, {
    method: 'POST',
    headers: H(reviewer.token),
    body: JSON.stringify({ fields: { text: S('Direct write attempt that bypasses the service layer.'), status: S('pending'), reportedBy: S(reviewer.uid) } }),
  }),
);
await expectHttp('officer cannot create a pre-scored report', 'DENIED', () =>
  fetch(`${FS_REST}/reports`, {
    method: 'POST',
    headers: H(officer.token),
    body: JSON.stringify({ fields: { text: S('Arrives already scored by the client.'), status: S('scored'), score: I(5), tier: I(3) } }),
  }),
);
await expectHttp('admin cannot overwrite a score from the browser', 'DENIED', () =>
  fetch(`${FS_REST}/${reportPath}?updateMask.fieldPaths=score`, { method: 'PATCH', headers: H(admin.token), body: JSON.stringify({ fields: { score: I(1) } }) }),
);
await expectHttp('officer cannot write a verdict directly', 'DENIED', () =>
  fetch(`${FS_REST}/${reportPath}?updateMask.fieldPaths=verdictDecision`, { method: 'PATCH', headers: H(officer.token), body: JSON.stringify({ fields: { verdictDecision: S('dismissed') } }) }),
);
await expectHttp('nobody can delete a report from the browser', 'DENIED', () => fetch(`${FS_REST}/${reportPath}`, { method: 'DELETE', headers: H(admin.token) }));
await expectHttp('officer cannot create an action directly', 'DENIED', () =>
  fetch(`${FS_REST}/actions`, { method: 'POST', headers: H(officer.token), body: JSON.stringify({ fields: { control: S('probe'), status: S('closed') } }) }),
);
await expectHttp('admin cannot write reference data directly', 'DENIED', () =>
  fetch(`${FS_REST}/installations/probe`, { method: 'PATCH', headers: H(admin.token), body: JSON.stringify({ fields: { name: S('Probe'), active: { booleanValue: true } } }) }),
);
await expectHttp('reviewer cannot write a heat cell', 'DENIED', () =>
  fetch(`${FS_REST}/heat/probe__2020-01-01`, { method: 'PATCH', headers: H(reviewer.token), body: JSON.stringify({ fields: { peak: I(0) } }) }),
);
await expectHttp('reviewer cannot write daily stats', 'DENIED', () =>
  fetch(`${FS_REST}/stats/2020-01-01`, { method: 'PATCH', headers: H(reviewer.token), body: JSON.stringify({ fields: { total: I(0) } }) }),
);
await expectHttp('officer cannot forge a training label', 'DENIED', () =>
  fetch(`${FS_REST}/labels`, { method: 'POST', headers: H(officer.token), body: JSON.stringify({ fields: { humanLabel: S('dismissed') } }) }),
);
await expectHttp('officer cannot read training labels', 'DENIED', () => fetch(`${FS_REST}/labels?pageSize=1`, { headers: H(officer.token) }));
await expectHttp('admin can read training labels', 'ALLOWED', () => fetch(`${FS_REST}/labels?pageSize=1`, { headers: H(admin.token) }));
await expectHttp('admin cannot write to the audit log', 'DENIED', () =>
  fetch(`${FS_REST}/auditLogs`, { method: 'POST', headers: H(admin.token), body: JSON.stringify({ fields: { action: S('forged') } }) }),
);
await expectHttp('officer cannot read the audit log', 'DENIED', () => fetch(`${FS_REST}/auditLogs?pageSize=1`, { headers: H(officer.token) }));
await expectHttp('admin can read the audit log', 'ALLOWED', () => fetch(`${FS_REST}/auditLogs?pageSize=1`, { headers: H(admin.token) }));
await expectHttp('nobody can read rate-limit counters', 'DENIED', () => fetch(`${FS_REST}/rateLimits?pageSize=1`, { headers: H(admin.token) }));

// Tier 1 alert records: what was sent, for the people who review reports.
await expectHttp('reviewer cannot read alert records', 'DENIED', () => fetch(`${FS_REST}/alerts?pageSize=1`, { headers: H(reviewer.token) }));
await expectHttp('manager cannot read alert records', 'DENIED', () => fetch(`${FS_REST}/alerts?pageSize=1`, { headers: H(manager.token) }));
await expectHttp('officer can read alert records', 'ALLOWED', () => fetch(`${FS_REST}/alerts?pageSize=1`, { headers: H(officer.token) }));
await expectHttp('nobody can forge an alert record', 'DENIED', () =>
  fetch(`${FS_REST}/alerts`, { method: 'POST', headers: H(admin.token), body: JSON.stringify({ fields: { status: S('done') } }) }),
);
await expectHttp('nobody can set their own alert channels directly', 'DENIED', () =>
  fetch(`${FS_REST}/users/${officer.uid}?updateMask.fieldPaths=alerts`, { method: 'PATCH', headers: H(officer.token), body: JSON.stringify({ fields: { alerts: { mapValue: { fields: { email: { booleanValue: false } } } } } }) }),
);

await expectHttp('reviewer cannot promote themselves', 'DENIED', () =>
  fetch(`${FS_REST}/users/${reviewer.uid}?updateMask.fieldPaths=role`, { method: 'PATCH', headers: H(reviewer.token), body: JSON.stringify({ fields: { role: S('admin') } }) }),
);
await expectHttp('reviewer cannot assign themselves an installation', 'DENIED', () =>
  fetch(`${FS_REST}/users/${reviewer.uid}?updateMask.fieldPaths=installationId`, { method: 'PATCH', headers: H(reviewer.token), body: JSON.stringify({ fields: { installationId: S('rig-17') } }) }),
);
await expectHttp('reviewer can rename themselves', 'ALLOWED', () =>
  fetch(`${FS_REST}/users/${reviewer.uid}?updateMask.fieldPaths=displayName`, { method: 'PATCH', headers: H(reviewer.token), body: JSON.stringify({ fields: { displayName: S('Imran Shaikh') } }) }),
);
await expectHttp('reviewer cannot read another user’s profile', 'DENIED', () => fetch(`${FS_REST}/users/${officer.uid}`, { headers: H(reviewer.token) }));
await expectHttp('admin can read another user’s profile', 'ALLOWED', () => fetch(`${FS_REST}/users/${officer.uid}`, { headers: H(admin.token) }));

const profileFields = (role) => ({
  email: S(probeEmail),
  displayName: S('Probe'),
  role: S(role),
  installationId: { nullValue: null },
  disabled: { booleanValue: false },
});
await expectHttp('new account cannot create its profile as admin', 'DENIED', () =>
  commitCreate(unverified.token, `users/${unverified.uid}`, profileFields('admin'), ['createdAt', 'lastSeenAt']),
);
await expectHttp('new account cannot create a profile for someone else', 'DENIED', () =>
  commitCreate(unverified.token, `users/${reviewer.uid}-x`, profileFields('reviewer'), ['createdAt', 'lastSeenAt']),
);
await expectHttp('new account can create its own reviewer profile', 'ALLOWED', () =>
  commitCreate(unverified.token, `users/${unverified.uid}`, profileFields('reviewer'), ['createdAt', 'lastSeenAt']),
);

// Phone and Apple sign-ins count as verified — the provider proved the number
// or the address — and get the same own-only access as any reviewer.
const trustedProfile = (email) => ({ ...profileFields('reviewer'), email: S(email) });
await expectHttp('phone account cannot put an email in its profile', 'DENIED', () =>
  commitCreate(phone.token, `users/${phone.uid}`, trustedProfile(probeEmail), ['createdAt', 'lastSeenAt']),
);
await expectHttp('phone account can create its profile with no email', 'ALLOWED', () =>
  commitCreate(phone.token, `users/${phone.uid}`, trustedProfile(''), ['createdAt', 'lastSeenAt']),
);
await expectHttp('Apple account can create its own reviewer profile', 'ALLOWED', () =>
  commitCreate(apple.token, `users/${apple.uid}`, trustedProfile(appleEmail), ['createdAt', 'lastSeenAt']),
);
await expectHttp('phone account can list the reports it filed', 'ALLOWED', () => listQuery(phone.token, 'reports', { reportedBy: phone.uid }));
await expectHttp('phone account cannot list the whole register', 'DENIED', () => listQuery(phone.token, 'reports'));
await expectHttp('Apple account can list the reports it filed', 'ALLOWED', () => listQuery(apple.token, 'reports', { reportedBy: apple.uid }));
await expectHttp('Apple account cannot read someone else’s report', 'DENIED', () => getDoc(apple.token, `reports/${officerElsewhere.id}`));

console.log('\n  2. Storage rules\n');

const draftId = db.collection('reports').doc().id;
const ownPath = `attachments/${reviewer.uid}/${draftId}/probe.png`;
await expectHttp('upload a PNG into your own draft folder', 'ALLOWED', () => upload(reviewer.token, ownPath, tinyPng(), 'image/png'));
await expectHttp('upload into another user’s folder', 'DENIED', () =>
  upload(reviewer.token, `attachments/${officer.uid}/${draftId}/probe.png`, tinyPng(), 'image/png'),
);
await expectHttp('upload a disallowed file type', 'DENIED', () =>
  upload(reviewer.token, `attachments/${reviewer.uid}/${draftId}/probe.txt`, Buffer.from('hello'), 'text/plain'),
);
await expectHttp('upload into the folder of an already-filed report', 'DENIED', () =>
  upload(reviewer.token, `attachments/${reviewer.uid}/${someReport.id}/late.png`, tinyPng(), 'image/png'),
);
await expectHttp('unverified account cannot upload', 'DENIED', () =>
  upload(unverified.token, `attachments/${unverified.uid}/${draftId}/probe.png`, tinyPng(), 'image/png'),
);
await expectHttp('phone account can upload into its own draft folder', 'ALLOWED', () =>
  upload(phone.token, `attachments/${phone.uid}/${draftId}/probe.png`, tinyPng(), 'image/png'),
);
await expectHttp('unauthenticated upload', 'DENIED', () => upload(null, `attachments/x/${draftId}/probe.png`, tinyPng(), 'image/png'));
await expectHttp('outside the attachments tree', 'DENIED', () => upload(reviewer.token, `public/probe.png`, tinyPng(), 'image/png'));
const readFile = (token, path) => fetch(`${STORAGE_REST}/${encodeURIComponent(path)}?alt=media`, { headers: { Authorization: `Firebase ${token}` } });
await expectHttp('owner can read their own attachment', 'ALLOWED', () => readFile(reviewer.token, ownPath));
await expectHttp('officer can read anyone’s attachment', 'ALLOWED', () => readFile(officer.token, ownPath));
await expectHttp('manager cannot read someone else’s draft attachment', 'DENIED', () => readFile(manager.token, ownPath));
const officerPath = `attachments/${officer.uid}/${draftId}/probe.png`;
await bucket.file(officerPath).save(tinyPng(), { contentType: 'image/png' });
await expectHttp('reviewer cannot read someone else’s attachment', 'DENIED', () => readFile(reviewer.token, officerPath));
await expectHttp('owner can remove a draft upload', 'ALLOWED', () =>
  fetch(`${STORAGE_REST}/${encodeURIComponent(ownPath)}`, { method: 'DELETE', headers: { Authorization: `Firebase ${reviewer.token}` } }),
);

console.log('\n  3. Service layer (callables)\n');

const validReport = {
  reportId: db.collection('reports').doc().id,
  text: 'Probe narrative: valid shape, sent by the wrong caller.',
  installationId: 'tank-farm-a',
  activityId: 'housekeeping',
  shift: 'Day',
  type: 'unsafe-condition',
  contractor: false,
  attachments: [],
};
await expectCall('unauthenticated submitReport is refused', 'UNAUTHENTICATED', 'submitReport', validReport, null);
await expectCall('unverified account cannot submit', 'FAILED_PRECONDITION', 'submitReport', validReport, unverified.token);
// Past the verified-account check, the (deliberately short) text is what is refused.
await expectCall('phone account passes the verified-account check', 'INVALID_ARGUMENT', 'submitReport', { ...validReport, text: 'short' }, phone.token);
await expectCall('Apple account passes the verified-account check', 'INVALID_ARGUMENT', 'submitReport', { ...validReport, text: 'short' }, apple.token);
// The emulator configures no bootstrap address, so nobody may claim admin.
await expectCall('claimFirstAdmin refuses an account that is not the configured address', 'PERMISSION_DENIED', 'claimFirstAdmin', {}, reviewer.token);
await expectCall('claimFirstAdmin refuses a phone account', 'PERMISSION_DENIED', 'claimFirstAdmin', {}, phone.token);
await expectCall('invalid input is rejected by the shared schema', 'INVALID_ARGUMENT', 'submitReport', { ...validReport, text: 'short' }, reviewer.token);
await expectCall('unknown installation is refused', 'FAILED_PRECONDITION', 'submitReport', { ...validReport, installationId: 'no-such-site' }, reviewer.token);
await expectCall('attachment outside the caller’s folder is refused', 'PERMISSION_DENIED', 'submitReport',
  { ...validReport, attachments: [{ path: `attachments/${officer.uid}/${validReport.reportId}/x.png`, name: 'x.png', size: 10, contentType: 'image/png' }] },
  reviewer.token,
);
await expectCall('reviewer cannot record a verdict', 'PERMISSION_DENIED', 'recordVerdict', { reportId: someReport.id, decision: 'dismissed', note: '' }, reviewer.token);
await expectCall('manager cannot record a verdict', 'PERMISSION_DENIED', 'recordVerdict', { reportId: someReport.id, decision: 'dismissed', note: '' }, manager.token);
await expectCall('officer cannot re-score (admin only)', 'PERMISSION_DENIED', 'rescoreReport', { reportId: someReport.id }, officer.token);
await expectCall('officer cannot archive (admin only)', 'PERMISSION_DENIED', 'archiveReport', { reportId: someReport.id, reason: 'probe' }, officer.token);
await expectCall('officer cannot change roles', 'PERMISSION_DENIED', 'setUserRole', { uid: reviewer.uid, role: 'admin' }, officer.token);
await expectCall('reviewer cannot change roles', 'PERMISSION_DENIED', 'setUserRole', { uid: reviewer.uid, role: 'admin' }, reviewer.token);
await expectCall('admin cannot change their own role', 'FAILED_PRECONDITION', 'setUserRole', { uid: admin.uid, role: 'reviewer' }, admin.token);
await expectCall('admin cannot disable themselves', 'FAILED_PRECONDITION', 'setUserDisabled', { uid: admin.uid, disabled: true }, admin.token);
await expectCall('officer cannot create reference data', 'PERMISSION_DENIED', 'upsertReference', { kind: 'installations', name: 'Probe site', code: '', region: '', active: true }, officer.token);
await expectCall('admin cannot delete an installation that reports use', 'FAILED_PRECONDITION', 'deleteReference', { kind: 'installations', id: someReport.get('installationId') }, admin.token);
await expectCall('reviewer cannot update an action', 'PERMISSION_DENIED', 'updateAction', { actionId: ownAction?.id ?? 'x', note: 'probe' }, reviewer.token);
if (otherAction) {
  await expectCall('manager cannot update an action at another installation', 'PERMISSION_DENIED', 'updateAction', { actionId: otherAction.id, note: 'probe' }, manager.token);
}
if (ownAction) {
  await expectCall('manager cannot cancel an action', 'PERMISSION_DENIED', 'updateAction', { actionId: ownAction.id, status: 'cancelled' }, manager.token);
  await expectCall('manager cannot reassign an action', 'PERMISSION_DENIED', 'updateAction', { actionId: ownAction.id, owner: 'Someone else' }, manager.token);
  const before = ownAction.get('note') ?? '';
  await expectCall('manager can add a progress note at their installation', 'ok', 'updateAction', { actionId: ownAction.id, note: 'Probe progress note' }, manager.token);
  await callFn('updateAction', { actionId: ownAction.id, note: before }, officer.token);
}
const engineAction = (await db.collection('actions').where('source', '==', 'engine').limit(1).get()).docs[0];
if (engineAction) {
  await expectCall('admin cannot delete an engine-drafted action', 'FAILED_PRECONDITION', 'deleteAction', { actionId: engineAction.id }, admin.token);
}

console.log('\n  4. Incidents: camera PPE, statements, quick reports\n');

const camId = `cam_probe${Date.now().toString(16)}`;
async function ppePayload(caller, types = ['helmet'], evidenceOwner = caller.uid) {
  const reportId = db.collection('reports').doc().id;
  const path = `attachments/${evidenceOwner}/${reportId}/evidence-frame.png`;
  await bucket.file(path).save(tinyPng(), { contentType: 'image/png' });
  return {
    reportId,
    installationId: 'tank-farm-a',
    camera: { id: camId, label: 'Probe camera', kind: 'device' },
    violations: types.map((type) => ({ type, trackId: 1, personConfidence: 0.91, frames: 12, seconds: 2.4 })),
    workers: [{ trackId: 1, box: { x1: 10, y1: 10, x2: 20, y2: 30 }, confidence: 0.91, ppe: { helmet: { state: 'missing', confidence: null }, vest: { state: 'present', confidence: 0.8 } } }],
    frame: { width: 32, height: 24 },
    evidence: { path, name: 'evidence-frame.png', size: tinyPng().length, contentType: 'image/png' },
    model: { name: 'probe-model', architecture: 'YOLOv8', backend: 'remote', classes: ['person', 'helmet', 'vest'] },
    settings: { minConfidence: 0.6, confirmationFrames: 10, violationSeconds: 2, incidentCooldownSeconds: 300 },
    required: ['helmet', 'vest'],
    geo: null,
  };
}

const first = await expectCall('a confirmed camera PPE violation creates an incident', 'ok', 'createPpeIncident', await ppePayload(reviewer), reviewer.token);
const firstId = first.result?.reportId;
const dup = await callFn('createPpeIncident', await ppePayload(reviewer), reviewer.token);
record(dup.status === 200 && dup.result?.deduplicated === true, 'the same camera + PPE type inside the cooldown is de-duplicated', dup.result?.deduplicated ? 'deduplicated' : 'created');
const vest = await callFn('createPpeIncident', await ppePayload(reviewer, ['vest']), reviewer.token);
record(vest.status === 200 && vest.result?.deduplicated === false, 'a different PPE type from the same camera is a new incident', vest.result?.deduplicated === false ? 'created' : JSON.stringify(vest.error ?? vest.result));
await expectCall('camera incident with evidence in someone else’s folder is refused', 'PERMISSION_DENIED', 'createPpeIncident', await ppePayload(reviewer, ['helmet'], officer.uid), reviewer.token);
await expectCall('camera incident with an unknown PPE type is refused', 'INVALID_ARGUMENT', 'createPpeIncident', { ...(await ppePayload(reviewer)), violations: [{ type: 'cape', trackId: 1, personConfidence: 0.9, frames: 10, seconds: 2 }] }, reviewer.token);
await expectCall('unauthenticated camera incident is refused', 'UNAUTHENTICATED', 'createPpeIncident', await ppePayload(reviewer), null);
await expectHttp('browsers cannot read the de-duplication state', 'DENIED', () => fetch(`${FS_REST}/ppeCooldowns?pageSize=1`, { headers: H(admin.token) }));

if (firstId) {
  // Wait for the scoring trigger, then check the structured record.
  let scored = null;
  for (let i = 0; i < 30 && !scored; i++) {
    const s = await db.collection('reports').doc(firstId).get();
    if (s.get('status') === 'scored') scored = s;
    else await new Promise((r) => setTimeout(r, 500));
  }
  const st = scored?.get('structured');
  record(
    !!st && st.source === 'camera' && st.hazardType === 'PPE non-compliance' && /helmet/i.test(st.title) && scored.get('ppe.violations').length === 1,
    'camera incident is scored and structured (source, hazard, title, evidence)',
    true,
    true,
    JSON.stringify(st),
  );
  await expectCall('a worker adds a voice statement to the camera incident', 'ok', 'addStatement', { reportId: firstId, text: 'The worker near the compressor is not wearing a helmet.', source: 'voice' }, officer.token);
  const withStatement = await db.collection('reports').doc(firstId).get();
  record((withStatement.get('statements') ?? []).length === 1 && withStatement.get('statements')[0].source === 'voice', 'the statement is stored on the same incident as a separate source', true, true);
}
await expectCall('a one-word statement is refused', 'INVALID_ARGUMENT', 'addStatement', { reportId: someReport.id, text: 'hi', source: 'text' }, reviewer.token);

// Camera hazards: unsafe acts, unsafe conditions and near misses.
async function hazardPayload(caller, event, evidenceOwner = caller.uid) {
  const reportId = db.collection('reports').doc().id;
  const path = `attachments/${evidenceOwner}/${reportId}/evidence-frame.png`;
  await bucket.file(path).save(tinyPng(), { contentType: 'image/png' });
  return {
    reportId,
    installationId: 'tank-farm-a',
    camera: { id: camId, label: 'Probe camera', kind: 'device' },
    event: { frames: 7, seconds: 2.4, subject: { label: 'person', confidence: 0.91, box: { x1: 10, y1: 10, x2: 20, y2: 30 } }, ...event },
    frame: { width: 32, height: 24 },
    evidence: { path, name: 'evidence-frame.png', size: tinyPng().length, contentType: 'image/png' },
    models: [{ role: 'pose', name: 'pose-coco', architecture: 'YOLOv8' }],
    settings: { minConfidence: 0.5, incidentCooldownSeconds: 300 },
    geo: null,
  };
}
const zoneEvent = { key: 'restricted-zone:zp', type: 'restricted-zone', zone: { id: 'zp', name: 'Probe zone', kind: 'danger' } };
const hz = await expectCall('a confirmed camera hazard creates an incident', 'ok', 'createHazardIncident', await hazardPayload(reviewer, zoneEvent), reviewer.token);
const hzId = hz.result?.reportId;
const hzDup = await callFn('createHazardIncident', await hazardPayload(reviewer, zoneEvent), reviewer.token);
record(hzDup.status === 200 && hzDup.result?.deduplicated === true, 'the same camera, hazard and zone inside the cooldown is de-duplicated', hzDup.result?.deduplicated ? 'deduplicated' : 'created');
const hzOther = await callFn(
  'createHazardIncident',
  await hazardPayload(reviewer, { ...zoneEvent, key: 'restricted-zone:zq', zone: { id: 'zq', name: 'Second zone', kind: 'danger' } }),
  reviewer.token,
);
record(hzOther.status === 200 && hzOther.result?.deduplicated === false, 'another zone on the same camera is a new incident', hzOther.result?.deduplicated === false ? 'created' : JSON.stringify(hzOther.error ?? hzOther.result));
const nm = await expectCall(
  'a near miss from the camera is filed',
  'ok',
  'createHazardIncident',
  await hazardPayload(reviewer, { key: 'vehicle-proximity', type: 'vehicle-proximity', other: { label: 'truck', confidence: 0.8, box: { x1: 0, y1: 5, x2: 9, y2: 30 } } }),
  reviewer.token,
);
await expectCall('a zone rule without its zone is refused', 'INVALID_ARGUMENT', 'createHazardIncident', await hazardPayload(reviewer, { key: 'restricted-zone', type: 'restricted-zone' }), reviewer.token);
await expectCall('a forged de-duplication key is refused', 'INVALID_ARGUMENT', 'createHazardIncident', await hazardPayload(reviewer, { key: 'fire:elsewhere', type: 'fire' }), reviewer.token);
await expectCall('hazard evidence in someone else’s folder is refused', 'PERMISSION_DENIED', 'createHazardIncident', await hazardPayload(reviewer, { key: 'fire', type: 'fire' }, officer.uid), reviewer.token);
await expectCall('unauthenticated hazard incident is refused', 'UNAUTHENTICATED', 'createHazardIncident', await hazardPayload(reviewer, { key: 'smoke', type: 'smoke' }), null);

async function scoredDoc(id) {
  for (let i = 0; i < 40; i++) {
    const d = await db.collection('reports').doc(id).get();
    if (d.get('status') === 'scored') return d;
    await new Promise((r) => setTimeout(r, 500));
  }
  return null;
}
if (hzId) {
  const d = await scoredDoc(hzId);
  const st = d?.get('structured');
  record(
    !!d && d.get('type') === 'unsafe-act' && st?.hazardType === 'Unauthorised entry' && /^Person in a restricted zone/.test(st?.title) && d.get('hazard.zone.name') === 'Probe zone',
    'a restricted-zone incident is an unsafe act, structured as unauthorised entry',
    true,
    true,
    JSON.stringify({ type: d?.get('type'), st }),
  );
}
if (nm.result?.reportId) {
  const d = await scoredDoc(nm.result.reportId);
  record(!!d && d.get('type') === 'near-miss' && d.get('structured.hazardType') === 'Vehicle / mobile plant', 'a vehicle near miss is a near miss, structured as vehicle / mobile plant', true, true, JSON.stringify({ type: d?.get('type'), st: d?.get('structured') }));
}

const quick = await expectCall('a quick voice report without an activity, with GPS, is accepted', 'ok', 'submitReport', {
  reportId: db.collection('reports').doc().id,
  text: 'There is an oil spill near the compressor area and people are walking through it.',
  installationId: 'tank-farm-a',
  shift: 'Day',
  type: 'unsafe-condition',
  contractor: false,
  attachments: [],
  source: 'voice',
  geo: { lat: 27.4728, lng: 94.9120, accuracy: 12 },
}, reviewer.token);
const quickId = quick.result?.reportId;
await expectCall('a photo report without its photo is refused', 'INVALID_ARGUMENT', 'submitReport', {
  reportId: db.collection('reports').doc().id,
  text: 'Photo check found fire (88%).',
  installationId: 'tank-farm-a',
  shift: 'Day',
  type: 'unsafe-condition',
  contractor: false,
  attachments: [],
  source: 'photo',
  photoCheck: { models: ['fire-v1'], findings: [{ type: 'fire', confidence: 0.88 }] },
}, reviewer.token);

/* ---------------------------------------------------------------- cleanup */
for (const id of [firstId, vest.result?.reportId, quickId, hzId, hzOther.result?.reportId, nm.result?.reportId].filter(Boolean)) {
  for (const a of (await db.collection('actions').where('reportId', '==', id).get()).docs) await a.ref.delete();
  await db.collection('reports').doc(id).delete().catch(() => undefined);
}
for (const d of (await db.collection('ppeCooldowns').where('cameraId', '==', camId).get()).docs) await d.ref.delete();

for (const uid of [unverified.uid, phone.uid, apple.uid]) {
  await auth.deleteUser(uid).catch(() => undefined);
  await db.collection('users').doc(uid).delete().catch(() => undefined);
}
await bucket.deleteFiles({ prefix: `attachments/${phone.uid}/` }).catch(() => undefined);
await bucket.deleteFiles({ prefix: `attachments/${reviewer.uid}/${draftId}/` }).catch(() => undefined);
await bucket.deleteFiles({ prefix: `attachments/${officer.uid}/${draftId}/` }).catch(() => undefined);

console.log(`\n  ${pass} passed, ${fail} failed${fail ? `\n  failed: ${failures.join('; ')}` : ''}\n`);
process.exit(fail ? 1 : 0);
