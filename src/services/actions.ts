import {
  collection,
  onSnapshot,
  orderBy,
  query,
  Timestamp,
  where,
  type QueryConstraint,
  type Unsubscribe,
} from 'firebase/firestore';

import { firebase } from '@/lib/firebase';
import { COLLECTIONS } from '@/shared/constants';
import type { ActionDoc, WithId } from '@/shared/types';
import { count, fetchPage, type Cursor, type Page } from './query';
import { scopeConstraints, type ReportScope } from './scope';

export type ActionView = 'active' | 'overdue' | 'closed' | 'cancelled' | 'all';

export interface ActionFilters {
  view: ActionView;
  installationId: string | null;
}

const actions = () => collection(firebase.db, COLLECTIONS.actions);
const ACTIVE = ['open', 'in_progress'];

/**
 * Matching composite indexes: scripts/gen-indexes.mjs, "actions". Limited to
 * the actions of reports the person may see (ReportScope).
 */
export function actionConstraints(f: ActionFilters, scope: ReportScope, now = Timestamp.now()): QueryConstraint[] {
  const c: QueryConstraint[] = [...scopeConstraints(scope)];
  // A manager's scope already fixes the installation.
  if (f.installationId && scope.kind !== 'installation') c.push(where('installationId', '==', f.installationId));
  switch (f.view) {
    case 'active':
      c.push(where('status', 'in', ACTIVE), orderBy('dueAt', 'asc'));
      break;
    case 'overdue':
      c.push(where('status', 'in', ACTIVE), where('dueAt', '<', now), orderBy('dueAt', 'asc'));
      break;
    case 'closed':
      c.push(where('status', '==', 'closed'), orderBy('updatedAt', 'desc'));
      break;
    case 'cancelled':
      c.push(where('status', '==', 'cancelled'), orderBy('updatedAt', 'desc'));
      break;
    case 'all':
      c.push(orderBy('dueAt', 'asc'));
      break;
  }
  return c;
}

export function listActions(f: ActionFilters, scope: ReportScope, pageSize: number, after: Cursor): Promise<Page<ActionDoc>> {
  return fetchPage<ActionDoc>(query(actions(), ...actionConstraints(f, scope)), pageSize, after);
}

export function watchReportActions(
  reportId: string,
  scope: ReportScope,
  next: (items: WithId<ActionDoc>[]) => void,
  error: (err: Error) => void,
): Unsubscribe {
  return onSnapshot(
    query(actions(), where('reportId', '==', reportId), ...scopeConstraints(scope), orderBy('order', 'asc')),
    (snap) => next(snap.docs.map((d) => ({ id: d.id, ...(d.data() as ActionDoc) }))),
    error,
  );
}

export async function actionCounts(scope: ReportScope, installationId: string | null = null): Promise<{ open: number; overdue: number }> {
  const [open, overdue] = await Promise.all([
    count(query(actions(), ...actionConstraints({ view: 'active', installationId }, scope))),
    count(query(actions(), ...actionConstraints({ view: 'overdue', installationId }, scope))),
  ]);
  return { open, overdue };
}

export function isOverdue(a: Pick<ActionDoc, 'status' | 'dueAt'>, now = Date.now()): boolean {
  return (a.status === 'open' || a.status === 'in_progress') && a.dueAt.toMillis() < now;
}
