#!/usr/bin/env node
/**
 * One-off migration for databases created before report visibility existed.
 *
 * Corrective actions now carry `reportedBy` (their report's author) so the
 * Firestore rules can show people the actions on their own reports. Actions
 * written before that change have no such field and would stay invisible to
 * their reporter. This copies it across, in batches, and changes nothing else.
 *
 *   # local emulator (npm run emulators in another terminal)
 *   node scripts/backfill-action-reporters.mjs
 *
 *   # a real project
 *   gcloud auth application-default login
 *   node scripts/backfill-action-reporters.mjs --project <firebase-project-id>
 *
 * Add --dry-run to report what would change without writing.
 */

import { createRequire } from 'node:module';

const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const projectIdx = args.indexOf('--project');
const projectId = projectIdx >= 0 ? args[projectIdx + 1] : null;

if (!projectId) {
  // Local run: force the emulator, exactly like the seed and test scripts.
  process.env.FIRESTORE_EMULATOR_HOST = '127.0.0.1:8085';
  process.env.GCLOUD_PROJECT = 'demo-prahari';
} else if (process.env.FIRESTORE_EMULATOR_HOST) {
  console.error('\n  FIRESTORE_EMULATOR_HOST is set, so this would target the emulator. Unset it.\n');
  process.exit(1);
}

// firebase-admin is a functions/ dependency, never a web-app one.
const require = createRequire(new URL('../functions/package.json', import.meta.url));
const { initializeApp } = require('firebase-admin/app');
const { getFirestore } = require('firebase-admin/firestore');

initializeApp({ projectId: projectId ?? 'demo-prahari' });
const db = getFirestore();

const reporters = new Map();
async function reporterOf(reportId) {
  if (!reporters.has(reportId)) {
    const snap = await db.collection('reports').doc(reportId).get();
    reporters.set(reportId, snap.exists ? (snap.get('reportedBy') ?? null) : null);
  }
  return reporters.get(reportId);
}

const actions = await db.collection('actions').get();
let updated = 0;
let orphaned = 0;
let batch = db.batch();
let inBatch = 0;

for (const doc of actions.docs) {
  if (typeof doc.get('reportedBy') === 'string') continue;
  const uid = await reporterOf(doc.get('reportId'));
  if (!uid) {
    orphaned++;
    continue;
  }
  updated++;
  if (dryRun) continue;
  batch.update(doc.ref, { reportedBy: uid });
  if (++inBatch === 400) {
    await batch.commit();
    batch = db.batch();
    inBatch = 0;
  }
}
if (!dryRun && inBatch) await batch.commit();

console.log(
  `\n  ${actions.size} actions · ${updated} ${dryRun ? 'would be updated' : 'updated'}` +
    `${orphaned ? ` · ${orphaned} skipped (their report is gone)` : ''}\n`,
);
process.exit(0);
