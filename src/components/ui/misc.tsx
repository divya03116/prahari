import { useEffect, useState, type ReactNode } from 'react';
import { Toaster as Sonner } from 'sonner';

import { cn } from '@/lib/cn';
import { initials } from '@/lib/format';

export function Avatar({ name, className }: { name: string; className?: string }) {
  return (
    <span
      aria-hidden
      className={cn(
        'inline-flex size-7 shrink-0 items-center justify-center rounded-full border border-border-strong bg-surface-3 text-2xs font-semibold text-fg-muted',
        className,
      )}
    >
      {initials(name)}
    </span>
  );
}

/** Segmented control. Behaves as a radio group for assistive tech. */
export function Segmented<T extends string>({
  value,
  onChange,
  options,
  label,
  className,
}: {
  value: T;
  onChange: (value: T) => void;
  options: readonly { value: T; label: ReactNode; count?: number }[];
  label: string;
  className?: string;
}) {
  return (
    <div
      role="radiogroup"
      aria-label={label}
      className={cn('inline-flex max-w-full items-center gap-0.5 overflow-x-auto rounded-full border border-border bg-surface p-0.5', className)}
    >
      {options.map((o) => {
        const active = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(o.value)}
            className={cn(
              'inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-full px-3 text-sm whitespace-nowrap transition-colors',
              active ? 'bg-surface-3 text-fg shadow-raised' : 'text-fg-subtle hover:text-fg',
            )}
          >
            {o.label}
            {o.count !== undefined && <span className="text-xs text-fg-subtle tabular">{o.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  eyebrow,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  eyebrow?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1.5 text-xs text-fg-subtle">{eyebrow}</div>}
        <h1 className="text-[1.375rem] leading-8 font-bold tracking-[-0.02em] text-fg">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-fg-muted">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Toaster() {
  // Below the desktop width the app has a tab bar along the bottom; toasts sit above it.
  const [wide, setWide] = useState(() => window.matchMedia('(min-width: 1024px)').matches);
  useEffect(() => {
    const media = window.matchMedia('(min-width: 1024px)');
    const onChange = (e: MediaQueryListEvent) => setWide(e.matches);
    media.addEventListener('change', onChange);
    return () => media.removeEventListener('change', onChange);
  }, []);
  return (
    <Sonner
      theme="dark"
      position="bottom-right"
      offset={wide ? undefined : { bottom: '4.75rem' }}
      mobileOffset={{ bottom: '4.75rem' }}
      closeButton
      toastOptions={{
        classNames: {
          toast: '!rounded-md !border !border-border-strong !bg-overlay !text-fg !shadow-overlay !font-sans',
          description: '!text-fg-muted',
          closeButton: '!bg-surface-3 !border-border-strong !text-fg-muted',
          success: '[&_[data-icon]]:!text-success',
          error: '[&_[data-icon]]:!text-critical',
        },
      }}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd className="inline-flex h-5 items-center rounded-sm border border-border-strong bg-surface-2 px-1.5 font-mono text-2xs text-fg-subtle">
      {children}
    </kbd>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone,
  loading,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: 'critical' | 'warning' | 'success' | 'info';
  loading?: boolean;
}) {
  const bar = {
    critical: 'bg-critical',
    warning: 'bg-warning',
    success: 'bg-success',
    info: 'bg-info',
  } as const;
  return (
    <div className="relative flex min-w-0 flex-col gap-1 bg-surface px-4 py-3.5">
      <div className="flex items-center gap-2 text-xs text-fg-subtle">
        {tone && <span aria-hidden className={cn('size-1.5 rounded-full', bar[tone])} />}
        <span className="truncate">{label}</span>
      </div>
      {loading ? (
        <div className="h-8 w-16 animate-shimmer rounded-sm bg-[linear-gradient(90deg,var(--color-surface-2)_0%,var(--color-surface-3)_50%,var(--color-surface-2)_100%)] bg-[length:200%_100%]" />
      ) : (
        <div className="text-2xl font-semibold tracking-tight text-fg tabular">{value}</div>
      )}
      {hint && <div className="truncate text-xs text-fg-subtle">{hint}</div>}
    </div>
  );
}
