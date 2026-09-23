import { useMemo } from 'react';
import { Link } from 'react-router-dom';
import { LineChart } from 'lucide-react';

import { useAuth } from '@/auth/AuthProvider';
import { useReportScope } from '@/auth/scope';
import { ProportionBars } from '@/components/charts';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { PageHeader } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { Tooltip } from '@/components/ui/menu';
import { useAsync } from '@/hooks/data';
import { useReference } from '@/hooks/reference';
import { cn } from '@/lib/cn';
import { formatShortDate } from '@/lib/format';
import { heatFromReports, heatSince, lastNDays } from '@/services/directory';
import { recentScored } from '@/services/reports';
import { scopeKey } from '@/services/scope';
import { VERDICT_LABEL, VERDICTS } from '@/shared/constants';
import type { ReportDoc, WithId } from '@/shared/types';

const HEAT_DAYS = 14;
const SAMPLE = 200;

function heatColor(peak: number): string {
  const tier = peak >= 70 ? 'critical' : peak >= 40 ? 'warning' : 'success';
  const alpha = 0.25 + Math.min(1, peak / 100) * 0.75;
  return `color-mix(in srgb, var(--color-${tier}) ${Math.round(alpha * 100)}%, transparent)`;
}

function HeatGrid() {
  const { profile } = useAuth();
  const { installations } = useReference();
  // Officers read the site-wide roll-up; everyone else's grid comes from their own reports.
  const scope = useReportScope();
  const sk = scopeKey(scope);
  const everything = scope.kind === 'all';
  const rollup = useAsync(() => (everything ? heatSince(HEAT_DAYS) : Promise.resolve([])), [sk]);
  const own = useAsync(() => (everything ? Promise.resolve([]) : recentScored(500, scope)), [sk]);
  const heat = everything
    ? rollup
    : { data: own.data && heatFromReports(own.data, HEAT_DAYS), loading: own.loading, error: own.error, reload: own.reload };
  const days = useMemo(() => lastNDays(HEAT_DAYS), []);

  const rows = useMemo(() => {
    const cell = new Map((heat.data ?? []).map((h) => [`${h.installationId}__${h.day}`, h]));
    const ids = new Set((heat.data ?? []).map((h) => h.installationId));
    const named = installations.filter((i) => i.active || ids.has(i.id));
    return named
      .map((i) => ({
        id: i.id,
        name: i.name,
        cells: days.map((d) => cell.get(`${i.id}__${d}`) ?? null),
      }))
      .sort((a, b) => Math.max(0, ...b.cells.map((c) => c?.peak ?? 0)) - Math.max(0, ...a.cells.map((c) => c?.peak ?? 0)));
  }, [heat.data, installations, days]);

  return (
    <Panel>
      <PanelHeader
        title="Heat by installation"
        description={`Peak SIF potential per day · last ${HEAT_DAYS} days`}
        actions={
          <div className="hidden items-center gap-3 text-xs text-fg-subtle sm:flex">
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-critical" />≥ 70</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-warning" />40–69</span>
            <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-[2px] bg-success" />&lt; 40</span>
          </div>
        }
      />
      {heat.loading ? (
        <PanelBody>
          <Skeleton className="h-40" />
        </PanelBody>
      ) : heat.error ? (
        <ErrorState message={heat.error} onRetry={heat.reload} />
      ) : !rows.length ? (
        <EmptyState title="No installations yet" description="An administrator adds installations under Reference data." />
      ) : (
        <div className="overflow-x-auto p-4">
          <table className="w-full min-w-[640px] border-separate border-spacing-1 text-xs">
            <thead>
              <tr>
                <th scope="col" className="w-44 text-left font-medium text-fg-subtle">
                  Installation
                </th>
                {days.map((d, i) => (
                  <th key={d} scope="col" className="font-normal text-fg-subtle">
                    {i % 2 === (HEAT_DAYS - 1) % 2 ? formatShortDate(new Date(`${d}T00:00:00Z`)) : ''}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <th scope="row" className="pr-2 text-left font-normal">
                    <Link
                      to={`/app/reports?installation=${encodeURIComponent(r.id)}`}
                      className={cn('block truncate hover:underline', r.id === profile?.installationId ? 'font-medium text-signal' : 'text-fg-muted')}
                    >
                      {r.name}
                    </Link>
                  </th>
                  {r.cells.map((c, i) =>
                    c ? (
                      <td key={i} className="p-0">
                        <Tooltip content={`${formatShortDate(new Date(`${c.day}T00:00:00Z`))}: peak ${c.peak}, ${c.count} report${c.count === 1 ? '' : 's'}`}>
                          <div
                            tabIndex={0}
                            aria-label={`${r.name}, ${c.day}: peak ${c.peak}, ${c.count} reports`}
                            className="flex h-7 items-center justify-center rounded-[3px] font-medium text-fg tabular"
                            style={{ background: heatColor(c.peak) }}
                          >
                            {c.peak}
                          </div>
                        </Tooltip>
                      </td>
                    ) : (
                      <td key={i} className="p-0">
                        <div className="h-7 rounded-[3px] bg-surface-2" aria-hidden />
                      </td>
                    ),
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Panel>
  );
}

interface Pattern {
  key: string;
  label: string;
  count: number;
  avg: number;
}

function analysePatterns(reports: WithId<ReportDoc>[]) {
  const energy = new Map<string, { label: string; n: number }>();
  const barrier = new Map<string, { label: string; n: number }>();
  const pairs = new Map<string, { label: string; n: number; sum: number }>();
  let rules = 0;
  const verdicts = new Map<string, number>();

  for (const r of reports) {
    const e = r.energy?.[0];
    const b = r.barrier?.[0];
    if (e) energy.set(e.id, { label: e.label, n: (energy.get(e.id)?.n ?? 0) + 1 });
    if (b) barrier.set(b.id, { label: b.label, n: (barrier.get(b.id)?.n ?? 0) + 1 });
    if (e && b) {
      const k = `${e.id}+${b.id}`;
      const cur = pairs.get(k) ?? { label: `${e.short || e.label} with ${b.short?.toLowerCase() || b.label.toLowerCase()}`, n: 0, sum: 0 };
      cur.n += 1;
      cur.sum += r.score ?? 0;
      pairs.set(k, cur);
    }
    if (r.rulesTriggered?.length) rules += 1;
    if (r.verdictDecision) verdicts.set(r.verdictDecision, (verdicts.get(r.verdictDecision) ?? 0) + 1);
  }

  const top = (m: Map<string, { label: string; n: number }>) =>
    [...m.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 6).map(([key, v]) => ({ key, label: v.label, count: v.n }));

  const signatures: Pattern[] = [...pairs.entries()]
    .filter(([, v]) => v.n >= 2)
    .sort((a, b) => b[1].n - a[1].n || b[1].sum / b[1].n - a[1].sum / a[1].n)
    .slice(0, 8)
    .map(([key, v]) => ({ key, label: v.label, count: v.n, avg: Math.round(v.sum / v.n) }));

  return { energy: top(energy), barrier: top(barrier), signatures, rules, verdicts };
}

function RankList({ items, total }: { items: { key: string; label: string; count: number }[]; total: number }) {
  if (!items.length) return <p className="text-sm text-fg-subtle">Nothing detected yet.</p>;
  const max = items[0].count;
  return (
    <ul className="flex flex-col gap-3">
      {items.map((i) => (
        <li key={i.key}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate text-fg-muted">{i.label}</span>
            <span className="shrink-0 text-fg tabular">
              {i.count} <span className="text-xs text-fg-subtle">· {Math.round((i.count / total) * 100)}%</span>
            </span>
          </div>
          <div className="h-1 overflow-hidden rounded-full bg-surface-3">
            <div className="h-full rounded-full bg-fg-subtle" style={{ width: `${(i.count / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default function Insights() {
  const scope = useReportScope();
  const sample = useAsync(() => recentScored(SAMPLE, scope), [scopeKey(scope)]);
  const patterns = useMemo(() => analysePatterns(sample.data ?? []), [sample.data]);
  const n = sample.data?.length ?? 0;
  const reviewed = [...patterns.verdicts.values()].reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader
        title="Insights"
        description={
          scope.kind === 'own'
            ? 'Patterns in the reports you have filed: where serious-injury potential concentrates, and what keeps recurring.'
            : 'Where serious-injury potential is concentrating, and which combinations of hazard and failed control keep recurring.'
        }
      />

      <div className="flex flex-col gap-6">
        <HeatGrid />

        {sample.loading ? (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
            <Skeleton className="h-64" />
            <Skeleton className="h-64" />
          </div>
        ) : sample.error ? (
          <Panel>
            <ErrorState message={sample.error} onRetry={sample.reload} />
          </Panel>
        ) : n === 0 ? (
          <Panel>
            <EmptyState icon={<LineChart />} title="Not enough data yet" description="Patterns appear once reports have been scored." />
          </Panel>
        ) : (
          <>
            <p className="-mb-3 text-xs text-fg-subtle">
              Based on the {n} most recent scored reports{n === SAMPLE ? ` (a bounded sample, to keep this page to ${SAMPLE} reads)` : ''}.
            </p>
            <Panel>
              <PanelHeader
                title="Recurring signatures"
                description="The same hazardous energy meeting the same failed control, more than once"
              />
              {patterns.signatures.length ? (
                <ul className="divide-y divide-border">
                  {patterns.signatures.map((s) => (
                    <li key={s.key} className="flex items-center justify-between gap-4 px-4 py-2.5 text-sm">
                      <span className="min-w-0 truncate text-fg">{s.label}</span>
                      <span className="flex shrink-0 items-center gap-4 text-xs text-fg-subtle tabular">
                        <span>
                          <span className="text-sm text-fg">{s.count}</span> reports
                        </span>
                        <span className={cn('w-16 text-right', s.avg >= 70 ? 'text-critical' : s.avg >= 40 ? 'text-warning' : 'text-success')}>
                          avg {s.avg}
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-4 py-6 text-sm text-fg-subtle">No combination has recurred yet.</p>
              )}
            </Panel>

            <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
              <Panel>
                <PanelHeader title="Dominant energy sources" />
                <PanelBody>
                  <RankList items={patterns.energy} total={n} />
                </PanelBody>
              </Panel>
              <Panel>
                <PanelHeader title="Most frequently failed controls" />
                <PanelBody>
                  <RankList items={patterns.barrier} total={n} />
                </PanelBody>
              </Panel>
              <Panel>
                <PanelHeader title="Officer verdicts" description={`${reviewed} of ${n} reviewed · ${patterns.rules} life-saving rule breaches`} />
                <PanelBody>
                  {reviewed ? (
                    <ProportionBars
                      rows={VERDICTS.map((v) => ({
                        label: VERDICT_LABEL[v],
                        value: patterns.verdicts.get(v) ?? 0,
                        color:
                          v === 'confirmed'
                            ? 'var(--color-success)'
                            : v === 'escalated'
                              ? 'var(--color-critical)'
                              : v === 'downgraded'
                                ? 'var(--color-info)'
                                : 'var(--color-fg-subtle)',
                      }))}
                    />
                  ) : (
                    <p className="text-sm text-fg-subtle">No verdicts recorded in this sample.</p>
                  )}
                </PanelBody>
              </Panel>
            </div>
          </>
        )}
      </div>
    </>
  );
}
