/**
 * Panels for the incident sources on a report: the structured incident, the
 * camera evidence (PPE or hazard), the AI photo check, and workers' voice/text
 * statements. One incident can carry all of them, each shown as a separate
 * evidence source.
 */

import { useEffect, useState, type FormEvent } from 'react';
import { Camera, Image as ImageIcon, Keyboard, Mic, Sparkles } from 'lucide-react';
import { toast } from 'sonner';

import { VoiceInput } from '@/components/VoiceInput';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { DataRow, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { useI18n, type MessageKey } from '@/i18n';
import { ppeKey, reportTypeKey, sourceKey } from '@/i18n/labels';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { api } from '@/services/callables';
import { attachmentUrl } from '@/services/storage';
import { LIMITS } from '@/shared/constants';
import { HAZARDS } from '@/shared/hazards';
import type { PpeType } from '@/shared/ppe';
import { NOT_SPECIFIED, type ReportSource, type StructuredIncident } from '@/shared/structure';
import type { ReportDoc, WithId } from '@/shared/types';

export function SourceBadge({ source }: { source: ReportSource | undefined }) {
  const { t } = useI18n();
  const s = source ?? 'text';
  const icon =
    s === 'camera' ? <Camera className="size-3" /> : s === 'photo' ? <ImageIcon className="size-3" /> : s === 'voice' ? <Mic className="size-3" /> : <Keyboard className="size-3" />;
  return (
    <Badge tone={s === 'camera' || s === 'photo' ? 'signal' : 'neutral'}>
      {icon}
      {t(sourceKey(s))}
    </Badge>
  );
}

const FIELDS: [keyof StructuredIncident, MessageKey][] = [
  ['title', 'incident.field.title'],
  ['hazardType', 'incident.field.hazardType'],
  ['location', 'incident.field.location'],
  ['severity', 'incident.field.severity'],
  ['potentialConsequence', 'incident.field.potentialConsequence'],
  ['recommendedAction', 'incident.field.recommendedAction'],
  ['description', 'incident.field.description'],
];

export function StructuredIncidentPanel({
  structured,
  preview = false,
  createdAt,
}: {
  structured: StructuredIncident;
  preview?: boolean;
  createdAt?: ReportDoc['createdAt'];
}) {
  const { t } = useI18n();
  return (
    <Panel>
      <PanelHeader
        title={t('incident.structured.title')}
        description={preview ? t('incident.structured.previewDesc') : t('incident.structured.desc')}
        actions={
          <Badge tone="info">
            <Sparkles className="size-3" /> {t('incident.structured.badge')}
          </Badge>
        }
      />
      <PanelBody className="py-1">
        <dl className="divide-y divide-border">
          {FIELDS.map(([key, label]) => {
            const v = String(structured[key] ?? NOT_SPECIFIED);
            return (
              <DataRow key={key} label={t(label)}>
                <span className={cn('block text-left sm:text-right', v === NOT_SPECIFIED && 'text-fg-subtle italic')}>
                  {v === NOT_SPECIFIED ? t('common.notSpecified') : v}
                </span>
              </DataRow>
            );
          })}
          <DataRow label={t('incident.source')}>
            <SourceBadge source={structured.source} />
          </DataRow>
          {createdAt && <DataRow label={t('incident.timestamp')}>{formatDateTime(createdAt)}</DataRow>}
        </dl>
        <details className="border-t border-border py-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">{t('incident.original')}</summary>
          <p className="mt-2 whitespace-pre-wrap text-fg-muted">{structured.originalReport}</p>
        </details>
      </PanelBody>
    </Panel>
  );
}

/** The evidence frame with every worker's box drawn over it. */
export function CameraEvidencePanel({ report }: { report: WithId<ReportDoc> }) {
  const { t } = useI18n();
  const ppe = report.ppe;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!ppe?.evidencePath) return;
    attachmentUrl(ppe.evidencePath)
      .then(setUrl)
      .catch((err) => setError(errorMessage(err)));
  }, [ppe?.evidencePath]);

  if (!ppe) return null;
  const violated = new Set(ppe.violations.map((v) => v.trackId));

  return (
    <Panel>
      <PanelHeader
        title={t('incident.camera.title')}
        description={`${report.camera?.label ?? t('incident.camera.fallback')} · ${formatDateTime(ppe.detectedAt)}`}
        actions={<SourceBadge source="camera" />}
      />
      <PanelBody className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-xl border border-border bg-canvas" style={{ aspectRatio: `${ppe.frame.width} / ${ppe.frame.height}` }}>
          {url ? (
            <img src={url} alt={t('incident.camera.altViolation')} className="absolute inset-0 size-full object-contain" />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">{error ?? t('incident.camera.loading')}</p>
          )}
          <svg viewBox={`0 0 ${ppe.frame.width} ${ppe.frame.height}`} className="absolute inset-0 size-full" aria-hidden>
            {ppe.workers.map((w) => (
              <g key={w.trackId}>
                <rect
                  x={w.box.x1}
                  y={w.box.y1}
                  width={w.box.x2 - w.box.x1}
                  height={w.box.y2 - w.box.y1}
                  fill="none"
                  stroke={violated.has(w.trackId) ? '#eb5757' : '#3fa66d'}
                  strokeWidth={Math.max(2, ppe.frame.width / 320)}
                />
                <text x={w.box.x1 + 4} y={w.box.y1 + Math.max(14, ppe.frame.width / 60)} fill="#fff" fontSize={Math.max(12, ppe.frame.width / 60)} fontWeight={700}>
                  W{w.trackId}
                </text>
              </g>
            ))}
          </svg>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          {ppe.workers.map((w) => (
            <div key={w.trackId} className="rounded-xl border border-border bg-surface-2 p-3 text-sm">
              <p className="font-semibold text-fg">
                {t('incident.worker', { id: w.trackId })}{' '}
                <span className="font-normal text-fg-subtle">{t('incident.person', { percent: Math.round(w.confidence * 100) })}</span>
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {ppe.required.map((item) => {
                  const s = w.ppe[item];
                  return (
                    <li key={item} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-fg-muted">{t(ppeKey(item as PpeType))}</span>
                      {s?.state === 'present' ? (
                        <span className="text-success">{t('incident.worn', { percent: Math.round((s.confidence ?? 0) * 100) })}</span>
                      ) : (
                        <span className="font-semibold text-critical">{t('incident.missing')}</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <dl className="divide-y divide-border rounded-xl border border-border px-3">
          <DataRow label={t('incident.violation')}>
            {[...new Set(ppe.violations.map((v) => t(ppeKey(v.type))))].join(', ')}
          </DataRow>
          <DataRow label={t('incident.confirmedOver')}>
            {t('incident.framesSeconds', {
              frames: Math.max(...ppe.violations.map((v) => v.frames)),
              seconds: Math.max(...ppe.violations.map((v) => v.seconds)).toFixed(1),
            })}
          </DataRow>
          <DataRow label={t('incident.camera.fallback')}>
            {report.camera?.label} <span className="font-mono text-2xs text-fg-subtle">({report.camera?.id})</span>
          </DataRow>
          <DataRow label={t('incident.model')}>
            {ppe.model.name} · {ppe.model.architecture} · {ppe.model.backend}
          </DataRow>
          <DataRow label={t('incident.thresholds')}>
            {t('incident.thresholds.ppe', {
              conf: ppe.settings.minConfidence,
              frames: ppe.settings.confirmationFrames,
              seconds: ppe.settings.violationSeconds,
              cooldown: ppe.settings.incidentCooldownSeconds,
            })}
          </DataRow>
        </dl>
      </PanelBody>
    </Panel>
  );
}

/** The evidence frame for a camera hazard, with what the models saw drawn over it. */
export function HazardEvidencePanel({ report }: { report: WithId<ReportDoc> }) {
  const { t } = useI18n();
  const hz = report.hazard;
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!hz?.evidencePath) return;
    attachmentUrl(hz.evidencePath)
      .then(setUrl)
      .catch((err) => setError(errorMessage(err)));
  }, [hz?.evidencePath]);

  if (!hz) return null;
  const { width: fw, height: fh } = hz.frame;
  const stroke = Math.max(2, fw / 320);
  const font = Math.max(12, fw / 60);
  const info = HAZARDS[hz.type];

  return (
    <Panel>
      <PanelHeader
        title={t('incident.camera.title')}
        description={`${report.camera?.label ?? t('incident.camera.fallback')} · ${formatDateTime(hz.detectedAt)}`}
        actions={<SourceBadge source="camera" />}
      />
      <PanelBody className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-xl border border-border bg-canvas" style={{ aspectRatio: `${fw} / ${fh}` }}>
          {url ? (
            <img src={url} alt={t('incident.camera.altHazard')} className="absolute inset-0 size-full object-contain" />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">{error ?? t('incident.camera.loading')}</p>
          )}
          <svg viewBox={`0 0 ${fw} ${fh}`} className="absolute inset-0 size-full" aria-hidden>
            {hz.other && (
              <rect
                x={hz.other.box.x1}
                y={hz.other.box.y1}
                width={hz.other.box.x2 - hz.other.box.x1}
                height={hz.other.box.y2 - hz.other.box.y1}
                fill="none"
                stroke="#e5a50a"
                strokeWidth={stroke}
              />
            )}
            <rect
              x={hz.subject.box.x1}
              y={hz.subject.box.y1}
              width={hz.subject.box.x2 - hz.subject.box.x1}
              height={hz.subject.box.y2 - hz.subject.box.y1}
              fill="none"
              stroke="#eb5757"
              strokeWidth={stroke}
            />
            <text x={hz.subject.box.x1 + 4} y={hz.subject.box.y1 + font + 2} fill="#fff" fontSize={font} fontWeight={700}>
              {hz.subject.label}
            </text>
          </svg>
        </div>

        <dl className="divide-y divide-border rounded-xl border border-border px-3">
          <DataRow label={t('incident.hazard')}>
            {info.label} · {t(reportTypeKey(info.kind))}
          </DataRow>
          <DataRow label={t('incident.seen')}>
            {hz.subject.label} {Math.round(hz.subject.confidence * 100)}%
            {hz.other && ` · ${hz.other.label} ${Math.round(hz.other.confidence * 100)}%`}
          </DataRow>
          {hz.zone && (
            <DataRow label={t('incident.zone')}>
              {hz.zone.name} · {hz.zone.kind === 'danger' ? t('incident.zone.restricted') : t('incident.zone.keepClear')}
            </DataRow>
          )}
          {hz.objects && hz.objects.length > 0 && <DataRow label={t('incident.objectsInZone')}>{hz.objects.join(', ')}</DataRow>}
          {hz.method && (
            <DataRow label={t('incident.judgedFrom')}>{hz.method === 'pose' ? t('incident.method.pose') : t('incident.method.shape')}</DataRow>
          )}
          <DataRow label={t('incident.confirmedOver')}>
            {t('incident.framesSeconds', { frames: hz.frames, seconds: hz.seconds.toFixed(1) })}
          </DataRow>
          <DataRow label={t('incident.camera.fallback')}>
            {report.camera?.label} <span className="font-mono text-2xs text-fg-subtle">({report.camera?.id})</span>
          </DataRow>
          <DataRow label={t('incident.models')}>{hz.models.map((m) => `${m.name} · ${m.architecture}`).join(', ')}</DataRow>
          <DataRow label={t('incident.thresholds')}>
            {t('incident.thresholds.hazard', { conf: hz.settings.minConfidence, cooldown: hz.settings.incidentCooldownSeconds })}
          </DataRow>
        </dl>
      </PanelBody>
    </Panel>
  );
}

/** What the AI photo check found when it drafted a worker's photo report. */
export function PhotoCheckPanel({ report }: { report: WithId<ReportDoc> }) {
  const { t } = useI18n();
  const check = report.photoCheck;
  if (report.source !== 'photo' || !check) return null;
  return (
    <Panel>
      <PanelHeader
        title={t('incident.photoCheck.title')}
        description={t('incident.photoCheck.desc')}
        actions={<SourceBadge source="photo" />}
      />
      <PanelBody className="py-1">
        <dl className="divide-y divide-border">
          {check.findings.map((f) => (
            <DataRow key={f.type} label={f.type === 'missing-ppe' ? t('incident.missingPpe') : (HAZARDS[f.type as keyof typeof HAZARDS]?.label ?? f.type)}>
              {Math.round(f.confidence * 100)}%
            </DataRow>
          ))}
          <DataRow label={t('incident.models')}>{check.models.join(', ')}</DataRow>
        </dl>
      </PanelBody>
    </Panel>
  );
}

/** Workers' own accounts of the event, by voice or typing. */
export function StatementsPanel({ report, canAdd }: { report: WithId<ReportDoc>; canAdd: boolean }) {
  const { t } = useI18n();
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const statements = report.statements ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 3) {
      toast.error(t('incident.statements.tooShort'));
      return;
    }
    setBusy(true);
    try {
      await api.addStatement({ reportId: report.id, text: text.trim(), source: voice ? 'voice' : 'text' });
      toast.success(t('incident.statements.added'));
      setText('');
      setVoice(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title={t('incident.statements.title')}
        description={t('incident.statements.desc')}
      />
      <PanelBody className="flex flex-col gap-4">
        {statements.length === 0 ? (
          <p className="text-sm text-fg-subtle">{t('incident.statements.none')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {statements.map((s) => (
              <li key={s.id} className="rounded-xl border border-border bg-surface-2 p-3">
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <SourceBadge source={s.source} />
                  <span className="text-2xs text-fg-subtle">{formatDateTime(s.at)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap text-fg">{s.text}</p>
              </li>
            ))}
          </ul>
        )}
        {canAdd && (
          <form onSubmit={submit} className="flex flex-col gap-3 border-t border-border pt-4" noValidate>
            <VoiceInput value={text} onChange={setText} onUsed={() => setVoice(true)} />
            <Field label={t('incident.statements.add')} hint={t('incident.statements.hint')}>
              <Textarea rows={3} maxLength={LIMITS.reportTextMax} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="sm" loading={busy}>
                {t('incident.statements.addButton')}
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}
