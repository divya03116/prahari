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
import { useI18n } from '@/i18n';
import { reportTypeKey, shiftKey, sourceKey, verdictHelpKey, verdictKey } from '@/i18n/labels';
import { cn } from '@/lib/cn';
import { errorMessage } from '@/lib/errors';
import { daysUntil, formatDate, formatDateTime, formatRelative } from '@/lib/format';
import { isOverdue, watchReportActions } from '@/services/actions';
import { api } from '@/services/callables';
import { watchReport } from '@/services/reports';
import { scopeKey, type ReportScope } from '@/services/scope';
import { LIMITS, VERDICTS, type Verdict } from '@/shared/constants';
import type { ActionDoc, ReportDoc, WithId } from '@/shared/types';

function VerdictPanel({ report }: { report: WithId<ReportDoc> }) {
  const { can } = useAuth();
  const { t } = useI18n();
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
      toast.success(t('detail.verdictRecorded', { verdict: t(verdictKey(decision)) }));
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
        title={t('detail.officerReview')}
        actions={
          report.verdict && canRecord && !editing ? (
            <Button size="xs" variant="ghost" onClick={() => setEditing(true)}>
              {t('common.change')}
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
            {report.status !== 'scored' ? t('detail.availableOnceScored') : t('detail.notReviewed')}
          </p>
        )}
        {showForm && (
          <fieldset disabled={busy} className="flex flex-col gap-3">
            <legend className="sr-only">{t('detail.verdict')}</legend>
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
                    <span className="block text-sm font-medium text-fg">{t(verdictKey(v))}</span>
                    <span className="block text-xs text-fg-subtle">{t(verdictHelpKey(v))}</span>
                  </span>
                </label>
              ))}
            </div>
            <Field label={t('detail.note')} optional>
              <Textarea rows={3} maxLength={LIMITS.noteMax} value={note} onChange={(e) => setNote(e.target.value)} />
            </Field>
            <div className="flex justify-end gap-2">
              {editing && (
                <Button variant="ghost" size="sm" onClick={() => setEditing(false)}>
                  {t('common.cancel')}
                </Button>
              )}
              <Button variant="primary" size="sm" loading={busy} onClick={() => void save()}>
                {t('detail.recordVerdict')}
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
  const { t } = useI18n();
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
        title={t('nav.actions')}
        description={report.tier && report.tier <= 2 ? t('detail.actionsDesc') : undefined}
        actions={
          officer && !report.archived && report.status === 'scored' ? (
            <Button size="sm" onClick={() => setCreating(true)}>
              <Plus aria-hidden /> {t('detail.addAction')}
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
          title={t('detail.noActions')}
          description={
            report.tier === 3 ? t('detail.noActions.tier3') : report.status === 'scored' ? t('detail.noActions.none') : t('detail.noActions.pending')
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
                      {t('detail.due', { date: formatDate(a.dueAt) })}
                      {late && due !== null ? ` · ${t('detail.overdue', { days: -due })}` : ''}
                    </span>
                    {a.source === 'manual' && <Badge>{t('detail.manual')}</Badge>}
                  </div>
                  {a.note && <p className="mt-1.5 border-l-2 border-border-strong pl-2 text-xs text-fg-muted">{a.note}</p>}
                </div>
                <div className="flex shrink-0 gap-1 pl-8 sm:pl-0">
                  {editable(a) && (
                    <Button size="xs" variant="secondary" onClick={() => setEditing(a)}>
                      {t('common.update')}
                    </Button>
                  )}
                  {admin && a.source === 'manual' && (
                    <Button size="xs" variant="ghost" aria-label={t('detail.deleteActionLabel', { order: a.order })} onClick={() => setDeleting(a)}>
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
        title={t('detail.deleteAction.title')}
        description={t('detail.deleteAction.desc')}
        confirmLabel={t('detail.deleteAction.confirm')}
        onConfirm={async () => {
          if (!deleting) return;
          await api.deleteAction(deleting.id);
          toast.success(t('detail.deleteAction.done'));
        }}
      />
    </Panel>
  );
}

export default function ReportDetail() {
  const { id = '' } = useParams();
  const { can } = useAuth();
  const { t } = useI18n();
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
          title={t('detail.notFound')}
          description={t('detail.notFoundDesc')}
          action={
            <Link to="/app/reports" className={buttonClass({ size: 'sm' })}>
              {t('detail.back')}
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
      toast.success(t('detail.rescored', { score: res.score, tier: res.tier }));
    } catch (err) {
      toast.error(errorMessage(err));
    } finally {
      setRescoring(false);
    }
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href);
      toast.success(t('detail.linkCopied'));
    } catch {
      toast.error(t('detail.linkCopyFailed'));
    }
  };

  const scored = r.status === 'scored' && r.score !== undefined && r.tier;

  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-1.5">
            <Link to="/app/reports" className="hover:text-fg">
              {t('nav.reports')}
            </Link>
            <span aria-hidden>/</span>
            <span className="font-mono">{r.id.slice(0, 8)}</span>
          </span>
        }
        title={`${r.installationName} · ${r.activityName}`}
        description={[
          t(sourceKey(r.source ?? 'text')),
          t(reportTypeKey(r.type)),
          t('reports.shiftLabel', { shift: t(shiftKey(r.shift)) }),
          r.contractor ? t('detail.contractorInvolved') : null,
          t('detail.filedAgo', { when: formatRelative(r.createdAt) }),
        ]
          .filter(Boolean)
          .join(' · ')}
        actions={
          <>
            {admin && !r.archived && (
              <Button size="sm" onClick={() => void rescore()} loading={rescoring}>
                {!rescoring && <RefreshCw aria-hidden />} {t('detail.rescore')}
              </Button>
            )}
            <Menu>
              <MenuTrigger asChild>
                <Button size="icon-sm" variant="secondary" aria-label={t('detail.moreActions')}>
                  <MoreHorizontal aria-hidden />
                </Button>
              </MenuTrigger>
              <MenuContent>
                <MenuItem icon={<Copy />} onSelect={() => void copyLink()}>
                  {t('detail.copyLink')}
                </MenuItem>
                {admin && !r.archived && (
                  <MenuItem icon={<Archive />} danger onSelect={() => setArchiving(true)}>
                    {t('detail.archive')}
                  </MenuItem>
                )}
              </MenuContent>
            </Menu>
          </>
        }
      />

      {r.archived && (
        <Alert tone="warning" className="mb-4" title={t('reports.view.archived')}>
          {r.archiveReason ? `“${r.archiveReason}”` : t('detail.archived.plain')} {r.archivedAt ? `· ${formatDateTime(r.archivedAt)}` : ''}.{' '}
          {t('detail.archived.kept')}
        </Alert>
      )}

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="flex min-w-0 flex-col gap-6">
          {r.status === 'pending' && (
            <Panel>
              <PanelBody className="flex items-center gap-3">
                <Loader2 className="size-5 animate-spin text-signal" aria-hidden />
                <div>
                  <p className="text-sm font-medium text-fg">{t('detail.scoring.title')}</p>
                  <p className="text-sm text-fg-muted">{t('detail.scoring.desc')}</p>
                </div>
              </PanelBody>
            </Panel>
          )}
          {r.status === 'failed' && (
            <Alert
              tone="critical"
              title={t('reports.status.failed')}
              action={
                admin ? (
                  <Button size="sm" onClick={() => void rescore()} loading={rescoring}>
                    {t('common.retry')}
                  </Button>
                ) : undefined
              }
            >
              {r.error ?? t('detail.scoringFailed')} {admin ? '' : t('detail.adminCanRerun')}
            </Alert>
          )}

          {scored && (
            <Panel>
              <PanelBody className="flex flex-col gap-4 sm:flex-row sm:items-center sm:gap-8">
                <div className="shrink-0">
                  <p className="text-xs text-fg-subtle">{t('assess.sifPotential')}</p>
                  <p className="text-4xl font-semibold tracking-tight text-fg tabular">
                    {r.score}
                    <span className="text-lg font-normal text-fg-subtle"> / 100</span>
                  </p>
                </div>
                <div className="flex min-w-0 flex-1 flex-col gap-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <TierBadge tier={r.tier} />
                    {r.escalated && <Badge tone="signal">{t('detail.ruleNetApplied')}</Badge>}
                    <span className="text-xs text-fg-subtle">{t('detail.respondWithin', { window: r.responseWindow ?? '' })}</span>
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
                  {t('detail.noInjury')}
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
              title={t('detail.narrative')}
              description={r.language ? `${r.language.primary}${r.language.codeMixed ? ` · ${t('detail.codeMixed')}` : ''}` : undefined}
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
                  {t('detail.findings')}
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
                    {t('detail.couldHaveBecome')}
                  </h2>
                  <PotentialOutcomes outcomes={r.potentialOutcomes} />
                </section>
              )}

              <section aria-labelledby="build" className="flex flex-col gap-2">
                <h2 id="build" className="text-sm font-medium text-fg">
                  {t('detail.howBuilt')}
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
            <PanelHeader title={t('detail.details')} />
            <PanelBody className="py-1">
              <dl className="divide-y divide-border">
                <DataRow label={t('reports.col.filed')}>{formatDateTime(r.createdAt)}</DataRow>
                <DataRow label={t('reports.installation')}>{r.installationName}</DataRow>
                <DataRow label={t('detail.activity')}>{r.activityName}</DataRow>
                <DataRow label={t('quick.type')}>{t(reportTypeKey(r.type))}</DataRow>
                <DataRow label={t('detail.shift')}>{t(shiftKey(r.shift))}</DataRow>
                <DataRow label={t('reports.contractor')}>{r.contractor ? t('common.yes') : t('common.no')}</DataRow>
                {r.scoredAt && <DataRow label={t('detail.scored')}>{formatDateTime(r.scoredAt)}</DataRow>}
                {r.engineVersion && <DataRow label={t('detail.engine')}>v{r.engineVersion}</DataRow>}
                <DataRow label={t('detail.reportId')}>
                  <span className="font-mono text-xs break-all">{r.id}</span>
                </DataRow>
              </dl>
            </PanelBody>
          </Panel>
          <Panel>
            <PanelHeader title={t('detail.attachments')} />
            <PanelBody>
              <AttachmentList items={r.attachments ?? []} />
            </PanelBody>
          </Panel>
        </aside>
      </div>

      <ConfirmDialog
        open={archiving}
        onOpenChange={setArchiving}
        title={t('detail.archive.title')}
        description={t('detail.archive.desc')}
        confirmLabel={t('detail.archive')}
        reasonLabel={t('detail.archive.reason')}
        reasonHint={t('detail.archive.reasonHint')}
        onConfirm={async (reason) => {
          const res = await api.archiveReport({ reportId: r.id, reason });
          toast.success(t('detail.archive.done'), {
            description: res.actionsCancelled ? t('detail.archive.cancelled', { count: res.actionsCancelled }) : undefined,
          });
        }}
      />
    </>
  );
}
