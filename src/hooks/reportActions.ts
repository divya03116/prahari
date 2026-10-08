import { useAuth } from '@/auth/AuthProvider';
import { useReportScope } from '@/auth/scope';
import { watchReportActions } from '@/services/actions';
import { scopeKey, type ReportScope } from '@/services/scope';
import type { ActionDoc, ReportDoc, WithId } from '@/shared/types';

import { useLive } from './data';

/** A report's corrective actions, live, limited to what this person may see. */
export function useReportActions(report: WithId<ReportDoc>) {
  const { user } = useAuth();
  const scope = useReportScope();
  // Your own report's actions are always visible to you, whatever your wider scope.
  const actionScope: ReportScope = scope.kind !== 'all' && user && report.reportedBy === user.uid ? { kind: 'own', uid: user.uid } : scope;
  return useLive<WithId<ActionDoc>[]>(
    (next, err) => watchReportActions(report.id, actionScope, next, err),
    [report.id, scopeKey(actionScope)],
  );
}
