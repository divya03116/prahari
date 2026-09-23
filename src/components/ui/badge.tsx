import type { ReactNode } from 'react';

import { cn } from '@/lib/cn';
import {
  ACTION_STATUS_LABEL,
  ROLE_LABEL,
  TIER_LABEL,
  VERDICT_LABEL,
  type ActionStatus,
  type Role,
  type Tier,
  type Verdict,
} from '@/shared/constants';

export type Tone = 'neutral' | 'critical' | 'warning' | 'success' | 'info' | 'signal';

const TONE: Record<Tone, string> = {
  neutral: 'border-border-strong bg-surface-2 text-fg-muted',
  critical: 'border-critical-line bg-critical-soft text-critical',
  warning: 'border-warning-line bg-warning-soft text-warning',
  success: 'border-success-line bg-success-soft text-success',
  info: 'border-info-line bg-info-soft text-info',
  signal: 'border-signal/35 bg-signal-soft text-signal',
};

const DOT: Record<Tone, string> = {
  neutral: 'bg-fg-subtle',
  critical: 'bg-critical',
  warning: 'bg-warning',
  success: 'bg-success',
  info: 'bg-info',
  signal: 'bg-signal',
};

export function Badge({
  tone = 'neutral',
  dot = false,
  className,
  children,
  title,
}: {
  tone?: Tone;
  dot?: boolean;
  className?: string;
  children: ReactNode;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        'inline-flex h-5 shrink-0 items-center gap-1.5 rounded-full border px-2 text-2xs font-medium whitespace-nowrap',
        TONE[tone],
        className,
      )}
    >
      {dot && <span aria-hidden className={cn('size-1.5 rounded-full', DOT[tone])} />}
      {children}
    </span>
  );
}

export const TIER_TONE: Record<Tier, Tone> = { 1: 'critical', 2: 'warning', 3: 'success' };

export function TierBadge({ tier, compact = false }: { tier: Tier | undefined; compact?: boolean }) {
  if (!tier) return <Badge>Unscored</Badge>;
  return (
    <Badge tone={TIER_TONE[tier]} dot>
      {compact ? `T${tier}` : `Tier ${tier} · ${TIER_LABEL[tier]}`}
    </Badge>
  );
}

const ACTION_TONE: Record<ActionStatus, Tone> = {
  open: 'info',
  in_progress: 'warning',
  closed: 'success',
  cancelled: 'neutral',
};

export function ActionStatusBadge({ status }: { status: ActionStatus }) {
  return (
    <Badge tone={ACTION_TONE[status]} dot>
      {ACTION_STATUS_LABEL[status]}
    </Badge>
  );
}

const VERDICT_TONE: Record<Verdict, Tone> = {
  confirmed: 'success',
  escalated: 'critical',
  downgraded: 'info',
  dismissed: 'neutral',
};

export function VerdictBadge({ verdict }: { verdict: Verdict }) {
  return <Badge tone={VERDICT_TONE[verdict]}>{VERDICT_LABEL[verdict]}</Badge>;
}

const ROLE_TONE: Record<Role, Tone> = {
  reviewer: 'neutral',
  'installation-manager': 'info',
  'hse-officer': 'warning',
  admin: 'signal',
};

export function RoleBadge({ role }: { role: Role }) {
  return <Badge tone={ROLE_TONE[role]}>{ROLE_LABEL[role]}</Badge>;
}
