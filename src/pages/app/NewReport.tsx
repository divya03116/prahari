import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { collection, doc } from 'firebase/firestore';
import { Info } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { AttachmentPicker, waitingFiles, type UploadItem } from '@/components/Attachments';
import { VoiceInput } from '@/components/VoiceInput';
import { EvidenceText, FindingsGrid, RuleNet, ScoreBar } from '@/components/assessment';
import { TierBadge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Checkbox, Field, Label, Select, Textarea } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/misc';
import { Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { useDebounced } from '@/hooks/data';
import { useReference } from '@/hooks/reference';
import { useI18n } from '@/i18n';
import { reportTypeKey, shiftKey } from '@/i18n/labels';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { firebase } from '@/lib/firebase';
import { submitOrQueue } from '@/offline/submit';
import { removeUpload } from '@/services/storage';
import { COLLECTIONS, LIMITS, REPORT_TYPES, SHIFTS } from '@/shared/constants';
import { analyse } from '@/shared/engine';
import { reportFieldsSchema, type ReportFields } from '@/shared/schemas';

function RadioRow<T extends string>({
  name,
  value,
  options,
  onChange,
  labelledBy,
}: {
  name: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (v: T) => void;
  labelledBy: string;
}) {
  return (
    <div role="radiogroup" aria-labelledby={labelledBy} className="grid gap-1.5" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((o) => (
        <label
          key={o.value}
          className={cn(
            'flex h-8 cursor-pointer items-center justify-center rounded-md border px-2 text-sm transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal',
            value === o.value
              ? 'border-fg/40 bg-surface-3 text-fg'
              : 'border-border-strong bg-surface text-fg-muted hover:text-fg',
          )}
        >
          <input
            type="radio"
            name={name}
            value={o.value}
            checked={value === o.value}
            onChange={() => onChange(o.value)}
            className="sr-only"
          />
          <span className="truncate">{o.label}</span>
        </label>
      ))}
    </div>
  );
}

function LivePreview({ text }: { text: string }) {
  const { t } = useI18n();
  const deferred = useDebounced(text, 250);
  const result = useMemo(() => (deferred.trim().length >= LIMITS.reportTextMin ? analyse(deferred) : null), [deferred]);

  return (
    <Panel className="lg:sticky lg:top-6">
      <PanelHeader title={t('new.preview')} description={t('new.previewDesc')} />
      <PanelBody className="flex flex-col gap-4">
        {result ? (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-3xl font-semibold tracking-tight text-fg tabular">{result.score}</span>
                <TierBadge tier={result.tier} />
              </div>
              <ScoreBar score={result.score} tier={result.tier} />
              <p className="mt-2 text-xs text-fg-subtle">{t('new.responseWindow', { window: result.responseWindow })}</p>
            </div>
            <EvidenceText text={deferred} spans={result.evidence} className="max-h-48 overflow-y-auto text-sm leading-6" />
            <FindingsGrid energy={result.energy} barrier={result.barrier} exposure={result.exposure} />
            <RuleNet rules={result.rulesTriggered} escalated={result.escalated} preRuleScore={result.preRuleScore} />
          </>
        ) : (
          <p className="text-sm text-fg-subtle">{t('new.previewEmpty')}</p>
        )}
        <p className="flex gap-2 border-t border-border pt-3 text-xs text-fg-subtle">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          {t('new.previewNote')}
        </p>
      </PanelBody>
    </Panel>
  );
}

function NewReportForm({ onQueued }: { onQueued: () => void }) {
  const { user } = useAuth();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { installations, activities, loading: refLoading } = useReference();
  const reportId = useMemo(() => doc(collection(firebase.db, COLLECTIONS.reports)).id, []);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [spoken, setSpoken] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submitted = useRef(false);
  const uploadsRef = useRef<UploadItem[]>([]);
  uploadsRef.current = uploads;

  const activeInstallations = installations.filter((i) => i.active);
  const activeActivities = activities.filter((a) => a.active);

  const {
    register,
    handleSubmit,
    control,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<ReportFields>({
    resolver: zodResolver(reportFieldsSchema),
    defaultValues: { text: '', installationId: '', activityId: '', shift: 'Day', type: 'unsafe-condition', contractor: false },
  });
  const text = useWatch({ control, name: 'text' }) ?? '';
  const type = useWatch({ control, name: 'type' });
  const shift = useWatch({ control, name: 'shift' });

  // Leaving without filing: remove what was uploaded, best-effort.
  useEffect(
    () => () => {
      if (submitted.current) return;
      for (const u of uploadsRef.current) if (u.state === 'done') void removeUpload(u.path).catch(() => undefined);
    },
    [],
  );

  const onUploads = useCallback((items: UploadItem[]) => setUploads(items), []);
  const uploading = uploads.some((u) => u.state === 'uploading');

  const onSubmit = handleSubmit(async (values) => {
    setError(null);
    if (uploading) {
      setError(t('new.waitUploads'));
      return;
    }
    try {
      const attachments = uploads
        .filter((u) => u.state === 'done')
        .map((u) => ({ path: u.path, name: u.name, size: u.size, contentType: u.contentType }));
      if (!user) return;
      // Sent now, or kept on this device until the server can be reached.
      const outcome = await submitOrQueue(user.uid, { ...values, reportId, attachments, source: spoken ? 'voice' : 'text' }, waitingFiles(uploads));
      submitted.current = true;
      if (outcome === 'queued') {
        toast.success(t('offline.saved'), { description: t('offline.savedDesc') });
        onQueued();
        return;
      }
      toast.success(t('new.filed'), { description: t('new.filedDesc') });
      navigate(`/app/reports/${reportId}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    }
  });

  const chars = text.length;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link to="/app/reports" className="hover:text-fg">
            {t('nav.reports')}
          </Link>
        }
        title={t('nav.newReport')}
        description={t('new.description')}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-6">
          <Panel>
            <PanelBody className="flex flex-col gap-5">
              {error && <Alert tone="critical">{error}</Alert>}

              <VoiceInput
                value={text}
                onChange={(heard) => setValue('text', heard, { shouldValidate: heard.trim().length >= LIMITS.reportTextMin })}
                onUsed={() => setSpoken(true)}
              />

              <Field
                label={t('quick.whatHappened')}
                error={errors.text?.message}
                aside={
                  <span className={cn('text-xs tabular', chars > LIMITS.reportTextMax ? 'text-critical' : 'text-fg-subtle')}>
                    {chars} / {LIMITS.reportTextMax}
                  </span>
                }
              >
                <Textarea
                  rows={7}
                  autoFocus
                  placeholder={t('new.placeholder')}
                  className="min-h-40 text-md leading-7"
                  {...register('text')}
                />
              </Field>

              <div className="flex flex-col gap-1.5">
                <Label>
                  <span id="type-label">{t('quick.type')}</span>
                </Label>
                <RadioRow
                  name="type"
                  labelledBy="type-label"
                  value={type}
                  onChange={(v) => setValue('type', v, { shouldValidate: true })}
                  options={REPORT_TYPES.map((rt) => ({ value: rt, label: t(reportTypeKey(rt)) }))}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label={t('reports.installation')} error={errors.installationId ? t('new.chooseInstallation') : undefined}>
                  <Select {...register('installationId')} disabled={refLoading}>
                    <option value="">{refLoading ? t('common.loadingEllipsis') : t('new.selectInstallation')}</option>
                    {activeInstallations.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label={t('detail.activity')} error={errors.activityId ? t('new.chooseActivity') : undefined}>
                  <Select {...register('activityId')} disabled={refLoading}>
                    <option value="">{refLoading ? t('common.loadingEllipsis') : t('new.selectActivity')}</option>
                    {activeActivities.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {!refLoading && (activeInstallations.length === 0 || activeActivities.length === 0) && (
                <Alert tone="warning" title={t('new.refMissing.title')}>
                  {t('new.refMissing.body')}
                </Alert>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>
                    <span id="shift-label">{t('detail.shift')}</span>
                  </Label>
                  <RadioRow
                    name="shift"
                    labelledBy="shift-label"
                    value={shift}
                    onChange={(v) => setValue('shift', v, { shouldValidate: true })}
                    options={SHIFTS.map((s) => ({ value: s, label: t(shiftKey(s)) }))}
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2.5 self-end rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg-muted">
                  <Checkbox {...register('contractor')} />
                  {t('new.contractor')}
                </label>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title={t('detail.attachments')} description={t('new.attachmentsDesc')} />
            <PanelBody>
              {user && <AttachmentPicker uid={user.uid} reportId={reportId} onChange={onUploads} disabled={isSubmitting} />}
            </PanelBody>
          </Panel>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link to="/app/reports" className={buttonClass({ variant: 'ghost' })}>
              {t('common.cancel')}
            </Link>
            <Button type="submit" variant="primary" loading={isSubmitting} disabled={uploading}>
              {uploading ? t('new.uploading') : t('new.file')}
            </Button>
          </div>
        </form>

        <aside className="min-w-0">
          <LivePreview text={text} />
        </aside>
      </div>
    </>
  );
}

/** Starts a fresh form after a report has been kept on the device (see QuickReport). */
export default function NewReport() {
  const [form, setForm] = useState(0);
  return <NewReportForm key={form} onQueued={() => setForm((n) => n + 1)} />;
}
