import { useCallback, useEffect, useRef, useState } from 'react';
import { FileImage, FileText, Loader2, Paperclip, Trash2, UploadCloud } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { rich, useI18n } from '@/i18n';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatBytes } from '@/lib/format';
import { attachmentPath, attachmentUrl, removeUpload, startUpload, validateFile } from '@/services/storage';
import { LIMITS } from '@/shared/constants';
import type { AttachmentMeta } from '@/shared/types';

export interface UploadItem {
  key: string;
  name: string;
  size: number;
  contentType: string;
  path: string;
  progress: number;
  state: 'uploading' | 'done' | 'error';
  error?: string;
}

/**
 * Uploads as soon as files are chosen, so filing the report does not wait on
 * the network. Exposes the finished uploads through `onChange`.
 */
export function AttachmentPicker({
  uid,
  reportId,
  onChange,
  disabled,
  variant = 'dropzone',
  accept,
  capture,
  buttonLabel,
  onFile,
}: {
  uid: string;
  reportId: string;
  onChange: (items: UploadItem[]) => void;
  disabled?: boolean;
  /** 'button': one large button (mobile); 'dropzone': drag-and-drop area. */
  variant?: 'dropzone' | 'button';
  accept?: string;
  /** Opens the phone camera directly on mobile browsers. */
  capture?: 'environment' | 'user';
  buttonLabel?: string;
  /** Called with each accepted file as its upload starts (e.g. to analyse a photo). */
  onFile?: (file: File) => void;
}) {
  const { t } = useI18n();
  const [items, setItems] = useState<UploadItem[]>([]);
  const [rejects, setRejects] = useState<string[]>([]);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => onChange(items), [items, onChange]);

  const patch = useCallback((key: string, p: Partial<UploadItem>) => {
    setItems((list) => list.map((i) => (i.key === key ? { ...i, ...p } : i)));
  }, []);

  const add = (files: FileList | File[]) => {
    const errs: string[] = [];
    const room = LIMITS.attachmentsMax - items.length;
    const chosen = [...files];
    if (chosen.length > room) errs.push(t('attach.tooMany', { max: LIMITS.attachmentsMax }));
    for (const file of chosen.slice(0, Math.max(0, room))) {
      const invalid = validateFile(file);
      if (invalid) {
        errs.push(invalid);
        continue;
      }
      const path = attachmentPath(uid, reportId, file);
      const key = path;
      setItems((list) => [
        ...list,
        { key, name: file.name, size: file.size, contentType: file.type, path, progress: 0, state: 'uploading' },
      ]);
      startUpload(path, file)
        .then(({ task }) =>
          task.on(
            'state_changed',
            (s) => patch(key, { progress: s.totalBytes ? s.bytesTransferred / s.totalBytes : 0 }),
            (err) => patch(key, { state: 'error', error: errorMessage(err) }),
            () => patch(key, { state: 'done', progress: 1 }),
          ),
        )
        .catch((err) => patch(key, { state: 'error', error: errorMessage(err) }));
      onFile?.(file);
    }
    setRejects(errs);
  };

  const remove = async (item: UploadItem) => {
    setItems((list) => list.filter((i) => i.key !== item.key));
    if (item.state === 'done') await removeUpload(item.path).catch(() => undefined);
  };

  const full = items.length >= LIMITS.attachmentsMax;

  const fileInput = (
    <input
      ref={inputRef}
      type="file"
      multiple
      accept={accept ?? LIMITS.attachmentTypes.join(',')}
      capture={capture}
      className="sr-only"
      tabIndex={-1}
      aria-label={t('attach.attach')}
      onChange={(e) => {
        if (e.target.files) add(e.target.files);
        e.target.value = '';
      }}
    />
  );

  return (
    <div className="flex flex-col gap-2">
      {variant === 'button' ? (
        <button
          type="button"
          disabled={disabled || full}
          onClick={() => inputRef.current?.click()}
          className="flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border-strong bg-surface-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-3 disabled:cursor-not-allowed disabled:opacity-60"
        >
          <UploadCloud className="size-4" aria-hidden />
          {full ? t('attach.full', { max: LIMITS.attachmentsMax }) : (buttonLabel ?? t('quick.addPhoto'))}
        </button>
      ) : null}
      {variant === 'button' && fileInput}
      {variant === 'button' ? null : (
      <div
        onDragOver={(e) => {
          e.preventDefault();
          if (!disabled && !full) setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (!disabled && !full) add(e.dataTransfer.files);
        }}
        className={cn(
          'flex flex-col items-center justify-center gap-1.5 rounded-md border border-dashed px-4 py-5 text-center transition-colors',
          dragging ? 'border-signal bg-signal-soft' : 'border-border-strong bg-surface',
          (disabled || full) && 'opacity-60',
        )}
      >
        <UploadCloud className="size-5 text-fg-subtle" aria-hidden />
        <p className="text-sm text-fg-muted">
          {rich(t('attach.drop'), {
            browse: (
              <button
                type="button"
                disabled={disabled || full}
                onClick={() => inputRef.current?.click()}
                className="cursor-pointer font-medium text-fg underline-offset-4 hover:underline disabled:cursor-not-allowed"
              >
                {t('attach.browse')}
              </button>
            ),
          })}
        </p>
        <p className="text-xs text-fg-subtle">{t('attach.limits', { max: LIMITS.attachmentsMax })}</p>
        {fileInput}
      </div>
      )}

      {rejects.length > 0 && (
        <ul role="alert" className="flex flex-col gap-0.5 text-xs text-critical">
          {rejects.map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
      )}

      {items.length > 0 && (
        <ul className="divide-y divide-border rounded-md border border-border">
          {items.map((i) => (
            <li key={i.key} className="flex items-center gap-3 px-3 py-2">
              {i.contentType === 'application/pdf' ? (
                <FileText className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              ) : (
                <FileImage className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              )}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-fg">{i.name}</p>
                {i.state === 'uploading' ? (
                  <div className="mt-1 h-1 overflow-hidden rounded-full bg-surface-3" role="progressbar" aria-valuenow={Math.round(i.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={t('attach.uploadingFile', { name: i.name })}>
                    <div className="h-full bg-signal transition-[width]" style={{ width: `${Math.round(i.progress * 100)}%` }} />
                  </div>
                ) : i.state === 'error' ? (
                  <p className="text-xs text-critical">{i.error}</p>
                ) : (
                  <p className="text-xs text-fg-subtle">{t('attach.uploaded', { size: formatBytes(i.size) })}</p>
                )}
              </div>
              {i.state === 'uploading' ? (
                <Loader2 className="size-4 animate-spin text-fg-subtle" aria-label={t('attach.uploading')} />
              ) : (
                <Button variant="ghost" size="icon-sm" aria-label={t('attach.remove', { name: i.name })} onClick={() => void remove(i)} disabled={disabled}>
                  <Trash2 aria-hidden />
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

/** Read-only list of a filed report's attachments. URLs are fetched on click. */
export function AttachmentList({ items }: { items: AttachmentMeta[] }) {
  const { t } = useI18n();
  const [opening, setOpening] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const open = async (a: AttachmentMeta) => {
    setOpening(a.path);
    setError(null);
    // Open the tab synchronously (popup blockers), then point it at the file.
    // ("noopener" would make window.open return null, so detach the opener by hand.)
    const win = window.open('about:blank', '_blank');
    if (win) win.opener = null;
    try {
      const url = await attachmentUrl(a.path);
      if (win) win.location.href = url;
      else window.location.assign(url);
    } catch (err) {
      win?.close();
      setError(errorMessage(err));
    } finally {
      setOpening(null);
    }
  };

  if (!items.length) return <p className="text-sm text-fg-subtle">{t('attach.none')}</p>;
  return (
    <div className="flex flex-col gap-2">
      <ul className="divide-y divide-border rounded-md border border-border">
        {items.map((a) => (
          <li key={a.path}>
            <button
              type="button"
              onClick={() => void open(a)}
              className="flex w-full cursor-pointer items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-surface-2"
            >
              <Paperclip className="size-4 shrink-0 text-fg-subtle" aria-hidden />
              <span className="min-w-0 flex-1 truncate text-sm text-fg">{a.name}</span>
              <span className="shrink-0 text-xs text-fg-subtle">{opening === a.path ? t('attach.opening') : formatBytes(a.size)}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p className="text-xs text-critical">{error}</p>}
    </div>
  );
}
