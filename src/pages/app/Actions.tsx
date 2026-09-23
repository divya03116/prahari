import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { ClipboardCheck } from 'lucide-react';

import { useAuth } from '@/auth/AuthProvider';
import { useReportScope } from '@/auth/scope';
import { EditActionDialog } from '@/components/ActionDialogs';
import { ActionStatusBadge, TierBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Select } from '@/components/ui/field';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Pagination, Table, TD, TH, THead, TR } from '@/components/ui/table';
import { usePager } from '@/hooks/data';
import { useReference } from '@/hooks/reference';
import { cn } from '@/lib/cn';
import { daysUntil, formatDate } from '@/lib/format';
import { isOverdue, listActions, type ActionView } from '@/services/actions';
import { scopeKey } from '@/services/scope';
import { LIMITS } from '@/shared/constants';
import type { ActionDoc, WithId } from '@/shared/types';

const VIEWS: { value: ActionView; label: string }[] = [
  { value: 'active', label: 'Open' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'closed', label: 'Closed' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'all', label: 'All' },
];

function DueCell({ a }: { a: WithId<ActionDoc> }) {
  const late = isOverdue(a);
  const d = daysUntil(a.dueAt);
  return (
    <div className="whitespace-nowrap">
      <span className={cn('text-sm', late ? 'text-critical' : 'text-fg-muted')}>{formatDate(a.dueAt)}</span>
      {(a.status === 'open' || a.status === 'in_progress') && d !== null && (
        <span className={cn('block text-xs', late ? 'text-critical' : 'text-fg-subtle')}>
          {late ? `${-d}d overdue` : d === 0 ? 'Due today' : `in ${d}d`}
        </span>
      )}
    </div>
  );
}

export default function Actions() {
  const [params, setParams] = useSearchParams();
  const { can, profile } = useAuth();
  const scope = useReportScope();
  const { installations } = useReference();
  const [editing, setEditing] = useState<WithId<ActionDoc> | null>(null);

  const view = (VIEWS.find((v) => v.value === params.get('view'))?.value ?? 'active') as ActionView;
  const installationId = params.get('installation') || null;
  const filters = { view, installationId };
  const pager = usePager<ActionDoc>(
    (after) => listActions(filters, scope, LIMITS.pageSize, after),
    JSON.stringify({ ...filters, scope: scopeKey(scope) }),
  );

  const officer = can('hse-officer');
  const managerOf = can('installation-manager') ? profile?.installationId ?? null : null;
  const editable = (a: WithId<ActionDoc>) => officer || (managerOf !== null && a.installationId === managerOf && a.status !== 'cancelled');

  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params);
    if (v) next.set(k, v);
    else next.delete(k);
    setParams(next, { replace: true });
  };

  return (
    <>
      <PageHeader
        title="Corrective actions"
        description={
          officer
            ? 'Every control opened against a report. Update status, reassign or reschedule.'
            : scope.kind === 'installation'
              ? 'Every control opened against a report at your installation. You can update them here.'
              : 'The controls opened against your reports, and where each one stands.'
        }
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented label="Action status" value={view} onChange={(v) => set('view', v === 'active' ? null : v)} options={VIEWS} />
        <div className="flex items-center gap-2">
          {scope.kind !== 'installation' && (
            <Select
              aria-label="Installation"
              value={installationId ?? ''}
              onChange={(e) => set('installation', e.target.value || null)}
              className="sm:w-56"
            >
              <option value="">All installations</option>
              {installations.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          )}
        </div>
      </div>

      <Panel>
        {pager.error ? (
          <ErrorState message={pager.error} onRetry={pager.reload} />
        ) : pager.loading && !pager.items.length ? (
          <SkeletonRows rows={8} />
        ) : !pager.items.length ? (
          <EmptyState
            icon={<ClipboardCheck />}
            title={view === 'overdue' ? 'Nothing is overdue' : view === 'active' ? 'No open actions' : 'No actions here'}
            description={
              view === 'active' || view === 'all'
                ? 'Tier 1 and Tier 2 reports open corrective actions automatically when they are scored.'
                : undefined
            }
          />
        ) : (
          <div className={pager.loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <TH>Control</TH>
                  <TH className="hidden md:table-cell">Installation</TH>
                  <TH className="hidden lg:table-cell">Owner</TH>
                  <TH>Status</TH>
                  <TH className="hidden sm:table-cell">Due</TH>
                  <TH className="w-16 px-2 text-right">
                    <span className="sr-only">Actions</span>
                  </TH>
                </tr>
              </THead>
              <tbody>
                {pager.items.map((a) => (
                  <TR key={a.id}>
                    <TD className="max-w-0 min-w-44 sm:min-w-64">
                      <p className="truncate text-fg" title={a.control}>
                        {a.control}
                      </p>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
                        <TierBadge tier={a.tier} compact />
                        <Link to={`/app/reports/${a.reportId}`} className="whitespace-nowrap hover:text-fg hover:underline">
                          View report
                        </Link>
                        <span className="min-w-0 truncate md:hidden">· {a.installationName}</span>
                      </div>
                    </TD>
                    <TD className="hidden whitespace-nowrap md:table-cell">{a.installationName}</TD>
                    <TD className="hidden lg:table-cell">
                      <span className="line-clamp-1">{a.owner}</span>
                    </TD>
                    <TD>
                      <ActionStatusBadge status={a.status} />
                    </TD>
                    <TD className="hidden sm:table-cell">
                      <DueCell a={a} />
                    </TD>
                    <TD className="px-2 text-right">
                      {editable(a) ? (
                        <Button size="xs" onClick={() => setEditing(a)}>
                          Update
                        </Button>
                      ) : null}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {(pager.items.length > 0 || pager.page > 1) && (
          <Pagination page={pager.page} hasNext={pager.hasNext} onPrev={pager.prev} onNext={pager.next} loading={pager.loading} />
        )}
      </Panel>

      <EditActionDialog action={editing} onOpenChange={(o) => !o && setEditing(null)} onSaved={pager.reload} />
    </>
  );
}
