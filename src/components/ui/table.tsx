import type { HTMLAttributes, ReactNode, TdHTMLAttributes, ThHTMLAttributes } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';

import { cn } from '@/lib/cn';
import { Button } from './button';

/**
 * Horizontal scroll lives on the wrapper, so a wide table never widens the
 * page. `relative` matters: it makes the wrapper the containing block for
 * absolutely positioned descendants (e.g. sr-only header text), which would
 * otherwise escape the overflow clip and stretch the document.
 */
export function Table({ className, children, ...rest }: HTMLAttributes<HTMLTableElement>) {
  return (
    <div className="relative w-full overflow-x-auto">
      <table className={cn('w-full border-collapse text-sm', className)} {...rest}>
        {children}
      </table>
    </div>
  );
}

export function THead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-border bg-surface-2/60 text-left">
      {children}
    </thead>
  );
}

export function TH({ className, ...rest }: ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th
      scope="col"
      className={cn('h-9 px-4 text-2xs font-medium tracking-wide whitespace-nowrap text-fg-subtle uppercase', className)}
      {...rest}
    />
  );
}

export function TR({
  className,
  interactive,
  ...rest
}: HTMLAttributes<HTMLTableRowElement> & { interactive?: boolean }) {
  return (
    <tr
      className={cn(
        'border-b border-border last:border-0',
        interactive && 'cursor-pointer transition-colors hover:bg-surface-2 focus-within:bg-surface-2',
        className,
      )}
      {...rest}
    />
  );
}

export function TD({ className, ...rest }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={cn('h-11 px-4 align-middle text-fg-muted', className)} {...rest} />;
}

/**
 * Cursor pagination control. Firestore pages by cursor, not offset, so there
 * is no "jump to page 7" — only previous and next, which is also the only
 * pagination that stays correct while new reports arrive.
 */
export function Pagination({
  page,
  hasNext,
  onPrev,
  onNext,
  loading,
  summary,
}: {
  page: number;
  hasNext: boolean;
  onPrev: () => void;
  onNext: () => void;
  loading?: boolean;
  summary?: ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-border px-4 py-2.5">
      <p className="text-xs text-fg-subtle tabular">{summary ?? `Page ${page}`}</p>
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="secondary" onClick={onPrev} disabled={page <= 1 || loading} aria-label="Previous page">
          <ChevronLeft aria-hidden /> <span className="hidden sm:inline">Previous</span>
        </Button>
        <Button size="sm" variant="secondary" onClick={onNext} disabled={!hasNext || loading} aria-label="Next page">
          <span className="hidden sm:inline">Next</span> <ChevronRight aria-hidden />
        </Button>
      </div>
    </div>
  );
}
