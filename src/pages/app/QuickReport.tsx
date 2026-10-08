import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { collection, doc } from 'firebase/firestore';
import { Camera, Keyboard, Loader2, MapPin, Mic, Send, X } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { useReportScope } from '@/auth/scope';
import { AttachmentPicker, waitingFiles, type UploadItem } from '@/components/Attachments';
import { StructuredIncidentPanel } from '@/components/IncidentPanels';
import { VoiceInput } from '@/components/VoiceInput';
import { Button } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Field, Select, Textarea } from '@/components/ui/field';
import { useDebounced } from '@/hooks/data';
import { useReference } from '@/hooks/reference';
import { rich, translate, useI18n } from '@/i18n';
import { reportTypeKey } from '@/i18n/labels';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { firebase } from '@/lib/firebase';
import { submitOrQueue } from '@/offline/submit';
import { detectImage, getModelStatus, modelFor } from '@/ai/inference';
import { speechSupported } from '@/ai/speech';
import { api } from '@/services/callables';
import { COLLECTIONS, LIMITS, REPORT_TYPES, type ReportType } from '@/shared/constants';
import { analyse, draftCapa } from '@/shared/engine';
import { analysePhoto, type PhotoFinding } from '@/shared/hazards';
import { supportedPpe } from '@/shared/ppe';
import { structureReport } from '@/shared/structure';

interface Geo {
  lat: number;
  lng: number;
  accuracy: number | null;
}

const INSTALLATION_KEY = 'prahari.quickReport.installation';

function remembered(): string {
  try {
    return localStorage.getItem(INSTALLATION_KEY) ?? '';
  } catch {
    return '';
  }
}

/** Phone photos are large; the model reads 640 px anyway. */
async function downscale(file: File, max = 1280): Promise<Blob> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * s);
  c.height = Math.round(bmp.height * s);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  bmp.close();
  return new Promise((resolve, reject) => c.toBlob((b) => (b ? resolve(b) : reject(new Error(translate('quick.photoUnreadable')))), 'image/jpeg', 0.9));
}

/** Seconds a worker has to cancel or edit an AI-drafted report before it is sent. */
const AUTO_SUBMIT_SECONDS = 5;

type PhotoCheckState =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'found'; findings: PhotoFinding[]; models: string[] }
  | { state: 'none'; models: string[] }
  | { state: 'unavailable'; message: string };

function geoError(err: GeolocationPositionError): string {
  if (err.code === err.PERMISSION_DENIED) return translate('quick.geo.blocked');
  if (err.code === err.POSITION_UNAVAILABLE) return translate('quick.geo.unavailable');
  return translate('quick.geo.timeout');
}

/**
 * The fast path for a worker on a phone: speak or type, add a photo and the
 * location, submit. The same service call and scoring as the full form. With
 * ?incident=<id> it adds the account to an existing incident instead.
 */
function QuickReportForm({ onQueued }: { onQueued: () => void }) {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const seesAll = useReportScope().kind === 'all';
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const attachTo = params.get('incident');
  const { installations, loading: refLoading } = useReference();
  const active = installations.filter((i) => i.active);

  const [mode, setMode] = useState<'voice' | 'text' | 'photo'>(() => (speechSupported() ? 'voice' : 'text'));
  const [check, setCheck] = useState<PhotoCheckState>({ state: 'idle' });
  const [countdown, setCountdown] = useState<number | null>(null);
  const [aiDrafted, setAiDrafted] = useState(false);
  const textRef = useRef<HTMLTextAreaElement>(null);
  const [text, setText] = useState('');
  const [spoken, setSpoken] = useState(false);
  const [installationId, setInstallationId] = useState(remembered);
  const [type, setType] = useState<ReportType>('unsafe-condition');
  const [geo, setGeo] = useState<Geo | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoMsg, setGeoMsg] = useState<string | null>(null);
  const [uploads, setUploads] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const reportId = useMemo(() => doc(collection(firebase.db, COLLECTIONS.reports)).id, []);
  const onUploads = useCallback((items: UploadItem[]) => setUploads(items), []);

  const draft = useDebounced(text, 300);
  const installationName = installations.find((i) => i.id === installationId)?.name ?? null;
  const structured = useMemo(() => {
    if (draft.trim().length < LIMITS.reportTextMin) return null;
    const assessment = analyse(draft);
    return structureReport({
      text: draft,
      source: aiDrafted ? 'photo' : spoken ? 'voice' : 'text',
      assessment,
      capa: draftCapa(assessment, {}),
      installationName,
      geo,
    });
  }, [draft, spoken, aiDrafted, installationName, geo]);

  // A site is needed before anything can be sent: the person's own, or the only one.
  useEffect(() => {
    if (installationId || !active.length) return;
    const own = active.find((i) => i.id === profile?.installationId);
    if (own) setInstallationId(own.id);
    else if (active.length === 1) setInstallationId(active[0].id);
  }, [installationId, active.length, profile?.installationId]);

  const locate = () => {
    if (!navigator.geolocation) {
      setGeoMsg(t('quick.geo.unsupported'));
      return;
    }
    setLocating(true);
    setGeoMsg(null);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setGeo({ lat: p.coords.latitude, lng: p.coords.longitude, accuracy: p.coords.accuracy ?? null });
        setLocating(false);
      },
      (err) => {
        setGeoMsg(geoError(err));
        setLocating(false);
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 60_000 },
    );
  };

  /**
   * The AI photo check: every loaded model looks at the photo, the hazard
   * rules decide what it shows, and the report is filled in from that alone.
   * If the service is not available the worker is told, and nothing is guessed.
   */
  const checkPhoto = async (file: File) => {
    if (!file.type.startsWith('image/')) return;
    setCountdown(null);
    setCheck({ state: 'checking' });
    if (!geo && !locating) locate();
    const status = await getModelStatus();
    if (status.state !== 'ready') {
      setCheck({ state: 'unavailable', message: status.reason });
      return;
    }
    try {
      const r = await detectImage(await downscale(file));
      const ppe = modelFor(status.info, 'ppe');
      const result = analysePhoto(r.detections, {
        minConfidence: 0.5,
        requiredPpe: ppe ? supportedPpe(ppe.classes).filter((p) => p === 'helmet' || p === 'vest') : [],
        ppeMinConfidence: 0.6,
      });
      const models = status.info.models.map((m) => m.name);
      if (!result.type) {
        setCheck({ state: 'none', models });
        return;
      }
      setType(result.type);
      setText(result.description);
      setAiDrafted(true);
      setCheck({ state: 'found', findings: result.findings, models });
      setCountdown(AUTO_SUBMIT_SECONDS);
    } catch (err) {
      setCheck({ state: 'unavailable', message: errorMessage(err, (err as Error).message) });
    }
  };

  const uploading = uploads.some((u) => u.state === 'uploading');
  const canSubmit = text.trim().length >= (attachTo ? 3 : LIMITS.reportTextMin) && (attachTo || installationId) && !uploading;

  const submit = async () => {
    setError(null);
    if (!attachTo && !installationId) {
      setError(t('quick.error.chooseSite'));
      return;
    }
    if (text.trim().length < LIMITS.reportTextMin && !attachTo) {
      setError(t('quick.error.tooShort', { min: LIMITS.reportTextMin }));
      return;
    }
    setBusy(true);
    try {
      if (attachTo) {
        await api.addStatement({ reportId: attachTo, text: text.trim(), source: spoken ? 'voice' : 'text' });
        toast.success(t('quick.toast.accountAdded'));
        // Only people who can see every report can open someone else's incident.
        navigate(seesAll ? `/app/reports/${attachTo}` : '/app', { replace: true });
        return;
      }
      if (!user) return;
      const hour = new Date().getHours();
      const report = {
        reportId,
        text: text.trim(),
        installationId,
        type,
        shift: hour >= 6 && hour < 18 ? ('Day' as const) : ('Night' as const),
        contractor: false,
        attachments: uploads
          .filter((u) => u.state === 'done')
          .map((u) => ({ path: u.path, name: u.name, size: u.size, contentType: u.contentType })),
        source: aiDrafted ? ('photo' as const) : spoken ? ('voice' as const) : ('text' as const),
        geo,
        photoCheck:
          aiDrafted && check.state === 'found'
            ? { models: check.models, findings: check.findings.map((f) => ({ type: f.type, confidence: Number(f.confidence.toFixed(4)) })) }
            : null,
      };
      // Sent now, or kept on this device until the server can be reached.
      const outcome = await submitOrQueue(user.uid, report, waitingFiles(uploads));
      try {
        localStorage.setItem(INSTALLATION_KEY, installationId);
      } catch {
        /* optional */
      }
      if (outcome === 'queued') {
        toast.success(t('offline.saved'), { description: t('offline.savedDesc') });
        onQueued();
        return;
      }
      toast.success(t('quick.toast.submitted'), { description: t('quick.toast.scoring') });
      navigate(`/app/reports/${reportId}`, { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  // Auto-submit: counts down once the photo is uploaded and a site is set; any edit stops it.
  const submitRef = useRef(submit);
  submitRef.current = submit;
  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) {
      setCountdown(null);
      void submitRef.current();
      return;
    }
    if (uploading || !installationId || busy) return;
    const timer = window.setTimeout(() => setCountdown((c) => (c === null ? null : c - 1)), 1000);
    return () => window.clearTimeout(timer);
  }, [countdown, uploading, installationId, busy]);

  return (
    <div className="mx-auto flex w-full max-w-xl flex-col gap-4 pb-24">
      <div>
        <h1 className="text-[1.625rem] leading-9 font-bold tracking-[-0.02em] text-fg">
          {attachTo ? t('quick.addAccount') : t('nav.report')}
        </h1>
        <p className="mt-1 text-sm text-fg-muted">
          {attachTo
            ? rich(t('quick.addingTo'), {
                id: seesAll ? (
                  <Link to={`/app/reports/${attachTo}`} className="font-mono text-fg hover:underline">{attachTo.slice(0, 8)}</Link>
                ) : (
                  <span className="font-mono text-fg">{attachTo.slice(0, 8)}</span>
                ),
              })
            : t('quick.intro')}
        </p>
      </div>

      {error && <Alert tone="critical">{error}</Alert>}

      <div role="radiogroup" aria-label={t('quick.howToReport')} className={cn('grid gap-2', attachTo ? 'grid-cols-2' : 'grid-cols-3')}>
        {(
          [
            ['voice', <Mic key="m" className="size-5" />, t('quick.mode.voice')],
            ['text', <Keyboard key="k" className="size-5" />, t('quick.mode.text')],
            ['photo', <Camera key="c" className="size-5" />, t('quick.mode.photo')],
          ] as const
        )
          .filter(([value]) => !(attachTo && value === 'photo'))
          .map(([value, icon, label]) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={mode === value}
            onClick={() => setMode(value)}
            className={cn(
              'flex h-14 cursor-pointer items-center justify-center gap-2 rounded-2xl border text-sm font-semibold transition-colors',
              mode === value ? 'border-signal bg-signal-soft text-fg' : 'border-border-strong bg-surface text-fg-muted hover:text-fg',
            )}
          >
            {icon}
            {label}
          </button>
          ))}
      </div>

      {mode === 'voice' && <VoiceInput value={text} onChange={setText} onUsed={() => setSpoken(true)} size="lg" />}

      {mode === 'photo' && !attachTo && user && (
        <div className="flex flex-col gap-3 rounded-2xl border border-border bg-surface p-4">
          <p className="text-sm text-fg-muted">{t('quick.photo.intro', { seconds: AUTO_SUBMIT_SECONDS })}</p>
          <AttachmentPicker
            uid={user.uid}
            reportId={reportId}
            onChange={onUploads}
            onFile={(f) => void checkPhoto(f)}
            disabled={busy}
            variant="button"
            accept="image/jpeg,image/png,image/webp"
            capture="environment"
            buttonLabel={t('quick.photo.take')}
          />
          {check.state === 'checking' && (
            <p className="flex items-center gap-2 text-sm text-fg-muted" role="status">
              <Loader2 className="size-4 animate-spin" aria-hidden /> {t('quick.photo.checking')}
            </p>
          )}
          {check.state === 'found' && (
            <div className="flex flex-col gap-2" role="status">
              <p className="text-sm font-semibold text-fg">{t('quick.photo.found')}</p>
              <ul className="flex flex-col gap-1 text-sm text-fg-muted">
                {check.findings.map((f) => (
                  <li key={f.type}>
                    <span className="text-fg">{t(reportTypeKey(f.kind))}</span> · {f.text}
                  </li>
                ))}
              </ul>
              <p className="text-2xs text-fg-subtle">{t('quick.photo.models', { models: check.models.join(', ') })}</p>
            </div>
          )}
          {check.state === 'none' && (
            <Alert tone="info">{t('quick.photo.none')}</Alert>
          )}
          {check.state === 'unavailable' && (
            <Alert tone="warning">{t('quick.photo.unavailable', { reason: check.message })}</Alert>
          )}
          {countdown !== null && (
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-signal bg-signal-soft px-3 py-2 text-sm" role="alert">
              <span className="text-fg">
                {uploading
                  ? t('quick.photo.uploading')
                  : !installationId
                    ? t('quick.photo.chooseSite')
                    : t('quick.photo.sendingIn', { type: t(reportTypeKey(type)), seconds: countdown })}
              </span>
              <span className="flex gap-2">
                <Button size="sm" variant="ghost" onClick={() => setCountdown(null)}>
                  {t('common.cancel')}
                </Button>
                <Button
                  size="sm"
                  onClick={() => {
                    setCountdown(null);
                    textRef.current?.focus();
                  }}
                >
                  {t('common.edit')}
                </Button>
              </span>
            </div>
          )}
        </div>
      )}

      <Field
        label={mode === 'voice' ? t('quick.whatYouSaid') : t('quick.whatHappened')}
        aside={<span className="text-xs text-fg-subtle tabular">{text.length} / {LIMITS.reportTextMax}</span>}
      >
        <Textarea
          rows={5}
          maxLength={LIMITS.reportTextMax}
          ref={textRef}
          value={text}
          autoFocus={mode === 'text'}
          onChange={(e) => {
            setText(e.target.value);
            setCountdown(null); // the worker is changing it: they will send it themselves
          }}
          placeholder={t('quick.placeholder')}
          className="min-h-32 rounded-2xl text-md leading-7"
        />
      </Field>

      {!attachTo && (
        <>
          <Field label={t('quick.where')}>
            <Select value={installationId} onChange={(e) => setInstallationId(e.target.value)} disabled={refLoading} className="h-11 rounded-2xl">
              <option value="">{refLoading ? t('common.loadingEllipsis') : t('quick.chooseInstallation')}</option>
              {active.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                </option>
              ))}
            </Select>
          </Field>

          <div role="radiogroup" aria-label={t('quick.type')} className="grid grid-cols-3 gap-2">
            {REPORT_TYPES.map((rt) => (
              <button
                key={rt}
                type="button"
                role="radio"
                aria-checked={type === rt}
                onClick={() => setType(rt)}
                className={cn(
                  'min-h-10 cursor-pointer rounded-full border px-2 py-1 text-xs leading-4 font-semibold transition-colors',
                  type === rt ? 'border-fg/40 bg-surface-3 text-fg' : 'border-border-strong text-fg-muted hover:text-fg',
                )}
              >
                {t(reportTypeKey(rt))}
              </button>
            ))}
          </div>

          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {user && mode !== 'photo' && (
              <AttachmentPicker
                uid={user.uid}
                reportId={reportId}
                onChange={onUploads}
                disabled={busy}
                variant="button"
                accept="image/jpeg,image/png,image/webp"
                capture="environment"
                buttonLabel={t('quick.addPhoto')}
              />
            )}
            {geo ? (
              <div className="flex h-12 items-center justify-between gap-2 rounded-2xl border border-success-line bg-success-soft px-4 text-sm">
                <span className="flex min-w-0 items-center gap-2 text-fg">
                  <MapPin className="size-4 shrink-0 text-success" aria-hidden />
                  <span className="truncate font-mono text-xs">
                    {geo.lat.toFixed(5)}, {geo.lng.toFixed(5)}
                    {geo.accuracy ? ` ±${Math.round(geo.accuracy)} m` : ''}
                  </span>
                </span>
                <button type="button" aria-label={t('quick.removeLocation')} onClick={() => setGeo(null)} className="cursor-pointer text-fg-muted hover:text-fg">
                  <X className="size-4" />
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={locate}
                disabled={locating}
                className="flex h-12 cursor-pointer items-center justify-center gap-2 rounded-2xl border border-border-strong bg-surface-2 text-sm font-semibold text-fg transition-colors hover:bg-surface-3 disabled:opacity-60"
              >
                {locating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <MapPin className="size-4" aria-hidden />}
                {locating ? t('quick.findingLocation') : t('quick.addLocation')}
              </button>
            )}
          </div>
          {geoMsg && <p className="text-xs text-warning">{geoMsg}</p>}
        </>
      )}

      {structured && !attachTo && <StructuredIncidentPanel structured={structured} preview />}

      <div className="fixed inset-x-0 bottom-0 z-20 border-t border-border bg-canvas/95 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] backdrop-blur-sm lg:static lg:border-0 lg:bg-transparent lg:p-0">
        <div className="mx-auto max-w-xl">
          <Button variant="primary" size="lg" className="h-12 w-full" loading={busy} disabled={!canSubmit} onClick={() => void submit()}>
            {!busy && <Send aria-hidden />} {attachTo ? t('quick.addToIncident') : t('quick.submit')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Starts a fresh form (with its own report id) after a report has been kept on
 * the device, so the next one can be filed straight away — without leaving a
 * screen that is known to be loaded, which matters when there is no connection.
 */
export default function QuickReport() {
  const [form, setForm] = useState(0);
  return <QuickReportForm key={form} onQueued={() => setForm((n) => n + 1)} />;
}
