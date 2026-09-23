/**
 * Daily sweep of orphaned attachments.
 *
 * Attachments are uploaded before their report exists (so filing does not wait
 * on the network). If the person abandons the form — closes the tab, loses
 * connection — the browser's own clean-up never runs and the files would stay
 * in Storage forever. This removes files whose report was never filed, once
 * they are old enough that nobody can still be filling in that form.
 */

import { onSchedule } from 'firebase-functions/v2/scheduler';
import { logger } from 'firebase-functions';

import { db, storage } from '../lib/core.js';
import { COLLECTIONS } from '../shared/constants.js';

const GRACE_MS = 24 * 60 * 60 * 1000;

export async function sweepOrphanAttachments(now = Date.now(), graceMs = GRACE_MS): Promise<{ scanned: number; deleted: number }> {
  const [files] = await storage.bucket().getFiles({ prefix: 'attachments/' });
  const byReport = new Map<string, typeof files>();
  for (const f of files) {
    const reportId = f.name.split('/')[2];
    if (!reportId) continue;
    byReport.set(reportId, [...(byReport.get(reportId) ?? []), f]);
  }

  let deleted = 0;
  for (const [reportId, group] of byReport) {
    const old = group.filter((f) => now - new Date(String(f.metadata.timeCreated ?? 0)).getTime() > graceMs);
    if (!old.length) continue;
    if ((await db.collection(COLLECTIONS.reports).doc(reportId).get()).exists) continue;
    await Promise.all(old.map((f) => f.delete({ ignoreNotFound: true })));
    deleted += old.length;
  }
  return { scanned: files.length, deleted };
}

export const cleanupOrphanAttachments = onSchedule({ schedule: 'every 24 hours', timeoutSeconds: 540 }, async () => {
  const result = await sweepOrphanAttachments();
  logger.info('orphan attachment sweep', result);
});
