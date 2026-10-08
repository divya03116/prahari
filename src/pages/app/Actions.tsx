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
import { useI18n, type MessageKey } from '@/i18n';
import { cn } from '@/lib/cn';
import { daysUntil, formatDate } from '@/lib/format';
import { isOverdue, listActions, type ActionView } from '@/services/actions';
import { scopeKey } from '@/services/scope';
import { LIMITS } from '@/shared/constants';
import type { ActionDoc, WithId } from '@/shared/types';

const VIEWS: { value: ActionView; label: MessageKey }[] = [
  { value: 'active', label: 'actions.view.active' },
  { value: 'overdue', label: 'actions.view.overdue' },
  { value: 'closed', label: 'actions.view.closed' },
  { value: 'cancelled', label: 'actions.view.cancelled' },
  { value: 'all', label: 'actions.view.all' },
];

function DueCell({ a }: { a: WithId<ActionDoc> }) {
  const { t } = useI18n();
  const late = isOverdue(a);
  const d = daysUntil(a.dueAt);
  return (
    <div className="whitespace-nowrap">
      <span className={cn('text-sm', late ? 'text-critical' : 'text-fg-muted')}>{formatDate(a.dueAt)}</span>
      {(a.status === 'open' || a.status === 'in_progress') && d !== null && (
        <span className={cn('block text-xs', late ? 'text-critical' : 'text-fg-subtle')}>
          {late ? t('detail.overdue', { days: -d }) : d === 0 ? t('actions.dueToday') : t('actions.inDays', { days: d })}
        </span>
      )}
    </div>
  );
}

export default function Actions() {
  const [params, setParams] = useSearchParams();
  const { can, profile } = useAuth();
  const { t } = useI18n();
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
        title={t('nav.actions')}
        description={officer ? t('actions.desc.officer') : scope.kind === 'installation' ? t('actions.desc.installation') : t('actions.desc.own')}
      />

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented
          label={t('actions.statusLabel')}
          value={view}
          onChange={(v) => set('view', v === 'active' ? null : v)}
          options={VIEWS.map((v) => ({ value: v.value, label: t(v.label) }))}
        />
        <div className="flex items-center gap-2">
          {scope.kind !== 'installation' && (
            <Select
              aria-label={t('reports.installation')}
              value={installationId ?? ''}
              onChange={(e) => set('installation', e.target.value || null)}
              className="sm:w-56"
            >
              <option value="">{t('reports.allInstallations')}</option>
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
            title={view === 'overdue' ? t('actions.empty.overdue') : view === 'active' ? t('actions.empty.active') : t('actions.empty.none')}
            description={
              view === 'active' || view === 'all' ? t('actions.empty.desc') : undefined
            }
          />
        ) : (
          <div className={pager.loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <TH>{t('action.control')}</TH>
                  <TH className="hidden md:table-cell">{t('reports.installation')}</TH>
                  <TH className="hidden lg:table-cell">{t('action.owner')}</TH>
                  <TH>{t('action.status')}</TH>
                  <TH className="hidden sm:table-cell">{t('actions.col.due')}</TH>
                  <TH className="w-16 px-2 text-right">
                    <span className="sr-only">{t('actions.col.actions')}</span>
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
                          {t('actions.viewReport')}
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
                          {t('common.update')}
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
