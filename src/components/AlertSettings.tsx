/**
 * Tier 1 alerts, as the person receiving them sees them:
 *
 * - AlertSettingsPanel (Settings): choose email and/or WhatsApp. It says
 *   plainly when a channel is not set up on the server, so nobody relies on an
 *   alert that cannot arrive.
 * - AlertStatus (a Tier 1 report, officers only): what was actually sent.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { doc, onSnapshot } from 'firebase/firestore';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { Button } from '@/components/ui/button';
import { Alert, Skeleton } from '@/components/ui/feedback';
import { Checkbox, Field, Input } from '@/components/ui/field';
import { Panel, PanelBody, PanelFooter, PanelHeader } from '@/components/ui/panel';
import { useI18n, type MessageKey, type Translate } from '@/i18n';
import { errorMessage } from '@/lib/errors';
import { firebase } from '@/lib/firebase';
import { api } from '@/services/callables';
import { COLLECTIONS } from '@/shared/constants';
import { alertSettingsSchema, type AlertSettings } from '@/shared/schemas';
import type { AlertChannelResult, AlertDoc } from '@/shared/types';

const STATUS_KEY: Record<AlertChannelResult['status'], MessageKey> = {
  sent: 'alerts.status.sent',
  partial: 'alerts.status.partial',
  failed: 'alerts.status.failed',
  'not-configured': 'alerts.status.notConfigured',
  'no-recipients': 'alerts.status.noRecipients',
};

/** "sent to 3", "2 sent, 1 failed", "not set up" … exactly what the provider reported. */
function describe(t: Translate, result: AlertChannelResult | undefined): string {
  if (!result) return t('alerts.status.sending');
  return t(STATUS_KEY[result.status], { sent: result.sent, failed: result.failed });
}

export function AlertSettingsPanel() {
  const { user, can } = useAuth();
  const { t } = useI18n();
  const eligible = can('installation-manager');
  const [channels, setChannels] = useState<{ email: boolean; whatsapp: boolean } | null>(null);
  const [saved, setSaved] = useState<AlertSettings | null>(null);
  const [form, setForm] = useState<AlertSettings>({ email: true, whatsapp: false, whatsappNumber: '' });
  const [error, setError] = useState<string | null>(null);
  const [numberError, setNumberError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);

  useEffect(() => {
    if (!eligible) return;
    let live = true;
    api
      .getAlertSettings()
      .then((res) => {
        if (!live) return;
        setChannels(res.channels);
        setSaved(res.settings);
        setForm(res.settings);
      })
      .catch((err) => live && setError(errorMessage(err)));
    return () => {
      live = false;
    };
  }, [eligible]);

  if (!eligible) return null;

  const dirty = saved !== null && JSON.stringify(saved) !== JSON.stringify(form);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setNumberError(null);
    const parsed = alertSettingsSchema.safeParse(form);
    if (!parsed.success) {
      setNumberError(t(form.whatsappNumber.trim() ? 'alerts.numberInvalid' : 'alerts.numberRequired'));
      return;
    }
    setSaving(true);
    try {
      await api.setAlertSettings(parsed.data);
      setSaved(parsed.data);
      setForm(parsed.data);
      toast.success(t('alerts.saved'));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setSaving(false);
    }
  };

  const test = async () => {
    setTesting(true);
    try {
      const res = await api.sendTestAlert();
      toast.message(t('alerts.testDone'), {
        description: `${t('auth.email')}: ${describe(t, res.email)} · WhatsApp: ${describe(t, res.whatsapp)}`,
        duration: 12_000,
      });
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setTesting(false);
    }
  };

  return (
    <Panel>
      <form onSubmit={save} noValidate>
        <PanelHeader title={t('alerts.title')} description={t('alerts.description')} />
        <PanelBody className="flex flex-col gap-4">
          {error ? (
            <Alert tone="critical">{error}</Alert>
          ) : !channels ? (
            <>
              <Skeleton className="h-5 w-56" />
              <Skeleton className="h-5 w-40" />
            </>
          ) : (
            <>
              <div className="flex flex-col gap-1">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-fg">
                  <Checkbox checked={form.email} disabled={!user?.email} onChange={(e) => setForm({ ...form, email: e.target.checked })} />
                  {t('auth.email')}
                  {user?.email && <span className="truncate text-fg-subtle">{user.email}</span>}
                </label>
                {!user?.email && <p className="pl-6.5 text-xs text-fg-subtle">{t('alerts.noEmailOnAccount')}</p>}
                {!channels.email && <p className="pl-6.5 text-xs text-warning">{t('alerts.emailNotSetUp')}</p>}
              </div>

              <div className="flex flex-col gap-2">
                <label className="flex cursor-pointer items-center gap-2.5 text-sm text-fg">
                  <Checkbox checked={form.whatsapp} onChange={(e) => setForm({ ...form, whatsapp: e.target.checked })} />
                  WhatsApp
                </label>
                <Field label={t('alerts.whatsappNumber')} hint={t('alerts.whatsappHint')} error={numberError ?? undefined}>
                  <Input
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="+91 98765 43210"
                    value={form.whatsappNumber}
                    onChange={(e) => setForm({ ...form, whatsappNumber: e.target.value, whatsapp: e.target.value.trim() ? form.whatsapp : false })}
                  />
                </Field>
                {!channels.whatsapp && <p className="text-xs text-warning">{t('alerts.whatsappNotSetUp')}</p>}
              </div>
            </>
          )}
        </PanelBody>
        <PanelFooter>
          {can('admin') && (
            <Button size="sm" variant="ghost" loading={testing} disabled={!channels || dirty} onClick={() => void test()}>
              {t('alerts.sendTest')}
            </Button>
          )}
          <Button type="submit" variant="primary" size="sm" loading={saving} disabled={!dirty}>
            {t('common.save')}
          </Button>
        </PanelFooter>
      </form>
    </Panel>
  );
}

/** One line on a Tier 1 report: which alerts went out. Officers and administrators only. */
export function AlertStatus({ reportId }: { reportId: string }) {
  const { t } = useI18n();
  const [alert, setAlert] = useState<AlertDoc | null>(null);

  useEffect(
    () =>
      onSnapshot(
        doc(firebase.db, COLLECTIONS.alerts, reportId),
        (snap) => setAlert(snap.exists() ? (snap.data() as AlertDoc) : null),
        () => setAlert(null),
      ),
    [reportId],
  );

  if (!alert) return <span className="text-fg-subtle">{t('alerts.status.none')}</span>;
  if (alert.status === 'failed') return <span className="text-critical">{t('alerts.status.failed', { sent: 0, failed: 0 })}</span>;
  return (
    <span className="block text-left sm:text-right">
      <span className="block">
        {t('auth.email')}: {describe(t, alert.email)}
      </span>
      <span className="block">WhatsApp: {describe(t, alert.whatsapp)}</span>
    </span>
  );
}
