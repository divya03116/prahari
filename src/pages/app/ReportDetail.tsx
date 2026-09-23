import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Archive, ClipboardCheck, Copy, FileX2, Loader2, MoreHorizontal, Plus, RefreshCw, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { useAuth } from '@/auth/AuthProvider';
import { useReportScope } from '@/auth/scope';
import { CreateActionDialog, EditActionDialog } from '@/components/ActionDialogs';
import { AttachmentList } from '@/components/Attachments';
import {
  Contributions,
  EvidenceLegend,
  EvidenceText,
  FindingsGrid,
  PotentialOutcomes,
  RuleNet,
  ScoreBar,
} from '@/components/assessment';
import { ActionStatusBadge, Badge, TierBadge, VerdictBadge } from '@/components/ui/badge';
import { Button, buttonClass } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Alert, EmptyState, ErrorState, Skeleton } from '@/components/ui/feedback';
import { Field, Textarea } from '@/components/ui/field';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/menu';
import { PageHeader } from '@/components/ui/misc';
import { DataRow, Panel, PanelBody, PanelHeader } from '@/components/ui/panel';
import { CameraEvidencePanel, HazardEvidencePanel, PhotoCheckPanel, StatementsPanel, StructuredIncidentPanel } from '@/components/IncidentPanels';
import { useLive } from '@/hooks/data';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { daysUntil, formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { isOverdue, watchReportActions } from '@/services/actions';
import { api } from '@/services/callables';
import { watchReport } from '@/services/reports';
import { scopeKey, type ReportScope } from '@/services/scope';
import { LIMITS, REPORT_TYPE_LABEL, VERDICT_LABEL, VERDICTS, type Verdict } from '@/shared/constants';
import { SOURCE_LABEL } from '@/shared/structure';
import type { ActionDoc, ReportDoc, WithId } from '@/shared/types';

const VERDICT_HELP: Record<Verdict, string> = {
  confirmed: 'The assessment is right.',
  escalated: 'The potential is higher than scored.',
  downgraded: 'The potential is lower than scored.',
  dismissed: 'Not a genuine safety observation.',
};

function VerdictPanel({ report }: { report: WithId<ReportDoc> }) {
  const { can } = useAuth();
  const officer = can('hse-officer');
  const [editing, setEditing] = useState(false);
  const [decision, setDecision] = useState<Verdict>(report.verdict?.decision ?? 'confirmed');
  const [note, setNote] = useState(report.verdict?.note ?? '');
  const [busy, setBusy] = useState(false);

  const canRecord = officer && report.status === 'scored' && !report.archived;
  const showForm = canRecord && (editing || !report.verdict);

  const save = async () => {
    setBusy(true);
    try {
      await api.recordVerdict({ reportId: report.id, decision, note: note.trim() });
      toast.success(`Verdict recorded: ${VERDICT_LABEL[decision]}`);
      setEditing(false);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel>
      <PanelHeader
        title="Officer review"
        actions={
          report.verdict && canRecord && !editing ? (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              Change
            </Button>
          ) : undefined
        }
      />
      <PanelBody className="flex flex-col gap-3">
        {report.verdict && !showForm && (
          <div className="flex flex-col gap-2">
            <div>
              <VerdictBadge verdict={report.verdict.decision} />
            </div>
            {report.verdict.note && <p className="text-sm text-fg-muted">{report.verdict.note}</p>}
            <p className="text-xs text-fg-subtle">
              {report.verdict.officerName} · {formatDateTime(report.verdict.at)}
            </p>
          </div>
        )}
        {!report.verdict && !canRecord && (
          <p className="text-sm text-fg-subtle">
            {report.status !== 'scored' ? 'Available once the report is scored.' : 'Not reviewed yet. An HSE officer records the verdict.'}
          </p>
        )}
        {showForm && (
          <fieldset disabled={busy} className="flex flex-col gap-3">
            <legend className="sr-only">Verdict</legend>
            <div className="flex flex-col gap-1.5">
              {VERDICTS.map((v) => (
                <label
                  key={v}
                  className={cn(
                    'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-signal',
                    decision === v ? 'border-fg/40 bg-surface-3' : 'border-border hover:bg-surface-2',
                  )}
                >
                  <input
                    type="radio"
                    name="verdict"
                    value={v}
                    checked={decision === v}
                    onChange={() => setDecision(v)}
                    className="mt-1 accent-[var(--color-signal)]"
                  />
                  <span>
                    <span className="block text-sm font-medium text-fg">{VERDICT_LABEL[v]}</span>
                    <span className="block text-xs text-fg-subtle">{VERDICT_HELP[v]}</span>
                  </span>
                </label>
              ))}
            </div>
            <Field label="Note" optional>
              <Textarea rows={3} maxLength={LIMITS.noteMax} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              {editing && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  Cancel
                </Button>
              )}
              <Button variant="primary" size="sm" loading={busy} onClick={() => void save()}>
                Record verdict
              </Button>
            </div>
          </fieldset>
        )}
      </PanelBody>
    </Panel>
  );
}

function ActionsPanel({ report }: { report: WithId<ReportDoc> }) {
  const { user, can, profile } = useAuth();
  const scope = useReportScope();
  const officer = can('hse-officer');
  const admin = can('admin');
  const manager = can('installation-manager') && profile?.installationId === report.installationId;
  // Your own report's actions are always visible to you, whatever your wider scope.
  const actionScope: ReportScope = scope.kind !== 'all' && user && report.reportedBy === user.uid ? { kind: 'own', uid: user.uid } : scope;
  const actions = useLive<WithId<ActionDoc>[]>(
    (next, err) => watchReportActions(report.id, actionScope, next, err),
    [report.id, scopeKey(actionScope)],
  );
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<WithId<ActionDoc> | null>(null);
  const [deleting, setDeleting] = useState<WithId<ActionDoc> | null>(null);

  const editable = (a: WithId<ActionDoc>) => officer || (manager && a.status !== 'cancelled');

  return (
    <Panel>
      <PanelHeader
        title="Corrective actions"
        description={report.tier && report.tier <= 2 ? 'Drafted by the engine on scoring; officers manage them here.' : undefined}
        actions={
          officer && !report.archived && report.status === 'scored' ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> Add action
            </Button>
          ) : undefined
        }
      />
      {actions.loading ? (
        <div className="flex flex-col gap-3 p-4">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
      ) : actions.error ? (
        <ErrorState message={actions.error} />
      ) : !actions.data?.length ? (
        <EmptyState
          icon={<ClipboardCheck />}
          title="No corrective actions"
          description={
            report.tier === 3
              ? 'Tier 3 reports do not open actions automatically.'
              : report.status === 'scored'
                ? 'None recorded for this report.'
                : 'Actions are drafted once the report is scored.'
          }
        />
      ) : (
        <ul className="divide-y divide-border">
          {actions.data.map((a) => {
            const due = daysUntil(a.dueAt);
            const late = isOverdue(a);
            return (
              <li key={a.id} className="flex flex-col gap-2 px-4 py-3 sm:flex-row sm:items-start">
                <span className="mt-0.5 w-5 shrink-0 font-mono text-xs text-fg-subtle tabular">{a.order}.</span>
                <div className="min-w-0 flex-1">
                  <p className="text-sm text-fg">{a.control}</p>
                  {a.rationale && <p className="mt-0.5 text-xs text-fg-subtle">{a.rationale}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-fg-subtle">
                    <ActionStatusBadge status={a.status} />
                    <span>{a.owner}</span>
                    <span className={cn(late && 'text-critical')}>
                      Due {formatDate(a.dueAt)}
                      {late && due !== null ? ` · ${-due}d overdue` : ''}
                    </span>
                    {a.source === 'manual' && <Badge>Manual</Badge>}
                  </div>
                  {a.note && <p className="mt-1.5 border-l-2 border-border-strong pl-2 text-xs text-fg-muted">{a.note}</p>}
                </div>
                <div className="flex shrink-0 gap-1 pl-8 sm:pl-0">
                  {editable(a) && (
                    <Button size="xs" variant="secondary" onClick={() => setEditing(a)}>
                      Update
                    </Button>
                  )}
                  {admin && a.source === 'manual' && (
                    <Button size="xs" variant="ghost" aria-label={`Delete action ${a.order}`} onClick={() => setDeleting(a)}>
                      <Trash2 aria-hidden />
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <CreateActionDialog reportId={report.id} open={creating} onOpenChange={setCreating} />
      <EditActionDialog action={editing} onOpenChange={(o) => !o && setEditing(null)} />
      <ConfirmDialog
        open={Boolean(deleting)}
        onOpenChange={(o) => !o && setDeleting(null)}
        title="Delete this action?"
        description="Manually added actions can be deleted. The deletion is recorded in the audit log."
        confirmLabel="Delete action"
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteAction(deleting.id);
          toast.success('Action deleted');
        }}
      />
    </Panel>
  );
}

export default function ReportDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const admin = can('admin');
  const report = useLive<WithId<ReportDoc> | null>((next, err) => watchReport(id, next, err), [id]);
  const [archiving, setArchiving] = useState(false);
  const [rescoring, setRescoring] = useState(false);

  if (report.loading) {
    return (
      <div className="flex flex-col gap-4">
        <Skeleton className="h-6 w-64" />
        <Skeleton className="h-40 w-full" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }
  if (report.error) {
    return (
      <Panel>
        <ErrorState message={report.error} />
      </Panel>
    );
  }
  const r = report.data;
  if (!r) {
    return (
      <Panel>
        <EmptyState
          icon={<FileX2 />}
          title="Report not found"
          description="It may have been removed, or the link is wrong."
          action={
            <Link to="/app/reports" className={buttonClass({ size: 'sm' })}>
              Back to reports
            </Link>
          }
        />
      </Panel>
    );
  }

  const rescore = async () => {
    setRescoring(true);
    try {
      const res = await api.rescoreReport(r.id);
      toast.success(`Re-scored: ${res.score} (Tier ${res.tier})`);
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRescoring(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success('Link copied');
    } catch {
      toast.error('Could not copy the link');
    }
  };

  const scored = r.status === 'scored' && r.score !== undefined && r.tier;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link to="/app/reports" className="hover:text-fg">
              Reports
            </Link>
            <span aria-hidden>/</span>
            <span className="font-mono">{r.id.slice(0, 8)}</span>
          </span>
        }
        title={`${r.installationName} · ${r.activityName}`}
        description={`${SOURCE_LABEL[r.source ?? 'text']} · ${REPORT_TYPE_LABEL[r.type]} · ${r.shift} shift${r.contractor ? ' · Contractor involved' : ''} · Filed ${formatRelative(r.createdAt)}`}
        actions={
          <>
            {admin && !r.archived && (
              <Button size="sm" onClick={() => void rescore()} loading={rescoring}>
                {!rescoring && <RefreshCw aria-hidden />} Re-score
              </Button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon-sm" variant="secondary" aria-label="More actions">
                  <MoreHorizontal aria-hidden />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Copy />} onSelect={() => void copyLink()}>
                  Copy link
                </MenuItem>
                {admin && !r.archived && (
                  <MenuItem icon={<Archive />} danger onSelect={() => setArchiving(true)}>
                    Archive report
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          </>
        }
      />

      {r.archived && (
        <Alert tone="warning" className="mb-4" title="Archived">
          {r.archiveReason ? `“${r.archiveReason}”` : 'This report is archived.'} {r.archivedAt ? `· ${formatDateTime(r.archivedAt)}` : ''}. It
          is kept for the record and excluded from the register, counts and charts.
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {r.status === 'pending' && (
            <Panel>
              <PanelBody className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-signal" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-fg">Scoring in progress</p>
                  <p className="text-sm text-fg-muted">The assessment appears here automatically in a few seconds.</p>
                </div>
              </PanelBody>
            </Panel>
          )}
          {r.status === 'failed' && (
            <Alert
              tone="critical"
              title="Scoring failed"
              action={
                admin ? (
                  <Button size="sm" onClick={() => void rescore()} loading={rescoring}>
                    Retry
                  </Button>
                ) : undefined
              }
            >
              {r.error ?? 'The engine could not assess this report.'} {admin ? '' : 'An administrator can re-run it.'}
            </Alert>
          )}

          {scored && (
            <Panel>
              <PanelBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
                <div className="shrink-0">
                  <p className="text-xs text-fg-subtle">SIF potential</p>
                  <p className="text-4xl font-semibold tracking-tight text-fg tabular">
                    {r.score}
                    <span className="text-lg font-normal text-fg-subtle"> / 100</span>
                  </p>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <TierBadge tier={r.tier} />
                    {r.escalated && <Badge tone="signal">Rule net applied</Badge>}
                    <span className="text-xs text-fg-subtle">Respond within {r.responseWindow}</span>
                  </div>
                  <ScoreBar score={r.score!} tier={r.tier!} />
                  <div className="relative h-4 text-2xs text-fg-subtle tabular" aria-hidden>
                    <span className="absolute left-0">0</span>
                    <span className="absolute left-[40%] -translate-x-1/2">40</span>
                    <span className="absolute left-[70%] -translate-x-1/2">70</span>
                    <span className="absolute right-0">100</span>
                  </div>
                </div>
              </PanelBody>
              {r.noInjury && (
                <p className="border-t border-border px-4 py-2.5 text-xs text-fg-muted">
                  The report records that nobody was hurt. That does not lower the score: potential is judged by what could
                  have happened, not by the outcome.
                </p>
              )}
            </Panel>
          )}

          {r.structured && <StructuredIncidentPanel structured={r.structured} createdAt={r.createdAt} />}
          <CameraEvidencePanel report={r} />
          <HazardEvidencePanel report={r} />
          <PhotoCheckPanel report={r} />

          <Panel>
            <PanelHeader
              title="Narrative"
              description={
                r.language
                  ? `${r.language.primary}${r.language.codeMixed ? ' · code-mixed' : ''}`
                  : undefined
              }
            />
            <PanelBody className="flex flex-col gap-4">
              <EvidenceText text={r.text} spans={r.evidence} />
              {scored && <EvidenceLegend />}
            </PanelBody>
          </Panel>

          {scored && (
            <>
              <section aria-labelledby="findings" className="flex flex-col gap-3">
                <h2 id="findings" className="text-sm font-medium text-fg">
                  Findings
                </h2>
                <FindingsGrid energy={r.energy} barrier={r.barrier} exposure={r.exposure} />
                {(r.aggravators?.length || r.mitigators?.length) ? (
                  <div className="flex flex-wrap gap-1.5">
                    {r.aggravators?.map((f) => (
                      <Badge key={f.id} tone="signal">
                        + {f.label}
                      </Badge>
                    ))}
                    {r.mitigators?.map((f) => (
                      <Badge key={f.id} tone="success">
                        − {f.label}
                      </Badge>
                    ))}
                  </div>
                ) : null}
                <RuleNet rules={r.rulesTriggered} escalated={r.escalated} preRuleScore={r.preRuleScore} />
              </section>

              {r.potentialOutcomes && r.potentialOutcomes.length > 0 && (
                <section aria-labelledby="outcomes" className="flex flex-col gap-2">
                  <h2 id="outcomes" className="text-sm font-medium text-fg">
                    What this could have become
                  </h2>
                  <PotentialOutcomes outcomes={r.potentialOutcomes} />
                </section>
              )}

              <section aria-labelledby="build" className="flex flex-col gap-2">
                <h2 id="build" className="text-sm font-medium text-fg">
                  How the score was built
                </h2>
                <Contributions items={r.contributions} score={r.score!} />
              </section>
            </>
          )}

          <StatementsPanel report={r} canAdd={!r.archived} />
          <ActionsPanel report={r} />
        </div>

        <aside className="flex min-w-0 flex-col gap-6">
          <VerdictPanel key={r.verdict?.at?.toMillis?.() ?? 'none'} report={r} />
          <Panel>
            <PanelHeader title="Details" />
            <PanelBody className="py-1">
              <dl className="divide-y divide-border">
                <DataRow label="Filed">{formatDateTime(r.createdAt)}</DataRow>
                <DataRow label="Installation">{r.installationName}</DataRow>
                <DataRow label="Activity">{r.activityName}</DataRow>
                <DataRow label="Type">{REPORT_TYPE_LABEL[r.type]}</DataRow>
                <DataRow label="Shift">{r.shift}</DataRow>
                <DataRow label="Contractor">{r.contractor ? 'Yes' : 'No'}</DataRow>
                {r.scoredAt && <DataRow label="Scored">{formatDateTime(r.scoredAt)}</DataRow>}
                {r.engineVersion && <DataRow label="Engine">v{r.engineVersion}</DataRow>}
                <DataRow label="Report ID">
                  <span className="font-mono text-xs break-all">{r.id}</span>
                </DataRow>
              </dl>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title="Attachments" />
            <PanelBody>
              <AttachmentList items={r.attachments ?? []} />
            </PanelBody>
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title="Archive this report?"
        description="It leaves the register, counts and charts, and its open corrective actions are cancelled. The report itself is kept for the record — nothing is deleted."
        confirmLabel="Archive report"
        reasonLabel="Reason"
        reasonHint="Recorded in the audit log, e.g. Duplicate of an earlier report."
        onConfirm={async (reason) => {
          const res = await api.archiveReport({ reportId: r.id, reason });
          toast.success('Report archived', {
            description: res.actionsCancelled ? `${res.actionsCancelled} open action(s) cancelled.` : undefined,
          });
        }}
      />
    </>
  );
}
