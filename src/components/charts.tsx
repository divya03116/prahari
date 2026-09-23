import { useState } from 'react';

import { cn } from '@/lib/cn';
import { formatShortDate } from '@/lib/format';

export interface TrendPoint {
  day: string;
  t1: number;
  t2: number;
  t3: number;
}

/**
 * Stacked daily bars (Tier 1 at the base, where the eye lands first). Plain
 * SVG: no chart library, nothing to load, and it scales with its container.
 */
export function TrendChart({ data, height = 180 }: { data: TrendPoint[]; height?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = Math.max(1, ...data.map((d) => d.t1 + d.t2 + d.t3));
  const nice = max <= 4 ? 4 : Math.ceil(max / 4) * 4;
  const W = 600;
  const H = height;
  const pad = { top: 8, bottom: 22, left: 26, right: 4 };
  const innerW = W - pad.left - pad.right;
  const innerH = H - pad.top - pad.bottom;
  const slot = innerW / Math.max(1, data.length);
  const bar = Math.max(2, slot * 0.62);
  const y = (v: number) => (v / nice) * innerH;
  const active = hover !== null ? data[hover] : null;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label={`Reports per day over the last ${data.length} days, by tier`}
        onMouseLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => {
          const yy = pad.top + innerH - f * innerH;
          return (
            <g key={f}>
              <line x1={pad.left} x2={W - pad.right} y1={yy} y2={yy} stroke="var(--color-border)" strokeDasharray={f === 0 ? undefined : '2 4'} />
              <text x={pad.left - 6} y={yy + 3.5} textAnchor="end" className="fill-fg-subtle text-[10px] tabular">
                {Math.round(nice * f)}
              </text>
            </g>
          );
        })}
        {data.map((d, i) => {
          const x = pad.left + i * slot + (slot - bar) / 2;
          let base = pad.top + innerH;
          const seg = (v: number, color: string) => {
            if (!v) return null;
            const h = y(v);
            base -= h;
            return <rect x={x} y={base} width={bar} height={Math.max(h - 1, 1)} rx={1} fill={color} />;
          };
          return (
            <g key={d.day} onMouseEnter={() => setHover(i)} opacity={hover === null || hover === i ? 1 : 0.45}>
              <rect x={pad.left + i * slot} y={pad.top} width={slot} height={innerH} fill="transparent" />
              {seg(d.t1, 'var(--color-critical)')}
              {seg(d.t2, 'var(--color-warning)')}
              {seg(d.t3, 'var(--color-success)')}
              {(i % 7 === (data.length - 1) % 7) && (
                <text x={x + bar / 2} y={H - 6} textAnchor="middle" className="fill-fg-subtle text-[10px]">
                  {formatShortDate(new Date(`${d.day}T00:00:00Z`))}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <div
        aria-live="polite"
        className={cn(
          'pointer-events-none absolute top-0 right-0 rounded-md border border-border-strong bg-overlay px-2.5 py-1.5 text-xs shadow-overlay transition-opacity',
          active ? 'opacity-100' : 'opacity-0',
        )}
      >
        {active && (
          <>
            <p className="font-medium text-fg">{formatShortDate(new Date(`${active.day}T00:00:00Z`))}</p>
            <p className="mt-0.5 text-fg-muted tabular">
              <span className="text-critical">T1 {active.t1}</span> · <span className="text-warning">T2 {active.t2}</span> ·{' '}
              <span className="text-success">T3 {active.t3}</span>
            </p>
          </>
        )}
      </div>
    </div>
  );
}

/** Horizontal proportion bars, e.g. the tier mix. */
export function ProportionBars({
  rows,
}: {
  rows: { label: string; value: number; color: string; hint?: string }[];
}) {
  const total = rows.reduce((s, r) => s + r.value, 0);
  return (
    <ul className="flex flex-col gap-3.5">
      {rows.map((r) => {
        const pct = total ? Math.round((r.value / total) * 100) : 0;
        return (
          <li key={r.label}>
            <div className="mb-1.5 flex items-baseline justify-between gap-2 text-sm">
              <span className="text-fg-muted">{r.label}</span>
              <span className="text-fg tabular">
                {r.value} <span className="text-xs text-fg-subtle">· {pct}%</span>
              </span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-surface-3">
              <div className="h-full rounded-full" style={{ width: `${pct}%`, background: r.color }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}
