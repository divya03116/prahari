/**
 * Presentation of an engine assessment: score, evidence in the narrative,
 * the energy / barrier / exposure findings, the score build-up and the
 * life-saving-rule net. Pure components — they render what the server wrote
 * (or, on the submit form, what the local preview computed) and decide nothing.
 */

import { Fragment, useMemo } from 'react';
import { ShieldAlert } from 'lucide-react';

import { cn } from '@/lib/cn';
import type { Contribution, EvidenceSpan, Hit, RuleHit, SpanKind, Tier } from '@/shared/engine';

const TIER_TEXT: Record<Tier, string> = { 1: 'text-critical', 2: 'text-warning', 3: 'text-success' };
const TIER_BG: Record<Tier, string> = { 1: 'bg-critical', 2: 'bg-warning', 3: 'bg-success' };

export function ScoreValue({ score, tier, className }: { score: number | undefined; tier: Tier | undefined; className?: string }) {
  if (score === undefined || !tier) return <span className={cn('text-fg-subtle tabular', className)}>—</span>;
  return <span className={cn('font-semibold tabular', TIER_TEXT[tier], className)}>{score}</span>;
}

/** 0–100 bar with the tier thresholds marked at 40 and 70. */
export function ScoreBar({ score, tier, className }: { score: number; tier: Tier; className?: string }) {
  return (
    <div className={cn('relative h-1.5 w-full overflow-hidden rounded-full bg-surface-3', className)} aria-hidden>
      <div className={cn('h-full rounded-full transition-[width] duration-500', TIER_BG[tier])} style={{ width: `${score}%` }} />
      <span className="absolute top-0 left-[40%] h-full w-px bg-canvas" />
      <span className="absolute top-0 left-[70%] h-full w-px bg-canvas" />
    </div>
  );
}

/** Compact score cell for tables. */
export function ScoreCell({ score, tier }: { score: number | undefined; tier: Tier | undefined }) {
  if (score === undefined || !tier) return <span className="text-fg-subtle">—</span>;
  return (
    <div className="flex w-16 items-center gap-2 sm:w-20">
      <ScoreValue score={score} tier={tier} className="w-6 text-sm" />
      <ScoreBar score={score} tier={tier} className="h-1 flex-1" />
    </div>
  );
}

const SPAN_STYLE: Record<SpanKind, string> = {
  energy: 'bg-critical-soft text-fg decoration-critical',
  barrier: 'bg-warning-soft text-fg decoration-warning',
  exposure: 'bg-info-soft text-fg decoration-info',
  aggravator: 'bg-signal-soft text-fg decoration-signal',
  mitigator: 'bg-success-soft text-fg decoration-success',
};

const SPAN_LABEL: Record<SpanKind, string> = {
  energy: 'Energy',
  barrier: 'Failed barrier',
  exposure: 'Exposure',
  aggravator: 'Aggravator',
  mitigator: 'Mitigator',
};

/** The narrative with every phrase the engine used highlighted and labelled. */
export function EvidenceText({ text, spans, className }: { text: string; spans: EvidenceSpan[] | undefined; className?: string }) {
  const parts = useMemo(() => {
    const sorted = [...(spans ?? [])].sort((a, b) => a.start - b.start);
    const out: { text: string; kind?: SpanKind }[] = [];
    let at = 0;
    for (const s of sorted) {
      if (s.start < at || s.end > text.length) continue;
      if (s.start > at) out.push({ text: text.slice(at, s.start) });
      out.push({ text: text.slice(s.start, s.end), kind: s.kind });
      at = s.end;
    }
    if (at < text.length) out.push({ text: text.slice(at) });
    return out;
  }, [text, spans]);

  return (
    <p className={cn('text-md leading-7 whitespace-pre-wrap text-fg-muted', className)}>
      {parts.map((p, i) =>
        p.kind ? (
          <mark
            key={i}
            title={SPAN_LABEL[p.kind]}
            className={cn('rounded-[3px] px-0.5 underline decoration-1 underline-offset-4', SPAN_STYLE[p.kind])}
          >
            {p.text}
          </mark>
        ) : (
          <Fragment key={i}>{p.text}</Fragment>
        ),
      )}
    </p>
  );
}

export function EvidenceLegend() {
  const kinds: SpanKind[] = ['energy', 'barrier', 'exposure', 'aggravator', 'mitigator'];
  const dot: Record<SpanKind, string> = {
    energy: 'bg-critical',
    barrier: 'bg-warning',
    exposure: 'bg-info',
    aggravator: 'bg-signal',
    mitigator: 'bg-success',
  };
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-xs text-fg-subtle">
      {kinds.map((k) => (
        <li key={k} className="inline-flex items-center gap-1.5">
          <span aria-hidden className={cn('size-2 rounded-[2px]', dot[k])} />
          {SPAN_LABEL[k]}
        </li>
      ))}
    </ul>
  );
}

function HitList({ title, hits, empty, tone }: { title: string; hits: Hit[] | undefined; empty: string; tone: string }) {
  return (
    <div className="flex min-w-0 flex-col gap-2 bg-surface p-4">
      <h3 className="text-2xs font-medium tracking-wide text-fg-subtle uppercase">{title}</h3>
      {hits?.length ? (
        <ul className="flex flex-col gap-2.5">
          {hits.map((h) => (
            <li key={h.id} className="min-w-0">
              <div className="flex items-baseline justify-between gap-2">
                <span className="truncate text-sm font-medium text-fg">{h.label}</span>
                <span className={cn('shrink-0 text-xs tabular', tone)}>+{h.weight}</span>
              </div>
              {h.terms.length > 0 && (
                <p className="mt-0.5 truncate text-xs text-fg-subtle" title={h.terms.join(', ')}>
                  “{h.terms.slice(0, 3).join('”, “')}”
                </p>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-subtle">{empty}</p>
      )}
    </div>
  );
}

/** Energy / barrier / exposure, side by side. */
export function FindingsGrid({ energy, barrier, exposure }: { energy?: Hit[]; barrier?: Hit[]; exposure?: Hit[] }) {
  return (
    // Sized by its container, not the viewport: the same grid sits in a wide
    // report page and in the narrow live-preview panel.
    <div className="@container">
      <div className="grid gap-px overflow-hidden rounded-md border border-border bg-border @xl:grid-cols-3">
        <HitList title="Energy source" hits={energy} empty="No hazardous energy described." tone="text-critical" />
        <HitList title="Failed barrier" hits={barrier} empty="No failed control described." tone="text-warning" />
        <HitList title="Exposure" hits={exposure} empty="No person described in the line of fire." tone="text-info" />
      </div>
    </div>
  );
}

/** How the score was built, line by line. */
export function Contributions({ items, score }: { items: Contribution[] | undefined; score: number }) {
  if (!items?.length) return null;
  return (
    <div className="overflow-hidden rounded-md border border-border">
      <ul className="divide-y divide-border">
        {items.map((c) => (
          <li key={c.key} className="flex items-center justify-between gap-4 px-3.5 py-2 text-sm">
            <span className="min-w-0 truncate text-fg-muted">{c.label}</span>
            <span
              className={cn(
                'shrink-0 font-mono text-xs tabular',
                c.amount < 0 ? 'text-success' : c.kind === 'rule' ? 'text-signal' : 'text-fg',
              )}
            >
              {c.amount > 0 ? '+' : ''}
              {c.amount}
            </span>
          </li>
        ))}
      </ul>
      <div className="flex items-center justify-between border-t border-border-strong bg-surface-2 px-3.5 py-2 text-sm">
        <span className="font-medium text-fg">SIF potential</span>
        <span className="font-mono text-xs font-semibold text-fg tabular">{score} / 100</span>
      </div>
    </div>
  );
}

/** Life-saving rules the narrative describes being broken. */
export function RuleNet({ rules, escalated, preRuleScore }: { rules: RuleHit[] | undefined; escalated?: boolean; preRuleScore?: number }) {
  if (!rules?.length) return null;
  return (
    <div className="rounded-md border border-signal/35 bg-signal-soft p-3.5">
      <div className="flex items-center gap-2 text-sm font-medium text-signal">
        <ShieldAlert className="size-4" aria-hidden />
        Life-saving rule {rules.length > 1 ? 'breaches' : 'breach'}
      </div>
      <ul className="mt-2 flex flex-col gap-1.5">
        {rules.map((r) => (
          <li key={r.code} className="text-sm text-fg-muted">
            <span className="font-medium text-fg">{r.title}</span>
            <span className="text-fg-subtle"> · {r.ref}</span>
          </li>
        ))}
      </ul>
      {escalated && (
        <p className="mt-2 text-xs text-fg-muted">
          The rule net raised this report from {preRuleScore} to the Tier 1 floor. It is a floor, never a multiplier:
          it can only lift a score, and only to 70.
        </p>
      )}
    </div>
  );
}

export function PotentialOutcomes({ outcomes }: { outcomes: string[] | undefined }) {
  if (!outcomes?.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {outcomes.map((o) => (
        <li key={o} className="rounded-sm border border-border-strong bg-surface-2 px-2 py-0.5 text-xs text-fg-muted">
          {o}
        </li>
      ))}
    </ul>
  );
}
