import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText } from 'lucide-react';

import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Pagination, Table, TD, TH, THead, TR } from '@/components/ui/table';
import { usePager } from '@/hooks/data';
import { useI18n, type MessageKey } from '@/i18n';
import { formatDateTime, formatRelative } from '@/lib/format';
import { listAudit } from '@/services/directory';
import { LIMITS } from '@/shared/constants';
import type { AuditDoc } from '@/shared/types';

/** Every action string the service layer writes (functions/src/callables/*). */
const ACTIONS: Record<string, MessageKey> = {
  'report.submit': 'audit.e.report.submit',
  'report.verdict': 'audit.e.report.verdict',
  'report.rescore': 'audit.e.report.rescore',
  'report.archive': 'audit.e.report.archive',
  'report.statement': 'audit.e.report.statement',
  'incident.ppe': 'audit.e.incident.ppe',
  'incident.hazard': 'audit.e.incident.hazard',
  'action.create': 'audit.e.action.create',
  'action.update': 'audit.e.action.update',
  'action.delete': 'audit.e.action.delete',
  'user.role': 'audit.e.user.role',
  'user.disable': 'audit.e.user.disable',
  'user.enable': 'audit.e.user.enable',
  'user.installation': 'audit.e.user.installation',
  'user.delete': 'audit.e.user.delete',
  'installations.create': 'audit.e.installations.create',
  'installations.update': 'audit.e.installations.update',
  'installations.delete': 'audit.e.installations.delete',
  'activities.create': 'audit.e.activities.create',
  'activities.update': 'audit.e.activities.update',
  'activities.delete': 'audit.e.activities.delete',
  'alerts.settings': 'audit.e.alerts.settings',
  'alerts.test': 'audit.e.alerts.test',
};

function Target({ entry }: { entry: AuditDoc }) {
  if (!entry.target) return <span className="text-fg-subtle">—</span>;
  const short = entry.target.length > 12 ? `${entry.target.slice(0, 10)}…` : entry.target;
  if (entry.action.startsWith('report.')) {
    return (
      <Link to={`/app/reports/${entry.target}`} className="font-mono text-xs text-fg hover:underline">
        {short}
      </Link>
    );
  }
  return (
    <span className="font-mono text-xs" title={entry.target}>
      {short}
    </span>
  );
}

function Detail({ detail }: { detail: Record<string, unknown> | undefined }) {
  const entries = Object.entries(detail ?? {}).filter(([, v]) => v !== null && v !== undefined && v !== '');
  if (!entries.length) return <span className="text-fg-subtle">—</span>;
  return (
    <span className="line-clamp-2 font-mono text-xs text-fg-muted" title={JSON.stringify(detail)}>
      {entries.map(([k, v]) => `${k}: ${typeof v === 'object' ? JSON.stringify(v) : String(v)}`).join(' · ')}
    </span>
  );
}

export default function Audit() {
  const { t } = useI18n();
  const [action, setAction] = useState('');
  const pager = usePager<AuditDoc>((after) => listAudit(action || null, LIMITS.pageSize, after), action);

  return (
    <>
      <PageHeader
        title={t('nav.audit')}
        description={t('audit.description')}
      />

      <Panel>
        <div className="flex border-b border-border p-3">
          <Select aria-label={t('audit.filter')} value={action} onChange={(e) => setAction(e.target.value)} className="sm:w-64">
            <option value="">{t('audit.all')}</option>
            {Object.entries(ACTIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {t(label)}
              </option>
            ))}
          </Select>
        </div>

        {pager.error ? (
          <ErrorState message={pager.error} onRetry={pager.reload} />
        ) : pager.loading && !pager.items.length ? (
          <SkeletonRows rows={8} />
        ) : !pager.items.length ? (
          <EmptyState icon={<ScrollText />} title={t('audit.none')} description={action ? t('audit.noneOfKind') : undefined} />
        ) : (
          <div className={pager.loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <TH>{t('audit.col.when')}</TH>
                  <TH>{t('audit.col.event')}</TH>
                  <TH className="hidden sm:table-cell">{t('audit.col.by')}</TH>
                  <TH className="hidden md:table-cell">{t('audit.col.target')}</TH>
                  <TH className="hidden lg:table-cell">{t('audit.col.detail')}</TH>
                </tr>
              </THead>
              <tbody>
                {pager.items.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap" title={formatDateTime(e.at)}>
                      {formatRelative(e.at)}
                    </TD>
                    <TD className="whitespace-nowrap text-fg">{e.action in ACTIONS ? t(ACTIONS[e.action]) : e.action}</TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{e.actorName ?? t('audit.system')}</TD>
                    <TD className="hidden md:table-cell">
                      <Target entry={e} />
                    </TD>
                    <TD className="hidden max-w-md lg:table-cell">
                      <Detail detail={e.detail} />
                    </TD>
                  </TR>
                ))}
              </tbody>
            </Table>
          </div>
        )}
        {(pager.items.length > 0 || pager.page > 1) && (
          <Pagination page={pager.page} hasNext={pager.hasNext} onPrev={pager.prev} onNext={pager.next} loading={pager.loading} />
        )}
      </Panel>
    </>
  );
}
