import {
  cloneElement,
  forwardRef,
  isValidElement,
  useId,
  type InputHTMLAttributes,
  type ReactElement,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';
import { ChevronDown } from 'lucide-react';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';

const control =
  'w-full rounded-md border border-border-strong bg-surface text-fg placeholder:text-fg-subtle ' +
  'transition-colors duration-150 hover:border-[#3f3f46] focus:border-signal focus:outline-none ' +
  'focus-visible:outline-none focus:ring-2 focus:ring-signal/25 disabled:cursor-not-allowed disabled:opacity-60 ' +
  'aria-[invalid=true]:border-critical aria-[invalid=true]:focus:ring-critical/25';

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(function Input(
  { className, ...rest },
  ref,
) {
  return <input ref={ref} className={cn(control, 'h-8 px-2.5 text-sm', className)} {...rest} />;
});

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function Textarea({ className, ...rest }, ref) {
    return <textarea ref={ref} className={cn(control, 'min-h-24 px-2.5 py-2 text-sm leading-6', className)} {...rest} />;
  },
);

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(function Select(
  { className, children, ...rest },
  ref,
) {
  return (
    <div className="relative">
      <select
        ref={ref}
        className={cn(control, 'h-8 cursor-pointer appearance-none pr-8 pl-2.5 text-sm', className)}
        {...rest}
      >
        {children}
      </select>
      <ChevronDown
        aria-hidden
        className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-subtle"
      />
    </div>
  );
});

export const Checkbox = forwardRef<HTMLInputElement, Omit<InputHTMLAttributes<HTMLInputElement>, 'type'>>(
  function Checkbox({ className, ...rest }, ref) {
    return (
      <input
        ref={ref}
        type="checkbox"
        className={cn(
          'size-4 shrink-0 cursor-pointer appearance-none rounded-sm border border-border-strong bg-surface',
          'checked:border-signal checked:bg-signal checked:bg-[url("data:image/svg+xml,%3Csvg%20xmlns=%27http://www.w3.org/2000/svg%27%20viewBox=%270%200%2016%2016%27%3E%3Cpath%20d=%27M4%208.5l2.5%202.5L12%205.5%27%20fill=%27none%27%20stroke=%27%230b0c0e%27%20stroke-width=%272%27/%3E%3C/svg%3E")]',
          'bg-center bg-no-repeat disabled:cursor-not-allowed disabled:opacity-60',
          className,
        )}
        {...rest}
      />
    );
  },
);

export function Label({
  htmlFor,
  children,
  className,
  optional,
}: {
  htmlFor?: string;
  children: ReactNode;
  className?: string;
  optional?: boolean;
}) {
  const { t } = useI18n();
  return (
    <label htmlFor={htmlFor} className={cn('flex items-baseline gap-1.5 text-sm font-medium text-fg', className)}>
      {children}
      {optional && <span className="text-xs font-normal text-fg-subtle">{t('common.optional')}</span>}
    </label>
  );
}

/**
 * Label + control + hint/error, with the ARIA wiring done once: the control
 * gets an id, aria-describedby pointing at the hint or error, and
 * aria-invalid when there is an error.
 */
export function Field({
  label,
  hint,
  error,
  optional,
  className,
  aside,
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  error?: string;
  optional?: boolean;
  className?: string;
  aside?: ReactNode;
  children: ReactElement<Record<string, unknown>>;
}) {
  const id = useId();
  const described = error ? `${id}-error` : hint ? `${id}-hint` : undefined;
  const controlId = (children.props.id as string | undefined) ?? id;
  const child = isValidElement(children)
    ? cloneElement(children, {
        id: controlId,
        'aria-describedby': described,
        'aria-invalid': error ? true : undefined,
      })
    : children;

  return (
    <div className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={controlId} optional={optional}>
          {label}
        </Label>
        {aside}
      </div>
      {child}
      {error ? (
        <p id={`${id}-error`} role="alert" className="text-xs text-critical">
          {error}
        </p>
      ) : hint ? (
        <p id={`${id}-hint`} className="text-xs text-fg-subtle">
          {hint}
        </p>
      ) : null}
    </div>
  );
}
