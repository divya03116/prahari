import type { ReactNode } from 'react';
import { AlertTriangle, Loader2, RotateCw } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Button } from './button';

export function Spinner({ className, label = 'Loading' }: { className?: string; label?: string }) {
  return (
    <span role="status" className={cn('inline-flex items-center text-fg-subtle', className)}>
      <Loader2 className="size-4 animate-spin" aria-hidden />
      <span className="sr-only">{label}</span>
    </span>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden
      className={cn(
        'animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]',
        className,
      )}
    />
  );
}

export function SkeletonRows({ rows = 6, className }: { rows?: number; className?: string }) {
  return (
    <div role="status" aria-label="Loading" className={cn('divide-y divide-border', className)}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="flex items-center gap-4 px-4 py-3">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-4 flex-1" />
          <Skeleton className="hidden h-4 w-24 sm:block" />
          <Skeleton className="hidden h-4 w-20 md:block" />
        </div>
      ))}
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
  className,
}: {
  icon?: ReactNode;
  title: string;
  description?: ReactNode;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      {icon && (
        <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-border bg-surface-2 text-fg-subtle [&_svg]:size-4">
          {icon}
        </div>
      )}
      <p className="text-sm font-medium text-fg">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-fg-subtle">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title = 'Could not load this',
  message,
  onRetry,
  className,
}: {
  title?: string;
  message?: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <div role="alert" className={cn('flex flex-col items-center justify-center px-6 py-14 text-center', className)}>
      <div className="mb-3 flex size-9 items-center justify-center rounded-md border border-critical-line bg-critical-soft text-critical">
        <AlertTriangle className="size-4" aria-hidden />
      </div>
      <p className="text-sm font-medium text-fg">{title}</p>
      {message && <p className="mt-1 max-w-sm text-sm text-fg-subtle">{message}</p>}
      {onRetry && (
        <Button size="sm" className="mt-4" onClick={onRetry}>
          <RotateCw aria-hidden /> Try again
        </Button>
      )}
    </div>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
  className,
  action,
}: {
  tone?: 'info' | 'warning' | 'critical' | 'success';
  title?: ReactNode;
  children?: ReactNode;
  className?: string;
  action?: ReactNode;
}) {
  const tones = {
    info: 'border-info-line bg-info-soft',
    warning: 'border-warning-line bg-warning-soft',
    critical: 'border-critical-line bg-critical-soft',
    success: 'border-success-line bg-success-soft',
  } as const;
  const text = { info: 'text-info', warning: 'text-warning', critical: 'text-critical', success: 'text-success' } as const;
  return (
    <div
      role={tone === 'critical' ? 'alert' : 'status'}
      className={cn('flex flex-col gap-3 rounded-md border px-3.5 py-3 sm:flex-row sm:items-center', tones[tone], className)}
    >
      <div className="min-w-0 flex-1 text-sm">
        {title && <p className={cn('font-medium', text[tone])}>{title}</p>}
        {children && <div className={cn('text-fg-muted', title && 'mt-0.5')}>{children}</div>}
      </div>
      {action && <div className="shrink-0">{action}</div>}
    </div>
  );
}
