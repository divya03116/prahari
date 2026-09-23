import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { Link, useNavigate } from 'react-router-dom';
import { collection, doc } from 'firebase/firestore';
import { Info } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { AttachmentPicker, type UploadItem } from '@/components/Attachments';
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
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { firebase } from '@/lib/firebase';
import { api } from '@/services/callables';
import { removeUpload } from '@/services/storage';
import { COLLECTIONS, LIMITS, REPORT_TYPE_LABEL, REPORT_TYPES, SHIFTS } from '@/shared/constants';
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
  const deferred = useDebounced(text, 250);
  const result = useMemo(() => (deferred.trim().length >= LIMITS.reportTextMin ? analyse(deferred) : null), [deferred]);

  return (
    <Panel className="lg:sticky lg:top-6">
      <PanelHeader title="Preview" description="Computed in your browser as you type" />
      <PanelBody className="flex flex-col gap-4">
        {result ? (
          <>
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <span className="text-3xl font-semibold tracking-tight text-fg tabular">{result.score}</span>
                <TierBadge tier={result.tier} />
              </div>
              <ScoreBar score={result.score} tier={result.tier} />
              <p className="mt-2 text-xs text-fg-subtle">Response window if confirmed: {result.responseWindow}</p>
            </div>
            <EvidenceText text={deferred} spans={result.evidence} className="max-h-48 overflow-y-auto text-sm leading-6" />
            <FindingsGrid energy={result.energy} barrier={result.barrier} exposure={result.exposure} />
            <RuleNet rules={result.rulesTriggered} escalated={result.escalated} preRuleScore={result.preRuleScore} />
          </>
        ) : (
          <p className="text-sm text-fg-subtle">
            Describe what happened and the preview appears here: the hazardous energy, the control that failed, and who was
            exposed.
          </p>
        )}
        <p className="flex gap-2 border-t border-border pt-3 text-xs text-fg-subtle">
          <Info className="mt-px size-3.5 shrink-0" aria-hidden />
          A preview only. The score of record is computed by the server when you file, and cannot be edited.
        </p>
      </PanelBody>
    </Panel>
  );
}

export default function NewReport() {
  const { user } = useAuth();
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
      setError('Wait for the attachments to finish uploading.');
      return;
    }
    try {
      const attachments = uploads
        .filter((u) => u.state === 'done')
        .map((u) => ({ path: u.path, name: u.name, size: u.size, contentType: u.contentType }));
      await api.submitReport({ ...values, reportId, attachments, source: spoken ? 'voice' : 'text' });
      submitted.current = true;
      toast.success('Report filed', { description: 'The server is scoring it now.' });
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
            Reports
          </Link>
        }
        title="New report"
        description="Describe what you saw in your own words — English, Hindi, Assamese, Bengali or a mix. Name the hazard, what failed, and who was near it. Never name the person involved."
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <form onSubmit={onSubmit} noValidate className="flex min-w-0 flex-col gap-6">
          <Panel>
            <PanelBody className="flex flex-col gap-5">
              {error && <Alert tone="critical">{error}</Alert>}

              <VoiceInput
                value={text}
                onChange={(t) => setValue('text', t, { shouldValidate: t.trim().length >= LIMITS.reportTextMin })}
                onUsed={() => setSpoken(true)}
              />

              <Field
                label="What happened"
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
                  placeholder="e.g. Scaffold at the crude unit had no toe board on the third lift. A fitter was working directly below without a barricade."
                  className="min-h-40 text-md leading-7"
                  {...register('text')}
                />
              </Field>

              <div className="flex flex-col gap-1.5">
                <Label>
                  <span id="type-label">Type</span>
                </Label>
                <RadioRow
                  name="type"
                  labelledBy="type-label"
                  value={type}
                  onChange={(v) => setValue('type', v, { shouldValidate: true })}
                  options={REPORT_TYPES.map((t) => ({ value: t, label: REPORT_TYPE_LABEL[t] }))}
                />
              </div>

              <div className="grid gap-5 sm:grid-cols-2">
                <Field label="Installation" error={errors.installationId ? 'Choose an installation' : undefined}>
                  <Select {...register('installationId')} disabled={refLoading}>
                    <option value="">{refLoading ? 'Loading…' : 'Select installation'}</option>
                    {activeInstallations.map((i) => (
                      <option key={i.id} value={i.id}>
                        {i.name}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Activity" error={errors.activityId ? 'Choose an activity' : undefined}>
                  <Select {...register('activityId')} disabled={refLoading}>
                    <option value="">{refLoading ? 'Loading…' : 'Select activity'}</option>
                    {activeActivities.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
              {!refLoading && (activeInstallations.length === 0 || activeActivities.length === 0) && (
                <Alert tone="warning" title="Reference data is missing">
                  An administrator needs to add at least one installation and one activity before reports can be filed.
                </Alert>
              )}

              <div className="grid gap-5 sm:grid-cols-2">
                <div className="flex flex-col gap-1.5">
                  <Label>
                    <span id="shift-label">Shift</span>
                  </Label>
                  <RadioRow
                    name="shift"
                    labelledBy="shift-label"
                    value={shift}
                    onChange={(v) => setValue('shift', v, { shouldValidate: true })}
                    options={SHIFTS.map((s) => ({ value: s, label: s }))}
                  />
                </div>
                <label className="flex cursor-pointer items-center gap-2.5 self-end rounded-md border border-border-strong bg-surface px-3 py-2 text-sm text-fg-muted">
                  <Checkbox {...register('contractor')} />
                  A contractor was involved
                </label>
              </div>
            </PanelBody>
          </Panel>

          <Panel>
            <PanelHeader title="Attachments" description="Optional photos or documents" />
            <PanelBody>
              {user && <AttachmentPicker uid={user.uid} reportId={reportId} onChange={onUploads} disabled={isSubmitting} />}
            </PanelBody>
          </Panel>

          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Link to="/app/reports" className={buttonClass({ variant: 'ghost' })}>
              Cancel
            </Link>
            <Button type="submit" variant="primary" loading={isSubmitting} disabled={uploading}>
              {uploading ? 'Uploading…' : 'File report'}
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
