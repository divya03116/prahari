/**
 * Dashboard widgets: the hero card, delta cards, the installation card stack,
 * the flow bar chart and the split donut. Presentational only — every number
 * they show is passed in from real Firestore data by pages/app/Dashboard.tsx.
 */

import { useState, type ReactNode } from 'react';
import { ArrowUpRight, ChevronDown } from 'lucide-react';

import { cn } from '@/lib/cn';
import { formatNumber } from '@/lib/format';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';

/* ------------------------------------------------------------------ *
 * Card shell
 * ------------------------------------------------------------------ */

export function DashCard({ className, children }: { className?: string; children: ReactNode }) {
  return <section className={cn('min-w-0 rounded-[18px] border border-border bg-surface p-5', className)}>{children}</section>;
}

export function DashCardHeader({
  title,
  count,
  actions,
  id,
}: {
  title: string;
  count?: number;
  actions?: ReactNode;
  id?: string;
}) {
  return (
    <div className="mb-4 flex items-center justify-between gap-3">
      <h2 id={id} className="flex items-start gap-1 text-[0.9375rem] font-bold text-fg">
        {title}
        {count !== undefined && <sup className="mt-1 text-2xs font-medium text-fg-subtle tabular">{count}</sup>}
      </h2>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Dark pill dropdown, e.g. "Monthly ▾". */
export function PillSelect<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  const current = options.find((o) => o.value === value)?.label ?? value;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={`${label}: ${current}`}
          className="inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full border border-border-strong bg-surface-2 px-3 text-xs font-medium text-fg-muted transition-colors hover:text-fg"
        >
          {current}
          <ChevronDown className="size-3.5" aria-hidden />
        </button>
      </MenuTrigger>
      <MenuContent align="end" className="min-w-32">
        {options.map((o) => (
          <MenuItem key={o.value} onSelect={() => onChange(o.value)}>
            <span className={cn(o.value === value && 'font-semibold text-fg')}>{o.label}</span>
          </MenuItem>
        ))}
      </MenuContent>
    </Menu>
  );
}

/* ------------------------------------------------------------------ *
 * Change pills
 * ------------------------------------------------------------------ */

/** Percentage change, or null when there is no previous value to compare with. */
export function percentChange(current: number, previous: number): number | null {
  if (previous === 0) return current === 0 ? 0 : null;
  return ((current - previous) / previous) * 100;
}

/**
 * "+15.7%" pill. `goodWhenUp` sets the colour: more reports filed is good for a
 * reporting culture; more Tier 1 reports is not.
 */
export function DeltaPill({ change, goodWhenUp }: { change: number | null; goodWhenUp: boolean }) {
  if (change === null) {
    return <span className="rounded-full bg-[#e7e3fe] px-2 py-0.5 text-2xs font-semibold text-[#4c3fb4]">New</span>;
  }
  const up = change > 0;
  const flat = Math.abs(change) < 0.05;
  const good = flat ? null : up === goodWhenUp;
  return (
    <span
      className={cn(
        'rounded-full px-2 py-0.5 text-2xs font-semibold tabular',
        good === null && 'bg-surface-3 text-fg-muted',
        good === true && 'bg-[#dcf5e3] text-[#1f7a45]',
        good === false && 'bg-[#fde4e2] text-[#b4332a]',
      )}
    >
      {flat ? '0%' : `${up ? '+' : '−'}${Math.abs(change).toFixed(1)}%`}
    </span>
  );
}

/** Big number with a small raised unit, as in "2,456 $". */
export function Figure({ value, unit, className }: { value: ReactNode; unit?: string; className?: string }) {
  return (
    <p className={cn('flex items-start font-bold tracking-[-0.03em] tabular', className)}>
      {value}
      {/* A span, not <sup>: sup's own vertical-align would lift it into the label above. */}
      {unit && <span className="mt-[0.12em] ml-1 text-[0.36em] leading-none font-semibold tracking-normal opacity-75">{unit}</span>}
    </p>
  );
}

/* ------------------------------------------------------------------ *
 * Installation card stack ("My cards")
 * ------------------------------------------------------------------ */

export interface StackItem {
  id: string;
  name: string;
  code: string;
  region: string;
  peak: number;
  count: number;
}

const STACK_COLORS = [
  'bg-[linear-gradient(135deg,#f0a15a,#dc7a33)]',
  'bg-[linear-gradient(135deg,#55b883,#2f8c5c)]',
  'bg-[linear-gradient(135deg,#a79bff,#7c6cf0)]',
];

export function CardStack({
  lead,
  others,
  onOpen,
  caption,
}: {
  lead: StackItem;
  others: StackItem[];
  onOpen: (id: string) => void;
  caption: string;
}) {
  const behind = others.slice(0, 3).reverse();
  return (
    <div>
      {behind.length > 0 && (
        <div className="relative mb-3" style={{ height: 28 * (behind.length - 1) + 56 }}>
          {behind.map((it, i) => (
            <button
              key={it.id}
              type="button"
              onClick={() => onOpen(it.id)}
              aria-label={`${it.name}: peak ${it.peak}`}
              className={cn(
                'absolute inset-x-0 flex h-14 cursor-pointer items-start rounded-[14px] px-4 pt-[8px] text-left leading-none shadow-[0_-6px_16px_-8px_rgb(0_0_0/0.6)] transition-transform hover:-translate-y-0.5',
                STACK_COLORS[(STACK_COLORS.length - behind.length + i) % STACK_COLORS.length],
              )}
              style={{ top: i * 28, zIndex: i }}
            >
              <span className="font-mono text-[0.6875rem] font-medium text-white/85">
                •••• {it.code || it.name.slice(0, 6)} · {it.peak}
              </span>
            </button>
          ))}
        </div>
      )}
      <button
        type="button"
        onClick={() => onOpen(lead.id)}
        className="block w-full cursor-pointer rounded-[16px] bg-[linear-gradient(135deg,#8f80f7_0%,#7465e8_55%,#6556d6_100%)] p-5 text-left text-white shadow-[0_18px_40px_-20px_rgb(124_108_240/0.8)] transition-transform hover:-translate-y-0.5"
      >
        <p className="text-2xs font-medium tracking-wide text-white/70 uppercase">{caption}</p>
        <p className="mt-2 truncate text-lg font-semibold tracking-[0.04em]">{lead.name}</p>
        <div className="mt-4 flex items-end justify-between gap-3 text-sm">
          <span className="truncate text-white/85">
            {lead.code ? `${lead.code} · ` : ''}
            {lead.count} {lead.count === 1 ? 'report' : 'reports'}
          </span>
          <span className="shrink-0 font-mono text-base font-semibold tabular">{lead.peak}</span>
        </div>
      </button>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Flow bar chart ("Revenue flow")
 * ------------------------------------------------------------------ */

export interface FlowBar {
  key: string;
  label: string;
  value: number;
  change: number | null;
}

export function FlowChart({ bars, unit }: { bars: FlowBar[]; unit: string }) {
  const [selected, setSelected] = useState(bars.length - 1);
  const max = Math.max(1, ...bars.map((b) => b.value));
  const active = bars[Math.min(selected, bars.length - 1)];
  const CHART = 150;

  return (
    <div>
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(${bars.length}, minmax(0, 1fr))` }}>
        {bars.map((b, i) => {
          const h = Math.max(10, Math.round((b.value / max) * CHART));
          const isActive = i === Math.min(selected, bars.length - 1);
          return (
            <div key={b.key} className="flex flex-col items-center">
              <div className="relative flex w-full items-end justify-center" style={{ height: CHART + 38 }}>
                {isActive && (
                  <div
                    className={cn(
                      'absolute z-10 flex items-center gap-1.5 rounded-full border border-border-strong bg-overlay px-2.5 py-1 text-2xs font-semibold whitespace-nowrap text-fg shadow-overlay',
                      // Edge bars anchor their tooltip inward so it never leaves the card.
                      i === 0 ? 'left-0' : i === bars.length - 1 ? 'right-0' : 'left-1/2 -translate-x-1/2',
                    )}
                    style={{ bottom: h + 14 }}
                  >
                    <ArrowUpRight className="size-3 text-fg-muted" aria-hidden />
                    {formatNumber(b.value)} {unit}
                    {b.change !== null && (
                      <span className={cn(b.change >= 0 ? 'text-[#8fe3a6]' : 'text-[#f59e97]')}>
                        {b.change >= 0 ? '+' : '−'}
                        {Math.abs(Math.round(b.change))}%
                      </span>
                    )}
                  </div>
                )}
                <button
                  type="button"
                  onMouseEnter={() => setSelected(i)}
                  onFocus={() => setSelected(i)}
                  onClick={() => setSelected(i)}
                  aria-label={`${b.label}: ${b.value} ${unit}`}
                  aria-pressed={isActive}
                  className={cn(
                    'relative w-full max-w-16 cursor-pointer rounded-[10px] transition-[height,background] duration-500',
                    isActive
                      ? 'bg-[linear-gradient(180deg,#b3a8fb_0%,#8b7cf6_60%,#6f60e0_100%)]'
                      : 'bg-[linear-gradient(180deg,#3a3552_0%,#262236_100%)] hover:bg-[linear-gradient(180deg,#48426a_0%,#2e2945_100%)]',
                  )}
                  style={{ height: h }}
                >
                  {isActive && (
                    <span className="absolute -top-1.5 left-1/2 size-3 -translate-x-1/2 rounded-full border-2 border-surface bg-white" />
                  )}
                </button>
              </div>
              <p className="mt-2 text-2xs font-medium text-fg-muted tabular">{formatNumber(b.value)}</p>
              <p className="text-2xs text-fg-subtle">{b.label}</p>
            </div>
          );
        })}
      </div>
      <p className="sr-only" aria-live="polite">
        {active ? `${active.label}: ${active.value} ${unit}` : ''}
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ *
 * Split donut ("Expense split")
 * ------------------------------------------------------------------ */

export interface Slice {
  label: string;
  value: number;
  color: string;
}

export const SLICE_COLORS = ['#d9a93b', '#7c6cf0', '#3f8fd6', '#df7b34', '#2f9e63', '#d45a86'];

export function SplitDonut({ slices, centreLabel }: { slices: Slice[]; centreLabel: string }) {
  const total = slices.reduce((s, x) => s + x.value, 0);
  const R = 62;
  const C = 2 * Math.PI * R;
  const GAP = total > 0 && slices.filter((s) => s.value > 0).length > 1 ? 4 : 0;
  let offset = 0;

  return (
    <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
      <div className="relative size-40 shrink-0">
        <svg viewBox="0 0 160 160" className="size-40 -rotate-90" role="img" aria-label={`${centreLabel}: ${total}`}>
          <circle cx="80" cy="80" r={R} fill="none" stroke="var(--color-surface-3)" strokeWidth="16" />
          {total > 0 &&
            slices.map((s) => {
              if (!s.value) return null;
              const len = (s.value / total) * C;
              const el = (
                <circle
                  key={s.label}
                  cx="80"
                  cy="80"
                  r={R}
                  fill="none"
                  stroke={s.color}
                  strokeWidth="16"
                  strokeDasharray={`${Math.max(0, len - GAP)} ${C}`}
                  strokeDashoffset={-offset}
                />
              );
              offset += len;
              return el;
            })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-2xs text-fg-subtle">{centreLabel}</span>
          <span className="text-2xl font-bold tracking-tight text-fg tabular">{formatNumber(total)}</span>
        </div>
      </div>
      <ul className="flex w-full min-w-0 flex-col gap-2.5">
        {slices.map((s) => (
          <li key={s.label} className="flex items-center gap-2.5 text-xs">
            <span aria-hidden className="size-2.5 shrink-0 rounded-[3px]" style={{ background: s.color }} />
            <span className="min-w-0 flex-1 truncate text-fg-muted">{s.label}</span>
            <span className="font-bold text-fg tabular">{total ? Math.round((s.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
