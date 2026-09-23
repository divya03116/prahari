import { useMemo } from 'react';

import type { ReportScope } from '@/services/scope';
import { useAuth } from './AuthProvider';

/** The signed-in person's report visibility (see services/scope.ts). */
export function useReportScope(): ReportScope {
  const { user, can, profile } = useAuth();
  const officer = can('hse-officer');
  const managed = !officer && can('installation-manager') ? (profile?.installationId ?? null) : null;
  const uid = user?.uid ?? '';
  return useMemo<ReportScope>(
    () => (officer ? { kind: 'all' } : managed ? { kind: 'installation', installationId: managed } : { kind: 'own', uid }),
    [officer, managed, uid],
  );
}
