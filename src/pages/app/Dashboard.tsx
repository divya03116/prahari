import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { ArrowRight, ArrowUpRight, ClipboardCheck, Copy, FileText, MoreVertical, Plus, SquarePen } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { useReportScope } from '@/auth/scope';
import { EditActionDialog } from '@/components/ActionDialogs';
import {
  CardStack,
  DashCard,
  DashCardHeader,
  DeltaPill,
  Figure,
  FlowChart,
  percentChange,
  PillSelect,
  SLICE_COLORS,
  SplitDonut,
  type FlowBar,
  type Slice,
  type StackItem,
} from '@/components/dashboard';
import { Badge, VerdictBadge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { useAsync, useLive } from '@/hooks/data';
import { useReference } from '@/hooks/reference';
import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { dayKey, daysUntil, formatDateTime, formatMonth, formatNumber, formatShortDate, initials } from '@/lib/format';
import { actionCounts, isOverdue, listActions } from '@/services/actions';
import { dailyStatsFrom, heatFromReports, heatSince, statsFromReports } from '@/services/directory';
import { recentScored, registerCounts, watchRecentReports } from '@/services/reports';
import { scopeKey } from '@/services/scope';
import type { Tier } from '@/shared/constants';
import type { ActionDoc, DailyStatsDoc, ReportDoc, WithId } from '@/shared/types';

const DAY = 86_400_000;
const MONTHS = 5;

function utcMonthStart(offset: number): Date {
  const now = new Date();
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - offset, 1));
}

/** Sum of a field over the days in [fromDaysAgo, toDaysAgo). */
function sumWindow(stats: DailyStatsDoc[], fromDaysAgo: number, toDaysAgo: number, field: 'total' | 't1'): number {
  const from = dayKey(new Date(Date.now() - (fromDaysAgo - 1) * DAY));
  const to = dayKey(new Date(Date.now() - (toDaysAgo - 1) * DAY));
  return stats.filter((s) => s.day >= from && s.day < to).reduce((n, s) => n + (s[field] ?? 0), 0);
}
const lastNDaysSum = (stats: DailyStatsDoc[], n: number, field: 'total' | 't1', skip = 0) =>
  sumWindow(stats, n + skip, skip, field);

const TIER_ICON: Record<Tier, string> = {
  1: 'bg-critical-soft text-critical',
  2: 'bg-warning-soft text-warning',
  3: 'bg-success-soft text-success',
};
const TIER_TEXT: Record<Tier, string> = { 1: 'text-critical', 2: 'text-warning', 3: 'text-success' };
const AVATAR_COLORS = ['bg-[#7c6cf0]', 'bg-[#3a3a42]', 'bg-[#2f9e63]', 'bg-[#d45a86]', 'bg-[#3f8fd6]'];

/* ------------------------------------------------------------------ */

function Hero({ active, delta, review, loading }: { active?: number; delta?: number; review?: number; loading: boolean }) {
  const { t } = useI18n();
  return (
    <section
      aria-label={t('dash.totalReports')}
      className="relative flex min-h-[210px] flex-col justify-between overflow-hidden rounded-[18px] bg-[linear-gradient(120deg,#69c98b_0%,#9fd46c_48%,#cfe36a_100%)] p-6 text-[#0b0f0a]"
    >
      <div aria-hidden className="pointer-events-none absolute -top-16 -right-10 size-64 rounded-full bg-white/15 blur-2xl" />
      <div className="relative">
        <p className="text-xs font-medium text-black/60">{t('dash.totalReports')}</p>
        {loading ? (
          <div className="mt-2 h-11 w-40 animate-pulse rounded-lg bg-black/10" />
        ) : (
          <Figure value={formatNumber(active ?? 0)} unit={t('dash.active')} className="mt-1 text-[2.75rem] leading-none" />
        )}
        <p className="mt-2 text-xs text-black/60">
          {delta === undefined ? ' ' : t('dash.deltaFromLastMonth', { delta: `${delta >= 0 ? '+' : '−'}${Math.abs(delta)}` })}
        </p>
      </div>
      <div className="relative mt-6 flex flex-wrap gap-2">
        <Link
          to="/app/reports/new"
          className="inline-flex h-9 items-center gap-2 rounded-full bg-[#0f140e] px-5 text-sm font-semibold text-white transition-colors hover:bg-black"
        >
          {t('nav.newReport')}
        </Link>
        <Link
          to="/app/reports?view=review"
          className="inline-flex h-9 items-center gap-2 rounded-full bg-white/90 px-4 text-sm font-semibold text-[#0f140e] transition-colors hover:bg-white"
        >
          {t('dash.reviewQueue')}
          <span className="inline-flex min-w-5 items-center justify-center rounded-full bg-[#0f140e] px-1.5 text-2xs text-white tabular">
            {review ?? '·'}
          </span>
        </Link>
      </div>
    </section>
  );
}

function DeltaCard({
  label,
  value,
  unit,
  change,
  goodWhenUp,
  foot,
  loading,
  to,
}: {
  label: string;
  value: number | undefined;
  unit: string;
  change: number | null;
  goodWhenUp: boolean;
  foot: string;
  loading: boolean;
  to: string;
}) {
  return (
    <Link
      to={to}
      className="flex min-h-[98px] min-w-0 flex-col justify-between rounded-[18px] border border-border bg-surface p-5 transition-colors hover:border-border-strong"
    >
      <p className="text-xs text-fg-muted">{label}</p>
      <div className="flex items-end justify-between gap-2">
        {loading ? (
          <Skeleton className="h-7 w-16" />
        ) : (
          <Figure value={formatNumber(value ?? 0)} unit={unit} className="text-[1.625rem] leading-none text-fg" />
        )}
        {!loading && <DeltaPill change={change} goodWhenUp={goodWhenUp} />}
      </div>
      <p className="text-2xs text-fg-subtle">{foot}</p>
    </Link>
  );
}

/* ------------------------------------------------------------------ */

export default function Dashboard() {
  const navigate = useNavigate();
  const { can, profile } = useAuth();
  const { t } = useI18n();
  const { installations } = useReference();
  const [flowMode, setFlowMode] = useState<'monthly' | 'weekly'>('monthly');
  const [editing, setEditing] = useState<WithId<ActionDoc> | null>(null);

  // Everything here is limited to the reports this person may see.
  const scope = useReportScope();
  const sk = scopeKey(scope);
  const everything = scope.kind === 'all';

  const counts = useAsync(() => registerCounts(scope), [sk]);
  const actionTotals = useAsync(() => actionCounts(scope), [sk]);
  const sample = useAsync(() => recentScored(everything ? 120 : 500, scope), [sk]);
  const openActions = useAsync(() => listActions({ view: 'active', installationId: null }, scope, 20, null), [sk]);
  const recent = useLive<WithId<ReportDoc>[]>((next, err) => watchRecentReports(5, scope, next, err), [sk]);
  // Officers read the site-wide roll-ups; everyone else's charts come from their own reports.
  const statsRollup = useAsync(() => (everything ? dailyStatsFrom(dayKey(utcMonthStart(MONTHS - 1))) : Promise.resolve([])), [sk]);
  const heatRollup = useAsync(() => (everything ? heatSince(30) : Promise.resolve([])), [sk]);
  const fromSample = { loading: sample.loading, error: sample.error, reload: sample.reload };
  const stats = everything ? statsRollup : { ...fromSample, data: sample.data && statsFromReports(sample.data) };
  const heat = everything ? heatRollup : { ...fromSample, data: sample.data && heatFromReports(sample.data, 30) };

  const s = stats.data ?? [];
  const lastMonth = lastNDaysSum(s, 30, 'total');
  const monthBefore = lastNDaysSum(s, 30, 'total', 30);
  const weekTotal = lastNDaysSum(s, 7, 'total');
  const prevWeekTotal = lastNDaysSum(s, 7, 'total', 7);
  const weekT1 = lastNDaysSum(s, 7, 't1');
  const prevWeekT1 = lastNDaysSum(s, 7, 't1', 7);

  /* report flow */
  const flow = useMemo<FlowBar[]>(() => {
    const series: { key: string; label: string; value: number }[] = [];
    if (flowMode === 'monthly') {
      for (let i = MONTHS - 1; i >= 0; i--) {
        const start = utcMonthStart(i);
        const key = dayKey(start).slice(0, 7);
        series.push({ key, label: formatMonth(start), value: s.filter((d) => d.day.startsWith(key)).reduce((n, d) => n + d.total, 0) });
      }
    } else {
      for (let i = 4; i >= 0; i--) {
        const value = lastNDaysSum(s, 7, 'total', i * 7);
        series.push({ key: `w${i}`, label: formatShortDate(new Date(Date.now() - (i * 7 + 6) * DAY)), value });
      }
    }
    return series.map((b, i) => ({ ...b, change: i === 0 ? null : percentChange(b.value, series[i - 1].value) }));
  }, [s, flowMode, t]);

  /* hazard split, by month */
  const months = useMemo(() => {
    const keys = [...new Set((sample.data ?? []).map((r) => dayKey(r.createdAt.toDate()).slice(0, 7)))].sort().reverse();
    return keys.slice(0, 4).map((k) => ({ value: k, label: formatMonth(new Date(`${k}-01T00:00:00Z`)) }));
  }, [sample.data, t]);
  const [splitMonth, setSplitMonth] = useState<string | null>(null);
  const month = splitMonth ?? months[0]?.value ?? '';
  const slices = useMemo<Slice[]>(() => {
    const by = new Map<string, number>();
    for (const r of sample.data ?? []) {
      if (dayKey(r.createdAt.toDate()).slice(0, 7) !== month) continue;
      const k = r.energy?.[0]?.short ?? t('dash.noEnergy');
      by.set(k, (by.get(k) ?? 0) + 1);
    }
    const ranked = [...by.entries()].sort((a, b) => b[1] - a[1]);
    const top = ranked.slice(0, 5);
    const rest = ranked.slice(5).reduce((n, [, v]) => n + v, 0);
    const rows = rest ? [...top, [t('dash.other'), rest] as [string, number]] : top;
    return rows.map(([label, value], i) => ({ label, value, color: SLICE_COLORS[i % SLICE_COLORS.length] }));
  }, [sample.data, month, t]);

  /* installations stack */
  const codes = useMemo(() => new Map(installations.map((i) => [i.id, i])), [installations]);
  const stack = useMemo<StackItem[]>(() => {
    const by = new Map<string, StackItem>();
    for (const h of heat.data ?? []) {
      const ref = codes.get(h.installationId);
      const cur = by.get(h.installationId) ?? {
        id: h.installationId,
        name: h.installationName,
        code: ref?.code ?? '',
        region: ref?.region ?? '',
        peak: 0,
        count: 0,
      };
      cur.peak = Math.max(cur.peak, h.peak);
      cur.count += h.count;
      by.set(h.installationId, cur);
    }
    return [...by.values()].sort((a, b) => b.peak - a.peak || b.count - a.count);
  }, [heat.data, codes]);
  const mine = profile?.installationId ? stack.find((x) => x.id === profile.installationId) : undefined;
  const lead = mine ?? stack[0];
  const others = stack.filter((x) => x.id !== lead?.id);

  /* open actions */
  const actions = openActions.data?.items ?? [];
  const owners = [...new Set(actions.map((a) => a.owner))].slice(0, 5);
  const officer = can('hse-officer');
  const managerOf = can('installation-manager') ? (profile?.installationId ?? null) : null;
  const editable = (a: WithId<ActionDoc>) =>
    officer || (managerOf !== null && a.installationId === managerOf && a.status !== 'cancelled');

  const copyLink = async (id: string) => {
    try {
      await navigator.clipboard.writeText(`${window.location.origin}/app/reports/${id}`);
      toast.success(t('detail.linkCopied'));
    } catch {
      toast.error(t('detail.linkCopyFailed'));
    }
  };

  const c = counts.data;
  const statsLoading = stats.loading;

  return (
    <div className="flex flex-col gap-5">
      <h1 className="text-[1.625rem] leading-9 font-bold tracking-[-0.02em] text-fg">{t('dash.title')}</h1>

      {c && c.processing > 0 && (
        <Alert
          tone="info"
          title={t(c.processing === 1 ? 'dash.processing.one' : 'dash.processing.many', { count: c.processing })}
          action={
            <Link to="/app/reports?view=processing" className={buttonClass({ size: 'sm' })}>
              {t('dash.view')}
            </Link>
          }
        >
          {t('dash.processingNote')}
        </Alert>
      )}
      {(counts.error || stats.error) && (
        <Alert tone="critical" action={<Button size="sm" onClick={() => { counts.reload(); stats.reload(); }}>{t('common.retry')}</Button>}>
          {counts.error || stats.error}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* ---------------- left column ---------------- */}
        <div className="flex min-w-0 flex-col gap-5">
          <div className="grid grid-cols-1 gap-5 md:grid-cols-[minmax(0,1.55fr)_minmax(0,1fr)]">
            <Hero
              active={c?.active}
              delta={statsLoading ? undefined : lastMonth - monthBefore}
              review={c?.awaitingReview}
              loading={counts.loading}
            />
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 md:grid-cols-1">
              <DeltaCard
                label={t('dash.reportsFiled')}
                value={weekTotal}
                unit={t('dash.unitNew')}
                change={percentChange(weekTotal, prevWeekTotal)}
                goodWhenUp
                foot={t('dash.thisWeek')}
                loading={statsLoading}
                to="/app/reports?sort=newest"
              />
              <DeltaCard
                label={t('tier.label', { tier: 1, label: t('tier.1') })}
                value={weekT1}
                unit="T1"
                change={percentChange(weekT1, prevWeekT1)}
                goodWhenUp={false}
                foot={t('dash.thisWeek')}
                loading={statsLoading}
                to="/app/reports?tier=1"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
            <DashCard>
              <DashCardHeader
                title={t('dash.reportFlow')}
                actions={
                  <>
                    <PillSelect
                      label={t('dash.period')}
                      value={flowMode}
                      onChange={setFlowMode}
                      options={[
                        { value: 'monthly', label: t('dash.monthly') },
                        { value: 'weekly', label: t('dash.weekly') },
                      ]}
                    />
                    <Link
                      to="/app/insights"
                      aria-label={t('dash.openInsights')}
                      className="inline-flex size-7 items-center justify-center rounded-full border border-border-strong bg-surface-2 text-fg-muted transition-colors hover:text-fg"
                    >
                      <ArrowUpRight className="size-3.5" aria-hidden />
                    </Link>
                  </>
                }
              />
              {statsLoading ? (
                <Skeleton className="h-52 w-full" />
              ) : (
                <FlowChart key={flowMode} bars={flow} unit={t('dash.unitReports')} />
              )}
            </DashCard>

            <DashCard>
              <DashCardHeader
                title={t('dash.hazardSplit')}
                actions={
                  months.length > 0 ? (
                    <PillSelect label={t('dash.month')} value={month} onChange={(v) => setSplitMonth(v)} options={months} />
                  ) : undefined
                }
              />
              {sample.loading ? (
                <Skeleton className="h-40 w-full" />
              ) : sample.error ? (
                <ErrorState message={sample.error} onRetry={sample.reload} className="py-6" />
              ) : slices.length ? (
                <SplitDonut slices={slices} centreLabel={t('dash.total')} />
              ) : (
                <p className="py-10 text-center text-sm text-fg-subtle">{t('dash.noScored')}</p>
              )}
              <p className="mt-4 text-2xs text-fg-subtle">{t('dash.splitNote')}</p>
            </DashCard>
          </div>

          {/* ---------------- recent reports ---------------- */}
          <DashCard className="p-0">
            <div className="px-5 pt-5">
              <DashCardHeader
                title={t('dash.recent')}
                count={c?.active}
                actions={
                  <Link to="/app/reports?sort=newest" className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
                    {t('dash.seeAll')} <ArrowRight className="size-3.5" aria-hidden />
                  </Link>
                }
              />
            </div>
            {recent.loading ? (
              <div className="flex flex-col gap-3 px-5 pb-5">
                {[0, 1, 2].map((i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : recent.error ? (
              <ErrorState message={recent.error} />
            ) : !recent.data?.length ? (
              <EmptyState
                icon={<FileText />}
                title={t('dash.noReports')}
                description={t('dash.noReportsDesc')}
                action={
                  <Link to="/app/reports/new" className={buttonClass({ variant: 'primary', size: 'sm' })}>
                    {t('dash.fileFirst')}
                  </Link>
                }
              />
            ) : (
              <ul className="pb-2">
                {recent.data.map((r) => (
                  <li key={r.id} className="group flex items-center gap-3 px-5 py-2.5 transition-colors hover:bg-surface-2">
                    <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full', r.tier ? TIER_ICON[r.tier] : 'bg-surface-3 text-fg-subtle')}>
                      <FileText className="size-4" aria-hidden />
                    </span>
                    <Link to={`/app/reports/${r.id}`} className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold text-fg group-hover:underline">{r.text}</span>
                      <span className="block truncate text-2xs text-fg-subtle">{formatDateTime(r.createdAt)}</span>
                    </Link>
                    <span className="hidden sm:block">
                      {r.verdict ? <VerdictBadge verdict={r.verdict.decision} /> : <Badge>{t('reports.view.review')}</Badge>}
                    </span>
                    <span className="hidden w-20 truncate text-right font-mono text-2xs text-fg-subtle md:block">
                      {codes.get(r.installationId)?.code || r.installationName}
                    </span>
                    <span className={cn('w-10 text-right text-sm font-bold tabular', r.tier ? TIER_TEXT[r.tier] : 'text-fg')}>
                      {r.score ?? '—'}
                    </span>
                    <Menu>
                      <MenuTrigger asChild>
                        <Button size="icon-sm" variant="ghost" aria-label={t('dash.reportOptions')}>
                          <MoreVertical aria-hidden />
                        </Button>
                      </MenuTrigger>
                      <MenuContent>
                        <MenuItem icon={<FileText />} onSelect={() => navigate(`/app/reports/${r.id}`)}>
                          {t('dash.openReport')}
                        </MenuItem>
                        <MenuItem icon={<Copy />} onSelect={() => void copyLink(r.id)}>
                          {t('detail.copyLink')}
                        </MenuItem>
                      </MenuContent>
                    </Menu>
                  </li>
                ))}
              </ul>
            )}
          </DashCard>
        </div>

        {/* ---------------- right column ---------------- */}
        <div className="flex min-w-0 flex-col gap-5">
          <DashCard>
            <DashCardHeader
              title={t('dash.installations')}
              count={stack.length || undefined}
              actions={
                can('admin') ? (
                  <Link
                    to="/app/admin/reference"
                    className="inline-flex h-7 items-center gap-1.5 rounded-full bg-fg pr-1 pl-3 text-xs font-semibold text-fg-inverse transition-colors hover:bg-white"
                  >
                    {t('dash.add')}
                    <span className="flex size-5 items-center justify-center rounded-full bg-fg-inverse text-fg">
                      <Plus className="size-3" aria-hidden />
                    </span>
                  </Link>
                ) : undefined
              }
            />
            {heat.loading ? (
              <Skeleton className="h-44 w-full" />
            ) : heat.error ? (
              <ErrorState message={heat.error} onRetry={heat.reload} className="py-6" />
            ) : lead ? (
              <CardStack
                lead={lead}
                others={others}
                caption={mine ? t('dash.yourInstallation') : t('dash.highestPotential')}
                onOpen={(id) => navigate(`/app/reports?installation=${encodeURIComponent(id)}`)}
              />
            ) : (
              <p className="py-8 text-center text-sm text-fg-subtle">{t('dash.noReports30')}</p>
            )}
          </DashCard>

          <DashCard>
            <DashCardHeader
              title={t('dash.openActions')}
              count={actionTotals.data?.open}
              actions={
                <Link to="/app/actions" className="inline-flex items-center gap-1 text-xs font-medium text-fg-muted hover:text-fg">
                  {t('dash.manage')} <ArrowRight className="size-3.5" aria-hidden />
                </Link>
              }
            />
            {owners.length > 0 && (
              <div className="mb-4 flex items-center gap-2" aria-label={t('dash.actionOwners')}>
                {owners.map((o, i) => (
                  <span
                    key={o}
                    title={o}
                    className={cn('flex size-8 items-center justify-center rounded-full text-2xs font-bold text-white', AVATAR_COLORS[i % AVATAR_COLORS.length])}
                  >
                    {initials(o)}
                  </span>
                ))}
                {actionTotals.data && actionTotals.data.overdue > 0 && (
                  <Link to="/app/actions?view=overdue" className="ml-auto text-2xs font-semibold text-critical hover:underline">
                    {t('dash.overdueCount', { count: actionTotals.data.overdue })}
                  </Link>
                )}
              </div>
            )}
            {openActions.loading ? (
              <div className="flex flex-col gap-3">
                {[0, 1, 2, 3].map((i) => (
                  <Skeleton key={i} className="h-10" />
                ))}
              </div>
            ) : openActions.error ? (
              <ErrorState message={openActions.error} onRetry={openActions.reload} className="py-6" />
            ) : !actions.length ? (
              <EmptyState icon={<ClipboardCheck />} title={t('actions.empty.active')} className="py-8" />
            ) : (
              <ul className="-mx-2 flex flex-col">
                {actions.slice(0, 5).map((a) => {
                  const late = isOverdue(a);
                  const d = daysUntil(a.dueAt);
                  return (
                    <li key={a.id} className="flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-2">
                      <span className={cn('flex size-9 shrink-0 items-center justify-center rounded-full text-2xs font-bold', TIER_ICON[a.tier])}>
                        T{a.tier}
                      </span>
                      <Link to={`/app/reports/${a.reportId}`} className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-semibold text-fg">{a.control}</span>
                        <span className={cn('block truncate text-2xs', late ? 'text-critical' : 'text-fg-subtle')}>
                          {t('detail.due', { date: formatShortDate(a.dueAt) })} · {a.installationName}
                        </span>
                      </Link>
                      <span className={cn('shrink-0 text-xs font-bold tabular', late ? 'text-critical' : 'text-fg')}>
                        {d === null ? '' : late ? t('dash.daysLate', { days: -d }) : d === 0 ? t('dash.today') : t('dash.daysShort', { days: d })}
                      </span>
                      <Menu>
                        <MenuTrigger asChild>
                          <Button size="icon-sm" variant="ghost" aria-label={t('dash.actionOptions')}>
                            <MoreVertical aria-hidden />
                          </Button>
                        </MenuTrigger>
                        <MenuContent>
                          <MenuItem icon={<FileText />} onSelect={() => navigate(`/app/reports/${a.reportId}`)}>
                            {t('dash.openReport')}
                          </MenuItem>
                          {editable(a) && (
                            <MenuItem icon={<SquarePen />} onSelect={() => setEditing(a)}>
                              {t('dash.updateAction')}
                            </MenuItem>
                          )}
                        </MenuContent>
                      </Menu>
                    </li>
                  );
                })}
              </ul>
            )}
          </DashCard>
        </div>
      </div>

      <EditActionDialog
        action={editing}
        onOpenChange={(o) => !o && setEditing(null)}
        onSaved={() => {
          openActions.reload();
          actionTotals.reload();
        }}
      />
    </div>
  );
}
