import type { ReactNode } from 'react';
import * as M from '@radix-ui/react-dropdown-menu';
import * as T from '@radix-ui/react-tooltip';

import { cn } from '@/lib/cn';

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;

export function MenuContent({
  children,
  align = 'end',
  className,
}: {
  children: ReactNode;
  align?: 'start' | 'center' | 'end';
  className?: string;
}) {
  return (
    <M.Portal>
      <M.Content
        align={align}
        sideOffset={6}
        collisionPadding={8}
        className={cn(
          'z-50 min-w-48 rounded-md border border-border-strong bg-overlay p-1 shadow-overlay',
          'data-[state=open]:animate-scale-in',
          className,
        )}
      >
        {children}
      </M.Content>
    </M.Portal>
  );
}

export function MenuItem({
  children,
  onSelect,
  danger,
  disabled,
  icon,
}: {
  children: ReactNode;
  onSelect?: (e: Event) => void;
  danger?: boolean;
  disabled?: boolean;
  icon?: ReactNode;
}) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn(
        'flex h-8 cursor-pointer items-center gap-2 rounded-sm px-2 text-sm outline-none select-none',
        'data-[disabled]:cursor-not-allowed data-[disabled]:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0',
        danger
          ? 'text-critical data-[highlighted]:bg-critical-soft'
          : 'text-fg-muted data-[highlighted]:bg-surface-3 data-[highlighted]:text-fg',
      )}
    >
      {icon}
      {children}
    </M.Item>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <M.Label className="px-2 pt-1.5 pb-1 text-2xs font-medium tracking-wide text-fg-subtle uppercase">{children}</M.Label>;
}

export function MenuSeparator() {
  return <M.Separator className="my-1 h-px bg-border" />;
}

export const TooltipProvider = T.Provider;

export function Tooltip({ content, children, side = 'top' }: { content: ReactNode; children: ReactNode; side?: 'top' | 'bottom' | 'left' | 'right' }) {
  return (
    <T.Root delayDuration={250}>
      <T.Trigger asChild>{children}</T.Trigger>
      <T.Portal>
        <T.Content
          side={side}
          sideOffset={6}
          className="z-50 max-w-64 rounded-sm border border-border-strong bg-surface-3 px-2 py-1 text-xs text-fg shadow-overlay data-[state=delayed-open]:animate-fade-in"
        >
          {content}
        </T.Content>
      </T.Portal>
    </T.Root>
  );
}
