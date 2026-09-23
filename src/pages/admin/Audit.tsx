import { useState } from 'react';
import { Link } from 'react-router-dom';
import { ScrollText } from 'lucide-react';

import { EmptyState, ErrorState, SkeletonRows } from '@/components/ui/feedback';
import { Select } from '@/components/ui/field';
import { PageHeader } from '@/components/ui/misc';
import { Panel } from '@/components/ui/panel';
import { Pagination, Table, TD, TH, THead, TR } from '@/components/ui/table';
import { usePager } from '@/hooks/data';
import { formatDateTime, formatRelative } from '@/lib/format';
import { listAudit } from '@/services/directory';
import { LIMITS } from '@/shared/constants';
import type { AuditDoc } from '@/shared/types';

/** Every action string the service layer writes (functions/src/callables/*). */
const ACTIONS: Record<string, string> = {
  'report.submit': 'Report filed',
  'report.verdict': 'Verdict recorded',
  'report.rescore': 'Report re-scored',
  'report.archive': 'Report archived',
  'report.statement': 'Statement added',
  'incident.ppe': 'PPE incident (camera)',
  'action.create': 'Action created',
  'action.update': 'Action updated',
  'action.delete': 'Action deleted',
  'user.role': 'Role changed',
  'user.disable': 'Account disabled',
  'user.enable': 'Account enabled',
  'user.installation': 'Installation assigned',
  'user.delete': 'Account deleted',
  'installations.create': 'Installation added',
  'installations.update': 'Installation updated',
  'installations.delete': 'Installation deleted',
  'activities.create': 'Activity added',
  'activities.update': 'Activity updated',
  'activities.delete': 'Activity deleted',
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
  const [action, setAction] = useState('');
  const pager = usePager<AuditDoc>((after) => listAudit(action || null, LIMITS.pageSize, after), action);

  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every change made through the service layer: who, what, when. Append-only — nobody, including administrators, can edit or delete an entry."
      />

      <Panel>
        <div className="flex border-b border-border p-3">
          <Select aria-label="Filter by event" value={action} onChange={(e) => setAction(e.target.value)} className="sm:w-64">
            <option value="">All events</option>
            {Object.entries(ACTIONS).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </Select>
        </div>

        {pager.error ? (
          <ErrorState message={pager.error} onRetry={pager.reload} />
        ) : pager.loading && !pager.items.length ? (
          <SkeletonRows rows={8} />
        ) : !pager.items.length ? (
          <EmptyState icon={<ScrollText />} title="No audit entries" description={action ? 'Nothing of this kind has happened yet.' : undefined} />
        ) : (
          <div className={pager.loading ? 'opacity-60 transition-opacity' : undefined}>
            <Table>
              <THead>
                <tr>
                  <TH>When</TH>
                  <TH>Event</TH>
                  <TH className="hidden sm:table-cell">By</TH>
                  <TH className="hidden md:table-cell">Target</TH>
                  <TH className="hidden lg:table-cell">Detail</TH>
                </tr>
              </THead>
              <tbody>
                {pager.items.map((e) => (
                  <TR key={e.id}>
                    <TD className="whitespace-nowrap" title={formatDateTime(e.at)}>
                      {formatRelative(e.at)}
                    </TD>
                    <TD className="whitespace-nowrap text-fg">{ACTIONS[e.action] ?? e.action}</TD>
                    <TD className="hidden whitespace-nowrap sm:table-cell">{e.actorName ?? 'System'}</TD>
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
