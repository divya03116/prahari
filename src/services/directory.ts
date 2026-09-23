/**
 * Users (admin), reference data, audit log and the dashboard roll-ups.
 */

import {
  collection,
  getDocs,
  limit,
  onSnapshot,
  orderBy,
  query,
  where,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';

import { dayKey } from '@/lib/format';
import { firebase } from '@/lib/firebase';
import { COLLECTIONS, type Role } from '@/shared/constants';
import type { ReferenceKind } from '@/shared/schemas';
import type { AuditDoc, DailyStatsDoc, HeatDoc, ReferenceDoc, ReportDoc, UserDoc, WithId } from '@/shared/types';
import { fetchPage, type Cursor, type Page } from './query';

/* ---------------- users ---------------- */

export interface UserFilters {
  role: Role | null;
  /** Email prefix. */
  search: string;
}

export function listUsers(f: UserFilters, pageSize: number, after: Cursor): Promise<Page<UserDoc>> {
  const c: QueryConstraint[] = [];
  if (f.role) c.push(where('role', '==', f.role));
  const prefix = f.search.trim().toLowerCase();
  if (prefix) c.push(where('email', '>=', prefix), where('email', '<=', `${prefix}`));
  c.push(orderBy('email', 'asc'));
  return fetchPage<UserDoc>(query(collection(firebase.db, COLLECTIONS.users), ...c), pageSize, after);
}

/* ---------------- reference data ---------------- */

/**
 * Installations and activities are small, slow-changing lists that every form
 * needs. One live listener each; the persistent cache makes repeat loads free.
 */
export function watchReference(
  kind: ReferenceKind,
  next: (items: WithId<ReferenceDoc>[]) => void,
  error: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(collection(firebase.db, kind), orderBy('name', 'asc'), limit(500)),
    (snap) => next(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ReferenceDoc) }))),
    error,
  );
}

/* ---------------- audit ---------------- */

export function listAudit(action: string | null, pageSize: number, after: Cursor): Promise<Page<AuditDoc>> {
  const c: QueryConstraint[] = [];
  if (action) c.push(where('action', '==', action));
  c.push(orderBy('at', 'desc'));
  return fetchPage<AuditDoc>(query(collection(firebase.db, COLLECTIONS.auditLogs), ...c), pageSize, after);
}

/* ---------------- roll-ups ---------------- */

function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return dayKey(d);
}

/** One document per day for the last `days` days — at most `days` reads. */
export async function dailyStats(days: number): Promise<DailyStatsDoc[]> {
  const snap = await getDocs(
    query(collection(firebase.db, COLLECTIONS.stats), where('day', '>=', daysAgo(days - 1)), orderBy('day', 'asc')),
  );
  return snap.docs.map((d) => d.data() as DailyStatsDoc);
}

/** Daily totals from `startDay` (YYYY-MM-DD) to today — one read per day that had reports. */
export async function dailyStatsFrom(startDay: string): Promise<DailyStatsDoc[]> {
  const snap = await getDocs(
    query(collection(firebase.db, COLLECTIONS.stats), where('day', '>=', startDay), orderBy('day', 'asc')),
  );
  return snap.docs.map((d) => d.data() as DailyStatsDoc);
}

export async function heatSince(days: number): Promise<HeatDoc[]> {
  const snap = await getDocs(
    query(collection(firebase.db, COLLECTIONS.heat), where('day', '>=', daysAgo(days - 1)), orderBy('day', 'asc'), limit(2000)),
  );
  return snap.docs.map((d) => d.data() as HeatDoc);
}

/*
 * The roll-ups above summarise everyone's reports, so only HSE officers and
 * administrators may read them. Everyone else's charts use the same shapes,
 * computed from the reports they can see.
 */
type Summarised = Pick<ReportDoc, 'createdAt' | 'tier' | 'score' | 'installationId' | 'installationName'>;

export function statsFromReports(reports: Summarised[]): DailyStatsDoc[] {
  const by = new Map<string, DailyStatsDoc>();
  for (const r of reports) {
    const day = dayKey(r.createdAt.toDate());
    const cur = by.get(day) ?? { day, total: 0, t1: 0, t2: 0, t3: 0 };
    cur.total += 1;
    if (r.tier === 1) cur.t1 += 1;
    else if (r.tier === 2) cur.t2 += 1;
    else if (r.tier === 3) cur.t3 += 1;
    by.set(day, cur);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function heatFromReports(reports: Summarised[], days: number): HeatDoc[] {
  const from = daysAgo(days - 1);
  const by = new Map<string, HeatDoc>();
  for (const r of reports) {
    const day = dayKey(r.createdAt.toDate());
    if (day < from) continue;
    const key = `${r.installationId}__${day}`;
    const cur = by.get(key) ?? { installationId: r.installationId, installationName: r.installationName, day, peak: 0, count: 0 };
    cur.peak = Math.max(cur.peak, r.score ?? 0);
    cur.count += 1;
    by.set(key, cur);
  }
  return [...by.values()].sort((a, b) => a.day.localeCompare(b.day));
}

export function lastNDays(days: number): string[] {
  return Array.from({ length: days }, (_, i) => daysAgo(days - 1 - i));
}
