#!/usr/bin/env node
/**
 * Bootstraps the FIRST administrator of a real Firebase project.
 *
 * Roles can only be changed by an administrator (the setUserRole callable),
 * so a fresh project needs one person promoted out-of-band. This does that
 * once, with YOUR Google credentials — nothing is stored in the repo:
 *
 *   gcloud auth application-default login
 *   node scripts/grant-admin.mjs --project <firebase-project-id> <email>
 *
 * The person must already have signed up in the app. They must sign out and
 * back in afterwards to receive a token carrying the new role.
 */

import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const projectIdx = args.indexOf('--project');
const projectId = projectIdx >= 0 ? args[projectIdx + 1] : null;
const email = args.filter((a, i) => i !== projectIdx && i !== projectIdx + 1)[0];

if (!projectId || !email) {
  console.error('\n  Usage: node scripts/grant-admin.mjs --project <firebase-project-id> <email>\n');
  process.exit(1);
}
for (const v of ['FIRESTORE_EMULATOR_HOST', 'FIREBASE_AUTH_EMULATOR_HOST']) {
  if (process.env[v]) {
    console.error(`\n  ${v} is set, so this would target the emulator. Unset it (or use npm run seed locally).\n`);
    process.exit(1);
  }
}

const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp, applicationDefault } = require('firebase-admin/app');
const { getAuth } = require('firebase-admin/auth');
const { getFirestore, FieldValue } = require('firebase-admin/firestore');

initializeApp({ credential: applicationDefault(), projectId });
const auth = getAuth();
const db = getFirestore();

try {
  const user = await auth.getUserByEmail(email);
  await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), role: 'admin' });
  await db.collection('users').doc(user.uid).set({ role: 'admin', disabled: false }, { merge: true });
  await db.collection('auditLogs').add({
    action: 'user.role',
    actorUid: null,
    actorName: 'grant-admin bootstrap script',
    target: user.uid,
    detail: { role: 'admin', email },
    at: FieldValue.serverTimestamp(),
  });
  console.log(`\n  ${email} is now an administrator of ${projectId}.`);
  console.log('  Ask them to sign out and sign back in.\n');
  process.exit(0);
} catch (err) {
  console.error(`\n  Failed: ${err.message}`);
  if (/no user record/i.test(err.message)) console.error('  The person must sign up in the app first.');
  if (/credential|default credentials/i.test(err.message)) console.error('  Run: gcloud auth application-default login');
  console.error('');
  process.exit(1);
}
