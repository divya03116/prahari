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
import { formatDateTime, formatRelative } from '@/lib/format';
import { DEFAULT_FILTERS, listReports, type ReportFilters, type ReportSort, type ReportView } from '@/services/reports';
import { scopeKey } from '@/services/scope';
import { LIMITS, REPORT_TYPE_LABEL, type Tier } from '@/shared/constants';
import { queryToken } from '@/shared/search';
import type { ReportDoc, WithId } from '@/shared/types';

const VIEWS: { value: ReportView; label: string; min?: 'hse-officer' }[] = [
  { value: 'active', label: 'Active' },
  { value: 'review', label: 'Awaiting review' },
  { value: 'processing', label: 'Processing' },
  { value: 'mine', label: 'Filed by me' },
  { value: 'archived', label: 'Archived', min: 'hse-officer' },
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
  if (r.archived) return <Badge>Archived</Badge>;
  if (r.status === 'pending') return <Badge tone="info">Scoring…</Badge>;
  if (r.status === 'failed') return <Badge tone="critical">Scoring failed</Badge>;
  if (r.verdict) return <VerdictBadge verdict={r.verdict.decision} />;
  return <span className="text-xs whitespace-nowrap text-fg-subtle">Awaiting review</span>;
}

export default function Reports() {
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const { user, can } = useAuth();
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
        title="Reports"
        description={
          scope.kind === 'all'
            ? 'The register of every unsafe act, unsafe condition and near miss, scored for serious-injury potential.'
            : scope.kind === 'installation'
              ? 'Reports at your installation, scored for serious-injury potential. “Filed by me” also lists yours from other sites.'
              : 'The reports you have filed, scored for serious-injury potential. HSE officers see every report.'
        }
        actions={
          <Link to="/app/reports/new" className={buttonClass({ variant: 'primary' })}>
            <Plus aria-hidden /> New report
          </Link>
        }
      />

      <div className="mb-3">
        <Segmented
          label="Report view"
          value={filters.view}
          onChange={(v) => set({ view: v === 'active' ? null : v })}
          options={views}
        />
      </div>

      <Panel>
        {registerView && (
          <div className="flex flex-col gap-2 border-b border-border p-3 lg:flex-row lg:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-fg-subtle" aria-hidden />
              <Input
                type="search"
                aria-label="Search reports"
                placeholder="Search by word — e.g. scaffold, H2S, crane"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="pl-8"
              />
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:flex">
              <Select aria-label="Tier" value={filters.tier ?? ''} onChange={(e) => set({ tier: e.target.value || null })} className="lg:w-36">
                <option value="">All tiers</option>
                <option value="1">Tier 1 · Critical</option>
                <option value="2">Tier 2 · Elevated</option>
                <option value="3">Tier 3 · Controlled</option>
              </Select>
              {scope.kind !== 'installation' && (
                <Select
                  aria-label="Installation"
                  value={filters.installationId ?? ''}
                  onChange={(e) => set({ installation: e.target.value || null })}
                  className="lg:w-48"
                >
                  <option value="">All installations</option>
                  {installations.map((i) => (
                    <option key={i.id} value={i.id}>
                      {i.name}
                    </option>
                  ))}
                </Select>
              )}
              <Select
                aria-label="Sort"
                value={searching ? 'newest' : filters.sort}
                disabled={searching}
                onChange={(e) => set({ sort: (e.target.value as ReportSort) === 'newest' ? 'newest' : null })}
                className="col-span-2 sm:col-span-1 lg:w-40"
              >
                <option value="priority">Highest potential</option>
                <option value="newest">Newest first</option>
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
                  <X aria-hidden /> Clear
                </Button>
              )}
            </div>
          </div>
        )}
        {searching && filters.view === 'review' && (
          <p className="border-b border-border px-4 py-2 text-xs text-fg-subtle">
            Search covers all active reports, newest first; the review filter does not apply while searching.
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
                ? `No reports contain “${filters.search}”`
                : filters.view === 'review'
                  ? 'Nothing is waiting for review'
                  : filters.view === 'processing'
                    ? 'No reports are being processed'
                    : filters.view === 'archived'
                      ? 'No archived reports'
                      : 'No reports match'
            }
            description={
              filters.search
                ? 'Search matches whole words. Try a different word, or clear the filters.'
                : hasFilters
                  ? 'Try removing a filter.'
                  : filters.view === 'mine'
                    ? 'Reports you file appear here.'
                    : undefined
            }
            action={
              filters.view === 'mine' || (!hasFilters && filters.view === 'active') ? (
                <Link to="/app/reports/new" className={buttonClass({ variant: 'primary', size: 'sm' })}>
                  File a report
                </Link>
              ) : undefined
            }
          />
        ) : (
          <div className={pager.loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <TH className="w-20 pr-2 sm:w-24 sm:pr-4">Score</TH>
                  <TH className="pl-2 sm:pl-4">Report</TH>
                  <TH className="hidden md:table-cell">Installation</TH>
                  <TH className="hidden xl:table-cell">Type</TH>
                  <TH className="hidden xl:table-cell">Review</TH>
                  <TH className="hidden sm:table-cell text-right">Filed</TH>
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
                        <span className="hidden truncate md:inline">{r.activityName} · {r.shift} shift{r.contractor ? ' · Contractor' : ''}</span>
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
                    <TD className="hidden whitespace-nowrap xl:table-cell">{REPORT_TYPE_LABEL[r.type]}</TD>
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
            summary={`Page ${pager.page} · ${pager.items.length} shown`}
          />
        )}
      </Panel>
    </>
  );
}
