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
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { formatDateTime } from '@/lib/format';
import { api } from '@/services/callables';
import { attachmentUrl } from '@/services/storage';
import { LIMITS, REPORT_TYPE_LABEL } from '@/shared/constants';
import { HAZARDS } from '@/shared/hazards';
import { PPE_LABEL, type PpeType } from '@/shared/ppe';
import { NOT_SPECIFIED, SOURCE_LABEL, type ReportSource, type StructuredIncident } from '@/shared/structure';
import type { ReportDoc, WithId } from '@/shared/types';

export function SourceBadge({ source }: { source: ReportSource | undefined }) {
  const s = source ?? 'text';
  const icon =
    s === 'camera' ? <Camera className="size-3" /> : s === 'photo' ? <ImageIcon className="size-3" /> : s === 'voice' ? <Mic className="size-3" /> : <Keyboard className="size-3" />;
  return (
    <Badge tone={s === 'camera' || s === 'photo' ? 'signal' : 'neutral'}>
      {icon}
      {SOURCE_LABEL[s]}
    </Badge>
  );
}

const FIELDS: [keyof StructuredIncident, string][] = [
  ['title', 'Title'],
  ['hazardType', 'Hazard type'],
  ['location', 'Location'],
  ['severity', 'Severity'],
  ['potentialConsequence', 'Potential consequence'],
  ['recommendedAction', 'Recommended immediate action'],
  ['description', 'Description'],
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
  return (
    <Panel>
      <PanelHeader
        title="Structured incident"
        description={
          preview
            ? 'Extracted from your words as you type. Anything not in the report stays “Not specified”.'
            : 'Extracted from the report by rule-based NLP. Nothing is filled in that the report does not say.'
        }
        actions={
          <Badge tone="info">
            <Sparkles className="size-3" /> Rule-based NLP
          </Badge>
        }
      />
      <PanelBody className="py-1">
        <dl className="divide-y divide-border">
          {FIELDS.map(([key, label]) => {
            const v = String(structured[key] ?? NOT_SPECIFIED);
            return (
              <DataRow key={key} label={label}>
                <span className={cn('block text-left sm:text-right', v === NOT_SPECIFIED && 'text-fg-subtle italic')}>{v}</span>
              </DataRow>
            );
          })}
          <DataRow label="Source">
            <SourceBadge source={structured.source} />
          </DataRow>
          {createdAt && <DataRow label="Timestamp">{formatDateTime(createdAt)}</DataRow>}
        </dl>
        <details className="border-t border-border py-3 text-sm">
          <summary className="cursor-pointer text-xs font-medium text-fg-muted">Original report (kept exactly as given)</summary>
          <p className="mt-2 whitespace-pre-wrap text-fg-muted">{structured.originalReport}</p>
        </details>
      </PanelBody>
    </Panel>
  );
}

/** The evidence frame with every worker's box drawn over it. */
export function CameraEvidencePanel({ report }: { report: WithId<ReportDoc> }) {
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
        title="Camera evidence"
        description={`${report.camera?.label ?? 'Camera'} · ${formatDateTime(ppe.detectedAt)}`}
        actions={<SourceBadge source="camera" />}
      />
      <PanelBody className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-xl border border-border bg-canvas" style={{ aspectRatio: `${ppe.frame.width} / ${ppe.frame.height}` }}>
          {url ? (
            <img src={url} alt="Frame captured when the violation was confirmed" className="absolute inset-0 size-full object-contain" />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">{error ?? 'Loading evidence…'}</p>
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
                Worker W{w.trackId} <span className="font-normal text-fg-subtle">· person {Math.round(w.confidence * 100)}%</span>
              </p>
              <ul className="mt-1.5 flex flex-col gap-1">
                {ppe.required.map((t) => {
                  const s = w.ppe[t];
                  return (
                    <li key={t} className="flex items-center justify-between gap-2 text-xs">
                      <span className="text-fg-muted">{PPE_LABEL[t as PpeType]}</span>
                      {s?.state === 'present' ? (
                        <span className="text-success">Worn · {Math.round((s.confidence ?? 0) * 100)}%</span>
                      ) : (
                        <span className="font-semibold text-critical">Missing</span>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>

        <dl className="divide-y divide-border rounded-xl border border-border px-3">
          <DataRow label="Violation">
            {[...new Set(ppe.violations.map((v) => PPE_LABEL[v.type]))].join(', ')}
          </DataRow>
          <DataRow label="Confirmed over">
            {Math.max(...ppe.violations.map((v) => v.frames))} frames · {Math.max(...ppe.violations.map((v) => v.seconds)).toFixed(1)} s
          </DataRow>
          <DataRow label="Camera">
            {report.camera?.label} <span className="font-mono text-2xs text-fg-subtle">({report.camera?.id})</span>
          </DataRow>
          <DataRow label="Model">
            {ppe.model.name} · {ppe.model.architecture} · {ppe.model.backend}
          </DataRow>
          <DataRow label="Thresholds">
            conf ≥ {ppe.settings.minConfidence} · {ppe.settings.confirmationFrames} frames · {ppe.settings.violationSeconds} s · cooldown{' '}
            {ppe.settings.incidentCooldownSeconds} s
          </DataRow>
        </dl>
      </PanelBody>
    </Panel>
  );
}

/** The evidence frame for a camera hazard, with what the models saw drawn over it. */
export function HazardEvidencePanel({ report }: { report: WithId<ReportDoc> }) {
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
        title="Camera evidence"
        description={`${report.camera?.label ?? 'Camera'} · ${formatDateTime(hz.detectedAt)}`}
        actions={<SourceBadge source="camera" />}
      />
      <PanelBody className="flex flex-col gap-4">
        <div className="relative overflow-hidden rounded-xl border border-border bg-canvas" style={{ aspectRatio: `${fw} / ${fh}` }}>
          {url ? (
            <img src={url} alt="Frame captured when the hazard was confirmed" className="absolute inset-0 size-full object-contain" />
          ) : (
            <p className="absolute inset-0 flex items-center justify-center text-sm text-fg-subtle">{error ?? 'Loading evidence…'}</p>
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
          <DataRow label="Hazard">
            {info.label} · {REPORT_TYPE_LABEL[info.kind]}
          </DataRow>
          <DataRow label="Seen">
            {hz.subject.label} {Math.round(hz.subject.confidence * 100)}%
            {hz.other && ` · ${hz.other.label} ${Math.round(hz.other.confidence * 100)}%`}
          </DataRow>
          {hz.zone && (
            <DataRow label="Zone">
              {hz.zone.name} · {hz.zone.kind === 'danger' ? 'restricted' : 'keep clear'}
            </DataRow>
          )}
          {hz.objects && hz.objects.length > 0 && <DataRow label="Objects in the zone">{hz.objects.join(', ')}</DataRow>}
          {hz.method && <DataRow label="Judged from">{hz.method === 'pose' ? 'Body pose (keypoints)' : 'Body shape (box proportions)'}</DataRow>}
          <DataRow label="Confirmed over">
            {hz.frames} frames · {hz.seconds.toFixed(1)} s
          </DataRow>
          <DataRow label="Camera">
            {report.camera?.label} <span className="font-mono text-2xs text-fg-subtle">({report.camera?.id})</span>
          </DataRow>
          <DataRow label="Models">{hz.models.map((m) => `${m.name} · ${m.architecture}`).join(', ')}</DataRow>
          <DataRow label="Thresholds">
            conf ≥ {hz.settings.minConfidence} · cooldown {hz.settings.incidentCooldownSeconds} s
          </DataRow>
        </dl>
      </PanelBody>
    </Panel>
  );
}

/** What the AI photo check found when it drafted a worker's photo report. */
export function PhotoCheckPanel({ report }: { report: WithId<ReportDoc> }) {
  const check = report.photoCheck;
  if (report.source !== 'photo' || !check) return null;
  return (
    <Panel>
      <PanelHeader
        title="AI photo check"
        description="The worker's photo was checked by the models below, which drafted this report."
        actions={<SourceBadge source="photo" />}
      />
      <PanelBody className="py-1">
        <dl className="divide-y divide-border">
          {check.findings.map((f) => (
            <DataRow key={f.type} label={f.type === 'missing-ppe' ? 'Missing PPE' : (HAZARDS[f.type as keyof typeof HAZARDS]?.label ?? f.type)}>
              {Math.round(f.confidence * 100)}%
            </DataRow>
          ))}
          <DataRow label="Models">{check.models.join(', ')}</DataRow>
        </dl>
      </PanelBody>
    </Panel>
  );
}

/** Workers' own accounts of the event, by voice or typing. */
export function StatementsPanel({ report, canAdd }: { report: WithId<ReportDoc>; canAdd: boolean }) {
  const [text, setText] = useState('');
  const [voice, setVoice] = useState(false);
  const [busy, setBusy] = useState(false);
  const statements = report.statements ?? [];

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (text.trim().length < 3) {
      toast.error('Write at least a few words.');
      return;
    }
    setBusy(true);
    try {
      await api.addStatement({ reportId: report.id, text: text.trim(), source: voice ? 'voice' : 'text' });
      toast.success('Statement added to this incident');
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
        title="Worker statements"
        description="Voice and text accounts attached to this incident, each kept as a separate source."
      />
      <PanelBody className="flex flex-col gap-4">
        {statements.length === 0 ? (
          <p className="text-sm text-fg-subtle">No statements yet.</p>
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
            <Field label="Add a statement" hint="Say or type what you saw. You can edit a dictated statement before adding it.">
              <Textarea rows={3} maxLength={LIMITS.reportTextMax} value={text} onChange={(e) => setText(e.target.value)} />
            </Field>
            <div className="flex justify-end">
              <Button type="submit" variant="primary" size="sm" loading={busy}>
                Add statement
              </Button>
            </div>
          </form>
        )}
      </PanelBody>
    </Panel>
  );
}
