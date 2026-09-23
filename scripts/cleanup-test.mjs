#!/usr/bin/env node
/**
 * Verifies the orphan-attachment sweep against the emulator — `npm run test:cleanup`.
 * An abandoned upload must go; a filed report's attachment and a fresh draft
 * (someone may still be filling in the form) must stay.
 */
import { assertEmulatorsUp, bucket, db, tinyPng } from './lib/emulator.mjs';

await assertEmulatorsUp();
const { sweepOrphanAttachments } = await import('../functions/lib/triggers/cleanup.js');

const filed = (await db.collection('reports').where('attachments', '!=', []).limit(1).get()).docs[0];
if (!filed) {
  console.error('\n  No report with an attachment. Run `npm run seed` first.\n');
  process.exit(1);
}
const orphan = `attachments/probe-user/${db.collection('reports').doc().id}/abandoned.png`;
await bucket.file(orphan).save(tinyPng(), { contentType: 'image/png' });

const DAY = 86_400_000;
// "Now" is 25 hours ahead: everything uploaded just now counts as old.
const later = await sweepOrphanAttachments(Date.now() + 25 * 60 * 60 * 1000, DAY);

const exists = async (p) => (await bucket.file(p).exists())[0];
const checks = [
  ['abandoned upload older than a day is deleted', !(await exists(orphan))],
  ['a filed report keeps its attachment', await exists(filed.get('attachments')[0].path)],
];

// And with the real clock, a fresh draft is left alone.
const draft = `attachments/probe-user/${db.collection('reports').doc().id}/in-progress.png`;
await bucket.file(draft).save(tinyPng(), { contentType: 'image/png' });
await sweepOrphanAttachments(Date.now(), DAY);
checks.push(['a draft uploaded moments ago is kept', await exists(draft)]);
await bucket.file(draft).delete({ ignoreNotFound: true });

let fail = 0;
for (const [label, ok] of checks) {
  if (!ok) fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}`);
}
console.log(`\n  sweep scanned ${later.scanned} file(s), deleted ${later.deleted}\n  ${checks.length - fail} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
