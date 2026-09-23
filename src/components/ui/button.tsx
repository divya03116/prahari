import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { Loader2 } from 'lucide-react';

import { cn } from '@/lib/cn';

export type ButtonVariant = 'primary' | 'accent' | 'secondary' | 'ghost' | 'danger' | 'link';
export type ButtonSize = 'xs' | 'sm' | 'md' | 'lg' | 'icon' | 'icon-sm';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-fg text-fg-inverse font-semibold hover:bg-white disabled:bg-fg/60',
  accent: 'bg-signal text-fg-inverse hover:bg-signal-hover disabled:bg-signal/60',
  secondary:
    'border border-border-strong bg-surface-2 text-fg hover:bg-surface-3 hover:border-[#3f3f46] disabled:text-fg-subtle',
  ghost: 'text-fg-muted hover:bg-surface-3 hover:text-fg disabled:text-fg-subtle',
  danger:
    'border border-critical-line bg-critical-soft text-critical hover:bg-critical/20 disabled:opacity-60',
  link: 'h-auto px-0 text-signal underline-offset-4 hover:underline',
};

// Pill-shaped controls throughout, matching the dashboard's visual language.
const SIZE: Record<ButtonSize, string> = {
  xs: 'h-6 gap-1 rounded-full px-2.5 text-xs',
  sm: 'h-7 gap-1.5 rounded-full px-3 text-sm',
  md: 'h-8 gap-2 rounded-full px-3.5 text-sm',
  lg: 'h-10 gap-2 rounded-full px-5 text-base',
  icon: 'size-8 rounded-full',
  'icon-sm': 'size-7 rounded-full',
};

export function buttonClass({
  variant = 'secondary',
  size = 'md',
  className,
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}): string {
  return cn(
    'inline-flex shrink-0 cursor-pointer select-none items-center justify-center font-medium whitespace-nowrap',
    'transition-colors duration-150 disabled:cursor-not-allowed [&_svg]:size-4 [&_svg]:shrink-0',
    SIZE[size],
    VARIANT[variant],
    variant === 'link' && 'px-0',
    className,
  );
}

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant, size, loading = false, disabled, className, children, type = 'button', ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      type={type}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={buttonClass({ variant, size, className })}
      {...rest}
    >
      {loading && <Loader2 className="animate-spin" aria-hidden />}
      {children}
    </button>
  );
});
