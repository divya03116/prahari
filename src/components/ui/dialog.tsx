import { useState, type FormEvent, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

import { useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { Button, type ButtonVariant } from './button';
import { Field, Textarea } from './field';

/**
 * Modal built on Radix Dialog: focus is trapped and restored, Escape closes,
 * the page behind is inert and scroll-locked, and the title/description are
 * wired to aria-labelledby/-describedby.
 */
export function Modal({
  open,
  onOpenChange,
  title,
  description,
  children,
  footer,
  size = 'md',
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
  footer?: ReactNode;
  size?: 'sm' | 'md' | 'lg';
  /** When given, the body and footer are wrapped in a <form>, so Enter submits. */
  onSubmit?: (e: FormEvent<HTMLFormElement>) => void;
}) {
  const { t } = useI18n();
  const width = { sm: 'max-w-sm', md: 'max-w-lg', lg: 'max-w-2xl' }[size];
  const inner = (
    <>
      {children && <div className="max-h-[calc(100dvh-12rem)] overflow-y-auto px-5 py-4">{children}</div>}
      {footer && <div className="flex flex-col-reverse gap-2 border-t border-border px-5 py-3 sm:flex-row sm:justify-end">{footer}</div>}
    </>
  );
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=open]:animate-fade-in" />
        <D.Content
          className={cn(
            'fixed top-1/2 left-1/2 z-50 w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2',
            'rounded-lg border border-border-strong bg-overlay shadow-overlay focus:outline-none',
            'data-[state=open]:animate-scale-in',
            width,
          )}
        >
          <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4">
            <div className="min-w-0">
              <D.Title className="text-md font-semibold text-fg">{title}</D.Title>
              {description ? (
                <D.Description className="mt-1 text-sm text-fg-muted">{description}</D.Description>
              ) : (
                <D.Description className="sr-only">{title}</D.Description>
              )}
            </div>
            <D.Close asChild>
              <Button variant="ghost" size="icon-sm" aria-label={t('common.close')} className="-mt-1 -mr-2">
                <X aria-hidden />
              </Button>
            </D.Close>
          </div>
          {onSubmit ? (
            <form onSubmit={onSubmit} noValidate>
              {inner}
            </form>
          ) : (
            inner
          )}
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/**
 * Confirmation for anything destructive or hard to undo. `onConfirm` may be
 * async; the dialog stays open with a spinner until it settles and shows the
 * error inline if it fails, so a failed action is never silently dismissed.
 * With `reasonLabel`, a written reason is required and passed to onConfirm.
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel,
  variant = 'danger',
  reasonLabel,
  reasonHint,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description: ReactNode;
  confirmLabel?: string;
  variant?: ButtonVariant;
  reasonLabel?: string;
  reasonHint?: string;
  onConfirm: (reason: string) => Promise<unknown> | void;
}) {
  const { t } = useI18n();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const reasonInvalid = Boolean(reasonLabel) && reason.trim().length < 3;

  const change = (next: boolean) => {
    if (busy) return;
    if (!next) {
      setError(null);
      setReason('');
    }
    onOpenChange(next);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (reasonInvalid) {
      setError(t('common.reasonTooShort', { label: reasonLabel ?? '' }));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm(reason.trim());
      setReason('');
      onOpenChange(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onOpenChange={change}
      title={title}
      description={description}
      size="sm"
      onSubmit={submit}
      footer={
        <>
          <Button variant="ghost" onClick={() => change(false)} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" variant={variant} loading={busy}>
            {confirmLabel ?? t('common.confirm')}
          </Button>
        </>
      }
    >
      {reasonLabel || error ? (
        <div className="flex flex-col gap-3">
          {reasonLabel && (
            <Field label={reasonLabel} hint={reasonHint}>
              <Textarea
                autoFocus
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                maxLength={500}
                className="min-h-20"
              />
            </Field>
          )}
          {error && (
            <p role="alert" className="rounded-md border border-critical-line bg-critical-soft px-3 py-2 text-sm text-critical">
              {error}
            </p>
          )}
        </div>
      ) : null}
    </Modal>
  );
}
