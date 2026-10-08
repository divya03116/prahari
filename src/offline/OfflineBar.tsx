import { useCallback, useEffect, useState } from 'react';
import { CloudUpload, WifiOff } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert } from '@/components/ui/feedback';
import { useI18n } from '@/i18n';
import { formatRelative } from '@/lib/format';

import { discardQueuedReport, onOutboxChange, queuedReports, retryQueuedReport, sendQueuedReports, type QueuedReport } from './outbox';

export function useOnline(): boolean {
  const [online, setOnline] = useState(() => navigator.onLine);
  useEffect(() => {
    const on = () => setOnline(true);
    const off = () => setOnline(false);
    window.addEventListener('online', on);
    window.addEventListener('offline', off);
    return () => {
      window.removeEventListener('online', on);
      window.removeEventListener('offline', off);
    };
  }, []);
  return online;
}

/**
 * Connection and outbox status, shown above every screen when there is
 * something to say: the device is offline, reports are waiting on it, or the
 * server refused one. It also does the sending — when the connection returns,
 * when the app comes back to the front, and once a minute while reports wait.
 */
export function OfflineBar() {
  const { user } = useAuth();
  const { t } = useI18n();
  const online = useOnline();
  const [items, setItems] = useState<QueuedReport[]>([]);
  const [busy, setBusy] = useState(false);
  const [discarding, setDiscarding] = useState<QueuedReport | null>(null);
  const uid = user?.uid;

  const refresh = useCallback(() => {
    if (!uid) return;
    queuedReports(uid)
      .then(setItems)
      .catch(() => setItems([]));
  }, [uid]);

  useEffect(() => {
    refresh();
    return onOutboxChange(refresh);
  }, [refresh]);

  const send = useCallback(async () => {
    if (!uid || !navigator.onLine) return;
    setBusy(true);
    try {
      const { sent } = await sendQueuedReports(uid);
      if (sent) toast.success(t(sent === 1 ? 'offline.sent.one' : 'offline.sent.many', { count: sent }));
    } finally {
      setBusy(false);
    }
  }, [uid, t]);

  const waiting = items.filter((i) => !i.error);
  const refused = items.filter((i) => i.error);

  useEffect(() => {
    if (!waiting.length) return;
    if (online) void send();
    const onVisible = () => {
      if (document.visibilityState === 'visible') void send();
    };
    document.addEventListener('visibilitychange', onVisible);
    const timer = window.setInterval(() => void send(), 60_000);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(timer);
    };
  }, [waiting.length, online, send]);

  if (online && !items.length) return null;

  return (
    <div className="mb-4 flex flex-col gap-2 print:hidden" data-testid="offline-bar">
      {!online && (
        <Alert tone="warning">
          <span className="flex items-start gap-2">
            <WifiOff className="mt-0.5 size-4 shrink-0 text-warning" aria-hidden />
            {t('offline.banner')}
          </span>
        </Alert>
      )}

      {waiting.length > 0 && (
        <Alert
          tone="info"
          title={
            <span className="flex items-start gap-2">
              <CloudUpload className="mt-0.5 size-4 shrink-0" aria-hidden />
              {t(waiting.length === 1 ? 'offline.waiting.one' : 'offline.waiting.many', { count: waiting.length })}
            </span>
          }
          action={
            online ? (
              <Button size="sm" loading={busy} onClick={() => void send()}>
                {t('offline.sendNow')}
              </Button>
            ) : undefined
          }
        >
          <ul className="mt-1 flex flex-col gap-1">
            {waiting.map((r) => (
              <li key={r.id} className="flex items-baseline justify-between gap-3 text-xs">
                <span className="min-w-0 truncate text-fg-muted">{r.payload.text}</span>
                <span className="shrink-0 text-fg-subtle">{formatRelative(r.queuedAt)}</span>
              </li>
            ))}
          </ul>
          {!online && <p className="mt-1 text-xs text-fg-subtle">{t('offline.autoSend')}</p>}
        </Alert>
      )}

      {refused.map((r) => (
        <Alert
          key={r.id}
          tone="critical"
          title={t('offline.refused')}
          action={
            <span className="flex gap-2">
              <Button size="sm" variant="ghost" onClick={() => setDiscarding(r)}>
                {t('offline.discard')}
              </Button>
              <Button size="sm" onClick={() => void retryQueuedReport(r.id)}>
                {t('common.tryAgain')}
              </Button>
            </span>
          }
        >
          <span className="block truncate text-xs text-fg-muted">{r.payload.text}</span>
          {r.error}
        </Alert>
      ))}

      <ConfirmDialog
        open={Boolean(discarding)}
        onOpenChange={(o) => !o && setDiscarding(null)}
        title={t('offline.discard.title')}
        description={t('offline.discard.desc')}
        confirmLabel={t('offline.discard')}
        onConfirm={async () => {
          if (discarding) await discardQueuedReport(discarding.id);
        }}
      />
    </div>
  );
}
