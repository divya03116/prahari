import type { HTMLAttributes, ReactNode } from 'react';

import { cn } from '@/lib/cn';

export function Panel({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  // min-w-0: as a grid or flex item, a panel must be allowed to shrink below its
  // content's min-content width, or one long truncated line widens the page.
  return <div className={cn('min-w-0 rounded-lg border border-border bg-surface', className)} {...rest} />;
}

export function PanelHeader({
  title,
  description,
  actions,
  className,
}: {
  title: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('flex min-h-12 items-center justify-between gap-3 border-b border-border px-4 py-2.5', className)}>
      <div className="min-w-0">
        <h2 className="truncate text-sm font-medium text-fg">{title}</h2>
        {description && <p className="mt-0.5 text-xs text-fg-subtle">{description}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </div>
  );
}

export function PanelBody({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('p-4', className)} {...rest} />;
}

export function PanelFooter({ className, ...rest }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn('flex items-center justify-end gap-2 border-t border-border px-4 py-3', className)}
      {...rest}
    />
  );
}

/** A label/value row used in detail sidebars. */
export function DataRow({ label, children }: { label: ReactNode; children: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 text-sm">
      <dt className="shrink-0 text-fg-subtle">{label}</dt>
      <dd className="min-w-0 text-right text-fg">{children}</dd>
    </div>
  );
}
