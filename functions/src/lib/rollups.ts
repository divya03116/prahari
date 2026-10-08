/**
 * Side effects of a report being scored, re-scored or archived: engine-drafted
 * corrective actions, the daily totals (stats/{day}) and the per-installation
 * daily peak (heat/{installationId__day}). Kept in one place so the trigger,
 * rescoreReport and archiveReport can never disagree about what they mean.
 */

import { Timestamp, type WriteBatch } from 'firebase-admin/firestore';

import { COLLECTIONS } from '../shared/constants.js';
import type { CapaStep, Tier } from '../shared/engine.js';
import { db, FieldValue } from './core.js';

const DAY = 86_400_000;

export function openEngineActions(
  batch: WriteBatch,
  p: {
    reportId: string;
    reportedBy: string | null;
    installationId: string;
    installationName: string;
    tier: Tier;
    capa: CapaStep[];
    created: Date;
  },
): void {
  p.capa.forEach((step, i) => {
    batch.set(db.collection(COLLECTIONS.actions).doc(), {
      reportId: p.reportId,
      reportedBy: p.reportedBy,
      installationId: p.installationId,
      installationName: p.installationName,
      tier: p.tier,
      order: i + 1,
      control: step.control,
      rationale: step.rationale,
      owner: step.owner,
      dueAt: Timestamp.fromMillis(p.created.getTime() + step.dueInDays * DAY),
      status: 'open',
      source: 'engine',
      note: '',
      createdAt: FieldValue.serverTimestamp(),
      updatedAt: FieldValue.serverTimestamp(),
      closedAt: null,
      closedBy: null,
    });
  });
}

/** Adds (delta 1) or removes (delta -1) one report of `tier` from a day's totals. */
export function bumpDaily(batch: WriteBatch, day: string, tier: number, delta: 1 | -1): void {
  batch.set(
    db.collection(COLLECTIONS.stats).doc(day),
    { day, total: FieldValue.increment(delta), [`t${tier}`]: FieldValue.increment(delta) },
    { merge: true },
  );
}

/** Moves one report from one tier to another within a day, total unchanged. */
export function shiftDaily(batch: WriteBatch, day: string, from: number, to: number): void {
  if (from === to) return;
  batch.set(
    db.collection(COLLECTIONS.stats).doc(day),
    { day, [`t${from}`]: FieldValue.increment(-1), [`t${to}`]: FieldValue.increment(1) },
    { merge: true },
  );
}

/** Folds one newly scored report into its installation's daily peak. */
export async function addToHeat(installationId: string, installationName: string, day: string, score: number): Promise<void> {
  const ref = db.collection(COLLECTIONS.heat).doc(`${installationId}__${day}`);
  // A peak is a max, not a sum, so it needs a transaction rather than an increment.
  await db.runTransaction(async (tx) => {
    const cur = await tx.get(ref);
    if (!cur.exists) {
      tx.set(ref, { installationId, installationName, day, peak: score, count: 1 });
    } else {
      tx.update(ref, {
        peak: Math.max(Number(cur.get('peak') ?? 0), score),
        count: Number(cur.get('count') ?? 0) + 1,
      });
    }
  });
}

/**
 * Rebuilds one installation-day from the reports themselves. Used when a
 * score goes down or a report is archived — a max cannot be decremented.
 * Bounded to a single installation and a single day.
 */
export async function recomputeHeat(installationId: string, installationName: string, day: string): Promise<void> {
  const start = new Date(`${day}T00:00:00.000Z`);
  const end = new Date(start.getTime() + DAY);
  const snap = await db
    .collection(COLLECTIONS.reports)
    .where('archived', '==', false)
    .where('status', '==', 'scored')
    .where('installationId', '==', installationId)
    .where('createdAt', '>=', Timestamp.fromDate(start))
    .where('createdAt', '<', Timestamp.fromDate(end))
    .orderBy('createdAt', 'desc')
    .get();

  const ref = db.collection(COLLECTIONS.heat).doc(`${installationId}__${day}`);
  if (snap.empty) {
    await ref.delete();
    return;
  }
  const peak = Math.max(...snap.docs.map((d) => Number(d.get('score') ?? 0)));
  await ref.set({ installationId, installationName, day, peak, count: snap.size });
}
