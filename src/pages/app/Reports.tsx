import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { FileText, Plus, Search, X } from 'lucide-react';

import { useAuth } from '@/auth/AuthProvider';
import { useReportScope } from '@/auth/scope';
import { ScoreCell } from '@/components/assessment';
import { Badge, TierBadge, VerdictBadge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Input, Select } from '@/components/ui/field';
import { PageHeader, Segmented } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Pagination, Table, TD, TH, THead, TR } from '@/components/ui/table';
import { useDebounced, usePager } from '@/hooks/data';
import { useReference } from '@/hooks/reference';
import { useI18n, type MessageKey } from '@/i18n';
import { reportTypeKey, shiftKey, tierKey } from '@/i18n/labels';
import { formatDateTime, formatRelative } from '@/lib/format';
import { DEFAULT_FILTERS, listReports, type ReportFilters, type ReportSort, type ReportView } from '@/services/reports';
import { scopeKey } from '@/services/scope';
import { LIMITS, type Tier } from '@/shared/constants';
import { queryToken } from '@/shared/search';
import type { ReportDoc, WithId } from '@/shared/types';

const VIEWS: { value: ReportView; label: MessageKey; min?: 'hse-officer' }[] = [
  { value: 'active', label: 'reports.view.active' },
  { value: 'review', label: 'reports.view.review' },
  { value: 'processing', label: 'reports.view.processing' },
  { value: 'mine', label: 'reports.view.mine' },
  { value: 'archived', label: 'reports.view.archived', min: 'hse-officer' },
];

function readFilters(p: URLSearchParams): ReportFilters {
  const view = (VIEWS.find((v) => v.value === p.get('view'))?.value ?? 'active') as ReportView;
  const tierN = Number(p.get('tier'));
  return {
    view,
    tier: tierN === 1 || tierN === 2 || tierN === 3 ? (tierN as Tier) : null,
    installationId: p.get('installation') || null,
    search: p.get('q') ?? '',
    sort: p.get('sort') === 'newest' ? 'newest' : DEFAULT_FILTERS.sort,
  };
}

function StatusCell({ r }: { r: WithId<ReportDoc> }) {
  const { t } = useI18n();
  if (r.archived) return <Badge>{t('reports.view.archived')}</Badge>;
  if (r.status === 'pending') return <Badge tone="info">{t('reports.status.scoring')}</Badge>;
  if (r.status === 'failed') return <Badge tone="critical">{t('reports.status.failed')}</Badge>;
  if (r.verdict) return <VerdictBadge verdict={r.verdict.decision} />;
  return <span className="text-xs whitespace-nowrap text-fg-subtle">{t('reports.view.review')}</span>;
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();
  const { t } = useI18n();
  const scope = useReportScope();
  const { installations } = useReference();
  const filters = readFilters(params);
  const [searchInput, setSearchInput] = useState(filters.search);
  const debounced = useDebounced(searchInput, 350);

  const set = (patch: Record<string, string | null>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) {
      if (v === null || v === '') next.delete(k);
      else next.set(k, v);
    }
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (debounced !== filters.search) set({ q: debounced || null });
  }, [debounced]);

  const registerView = filters.view === 'active' || filters.view === 'review';
  const searching = registerView && Boolean(queryToken(filters.search));
  const key = JSON.stringify({ ...filters, search: queryToken(filters.search) ?? '', scope: scopeKey(scope) });
  const pager = usePager<ReportDoc>((after) => listReports(filters, user!.uid, scope, LIMITS.pageSize, after), key);

  const hasFilters = Boolean(filters.tier || filters.installationId || filters.search || params.get('sort'));
  // Everything a reviewer sees is already theirs, so "Filed by me" would repeat the list.
  const views = VIEWS.filter((v) => (!v.min || can(v.min)) && !(scope.kind === 'own' && v.value === 'mine'));

  return (
    <>
      <PageHeader
        title={t('nav.reports')}
        description={scope.kind === 'all' ? t('reports.desc.all') : scope.kind === 'installation' ? t('reports.desc.installation') : t('reports.desc.own')}
        actions={
          <Link to="/app/reports/new" className={buttonClass({ variant: 'primary' })}>
            <Plus aria-hidden /> {t('nav.newReport')}
          </Link>
        }
      />

      <div className="mb-3">
        <Segmented
          label={t('reports.viewLabel')}
          value={filters.view}
          onChange={(v) => set({ view: v === 'active' ? null : v })}
          options={views.map((v) => ({ value: v.value, label: t(v.label) }))}
        />
      </div>

      <Panel>
        {registerView && (
          <div className="flex flex-col gap-2 border-b border-border p-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input
                type="search"
                aria-label={t('reports.search')}
                placeholder={t('reports.searchPlaceholder')}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
              <Select aria-label={t('reports.tier')} value={filters.tier ?? ''} onChange={(e) => set({ tier: e.target.value || null })} className="lg:w-36">
                <option value="">{t('reports.allTiers')}</option>
                {([1, 2, 3] as const).map((tier) => (
                  <option key={tier} value={tier}>
                    {t('tier.label', { tier, label: t(tierKey(tier)) })}
                  </option>
                ))}
              </Select>
              {scope.kind !== 'installation' && (
                <Select
                  aria-label={t('reports.installation')}
                  value={filters.installationId ?? ''}
                  onChange={(e) => set({ installation: e.target.value || null })}
                  className="lg:w-48"
                >
                  <option value="">{t('reports.allInstallations')}</option>
                  {installations.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                aria-label={t('reports.sort')}
                value={searching ? 'newest' : filters.sort}
                disabled={searching}
                onChange={(e) => set({ sort: (e.target.value as ReportSort) === 'newest' ? 'newest' : null })}
                className="col-span-2 sm:col-span-1 lg:w-40"
              >
                <option value="priority">{t('reports.sort.priority')}</option>
                <option value="newest">{t('reports.sort.newest')}</option>
              </Select>
              {hasFilters && (
                <Button
                  variant="ghost"
                  className="col-span-2 sm:col-span-3 lg:col-span-1"
                  onClick={() => {
                    setSearchInput('');
                    set({ tier: null, installation: null, q: null, sort: null });
                  }}
                >
                  <X aria-hidden /> {t('common.clear')}
                </Button>
              )}
            </div>
          </div>
        )}
        {searching && filters.view === 'review' && (
          <p className="border-b border-border px-4 py-2 text-xs text-fg-subtle">
            {t('reports.searchNote')}
          </p>
        )}

        {pager.error ? (
          <ErrorState message={pager.error} onRetry={pager.reload} />
        ) : pager.loading && !pager.items.length ? (
          <SkeletonRows rows={8} />
        ) : !pager.items.length ? (
          <EmptyState
            icon={<FileText />}
            title={
              filters.search
                ? t('reports.empty.search', { query: filters.search })
                : filters.view === 'review'
                  ? t('reports.empty.review')
                  : filters.view === 'processing'
                    ? t('reports.empty.processing')
                    : filters.view === 'archived'
                      ? t('reports.empty.archived')
                      : t('reports.empty.none')
            }
            description={
              filters.search
                ? t('reports.empty.searchHint')
                : hasFilters
                  ? t('reports.empty.filterHint')
                  : filters.view === 'mine'
                    ? t('reports.empty.mineHint')
                    : undefined
            }
            action={
              filters.view === 'mine' || (!hasFilters && filters.view === 'active') ? (
                <Link to="/app/reports/new" className={buttonClass({ variant: 'primary', size: 'sm' })}>
                  {t('reports.file')}
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className={pager.loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <TH className="w-20 pr-2 sm:w-24 sm:pr-4">{t('reports.col.score')}</TH>
                  <TH className="pl-2 sm:pl-4">{t('reports.col.report')}</TH>
                  <TH className="hidden md:table-cell">{t('reports.installation')}</TH>
                  <TH className="hidden xl:table-cell">{t('quick.type')}</TH>
                  <TH className="hidden xl:table-cell">{t('reports.col.review')}</TH>
                  <TH className="hidden sm:table-cell text-right">{t('reports.col.filed')}</TH>
                </tr>
              </THead>
              <tbody>
                {pager.items.map((r) => (
                  <TR key={r.id} interactive onClick={() => navigate(`/app/reports/${r.id}`)}>
                    <TD className="pr-2 sm:pr-4">
                      {r.status === 'scored' ? <ScoreCell score={r.score} tier={r.tier} /> : <StatusCell r={r} />}
                    </TD>
                    <TD className="max-w-0 min-w-44 pl-2 sm:min-w-56 sm:pl-4">
                      <Link
                        to={`/app/reports/${r.id}`}
                        onClick={(e) => e.stopPropagation()}
                        className="block truncate text-fg hover:underline"
                      >
                        {r.text}
                      </Link>
                      <div className="mt-0.5 flex items-center gap-2 text-xs text-fg-subtle">
                        {r.tier && <TierBadge tier={r.tier} compact />}
                        <span className="truncate md:hidden">{r.installationName}</span>
                        <span className="hidden truncate md:inline">
                          {r.activityName} · {t('reports.shiftLabel', { shift: t(shiftKey(r.shift)) })}
                          {r.contractor ? ` · ${t('reports.contractor')}` : ''}
                        </span>
                        {r.verdict && (
                          <span className="xl:hidden">
                            <VerdictBadge verdict={r.verdict.decision} />
                          </span>
                        )}
                      </div>
                    </TD>
                    <TD className="hidden md:table-cell">
                      <span className="block max-w-52 truncate" title={r.installationName}>
                        {r.installationName}
                      </span>
                    </TD>
                    <TD className="hidden whitespace-nowrap xl:table-cell">{t(reportTypeKey(r.type))}</TD>
                    <TD className="hidden whitespace-nowrap xl:table-cell">
                      <StatusCell r={r} />
                    </TD>
                    <TD className="hidden text-right whitespace-nowrap sm:table-cell" title={formatDateTime(r.createdAt)}>
                      {formatRelative(r.createdAt)}
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {(pager.items.length > 0 || pager.page > 1) && (
          <Pagination
            page={pager.page}
            hasNext={pager.hasNext}
            onPrev={pager.prev}
            onNext={pager.next}
            loading={pager.loading}
            summary={t('reports.pageSummary', { page: pager.page, count: pager.items.length })}
          />
        )}
      </Panel>
    </>
  );
}
