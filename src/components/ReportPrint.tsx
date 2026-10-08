/**
 * The paper version of a report: what "Export PDF" prints or saves.
 *
 * It exists only while the page is being printed, and then it is the only
 * thing shown (styles/index.css): a light A4 document with no controls. It
 * carries what the screen shows about the report and, like the screen, never
 * who filed it. The narrative and statements are printed exactly as written,
 * whatever the interface language is.
 */

import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';

import { LogoMark } from '@/components/brand';
import { FIELDS as STRUCTURED_FIELDS } from '@/components/IncidentPanels';
import { useReportActions } from '@/hooks/reportActions';
import { useI18n } from '@/i18n';
import { actionStatusKey, ppeKey, reportTypeKey, shiftKey, sourceKey, tierKey, verdictKey } from '@/i18n/labels';
import { formatBytes, formatDate, formatDateTime } from '@/lib/format';
import type { Hit } from '@/shared/engine';
import { HAZARDS } from '@/shared/hazards';
import { NOT_SPECIFIED } from '@/shared/structure';
import type { ReportDoc, WithId } from '@/shared/types';

const TIER_COLOR = { 1: '#c62828', 2: '#b7791f', 3: '#2e7d4f' } as const;

function Findings({ title, hits, empty }: { title: string; hits: Hit[] | undefined; empty: string }) {
  return (
    <div>
      <p className="pd-k">{title}</p>
      {hits?.length ? (
        hits.map((h) => (
          <p key={h.id} className="pd-finding">
            <span className="pd-strong">{h.label}</span> <span className="pd-muted">+{h.weight}</span>
            {h.terms.length > 0 && <span className="pd-muted"> · “{h.terms.slice(0, 3).join('”, “')}”</span>}
          </p>
        ))
      ) : (
        <p className="pd-muted">{empty}</p>
      )}
    </div>
  );
}

/** True from the moment the browser starts laying the page out for paper until it is done. */
function usePrinting(): boolean {
  const [printing, setPrinting] = useState(false);
  useEffect(() => {
    // beforeprint must render before the browser takes its snapshot, hence flushSync.
    const before = () => flushSync(() => setPrinting(true));
    const after = () => setPrinting(false);
    // Browsers that skip beforeprint still switch the media type.
    const media = window.matchMedia('print');
    const onMedia = (e: MediaQueryListEvent) => setPrinting(e.matches);
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    media.addEventListener('change', onMedia);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      media.removeEventListener('change', onMedia);
    };
  }, []);
  return printing;
}

export function ReportPrint({ report: r }: { report: WithId<ReportDoc> }) {
  const { t } = useI18n();
  // Subscribed all along, so the actions are already here when printing starts.
  const actions = useReportActions(r);
  const printing = usePrinting();
  if (!printing) return null;

  const scored = r.status === 'scored' && r.score !== undefined && r.tier;
  const pct = (n: number) => `${Math.round(n * 100)}%`;

  const meta: [string, string][] = [
    [t('detail.reportId'), r.id],
    [t('reports.col.filed'), formatDateTime(r.createdAt)],
    [t('incident.source'), t(sourceKey(r.source ?? 'text'))],
    [t('reports.installation'), r.installationName],
    [t('detail.activity'), r.activityName],
    [t('quick.type'), t(reportTypeKey(r.type))],
    [t('detail.shift'), t(shiftKey(r.shift))],
    [t('reports.contractor'), r.contractor ? t('common.yes') : t('common.no')],
    [t('detail.scored'), r.scoredAt ? formatDateTime(r.scoredAt) : '—'],
  ];

  return (
    <article className="print-doc">
      <header className="pd-head">
        <div>
          <p className="pd-brand">
            <LogoMark /> PRAHARI
          </p>
          <h1 className="pd-title">{t('pdf.docTitle')}</h1>
          <p className="pd-muted">
            {r.installationName} · {r.activityName}
          </p>
        </div>
        <div className="pd-headmeta">
          <p className="pd-mono">{r.id}</p>
          <p>{t('pdf.generated', { when: formatDateTime(new Date()) })}</p>
          {r.archived && <p className="pd-strong">{t('reports.view.archived')}</p>}
        </div>
      </header>

      <section className="pd-section">
        <div className="pd-grid">
          {meta.map(([k, v]) => (
            <div key={k}>
              <p className="pd-k">{k}</p>
              <p className="pd-v">{v}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="pd-section pd-keep">
        <h2 className="pd-h2">{t('pdf.assessment')}</h2>
        {scored ? (
          <div className="pd-score">
            <div>
              <p className="pd-k">{t('assess.sifPotential')}</p>
              <p className="pd-score-num">
                {r.score}
                <span className="pd-score-of"> / 100</span>
              </p>
            </div>
            <div className="pd-score-body">
              <p>
                <span className="pd-tier" style={{ background: TIER_COLOR[r.tier!] }}>
                  {t('tier.label', { tier: r.tier!, label: t(tierKey(r.tier!)) })}
                </span>{' '}
                {r.responseWindow && <span>{t('detail.respondWithin', { window: r.responseWindow })}</span>}
                {r.escalated && <span className="pd-muted"> · {t('detail.ruleNetApplied')}</span>}
              </p>
              <div className="pd-bar">
                <span style={{ width: `${r.score}%`, background: TIER_COLOR[r.tier!] }} />
              </div>
              {r.noInjury && <p className="pd-muted pd-small">{t('detail.noInjury')}</p>}
            </div>
          </div>
        ) : (
          <p className="pd-muted">{r.status === 'failed' ? (r.error ?? t('detail.scoringFailed')) : t('pdf.notScored')}</p>
        )}
      </section>

      <section className="pd-section">
        <h2 className="pd-h2">
          {t('detail.narrative')}
          {r.language ? ` · ${r.language.primary}` : ''}
        </h2>
        <p className="pd-text">{r.text}</p>
        <p className="pd-muted pd-small">{t('pdf.asWritten')}</p>
      </section>

      {r.structured && (
        <section className="pd-section">
          <h2 className="pd-h2">{t('incident.structured.title')}</h2>
          <table className="pd-table">
            <tbody>
              {STRUCTURED_FIELDS.filter(([key]) => key !== 'description').map(([key, label]) => {
                const v = String(r.structured![key] ?? NOT_SPECIFIED);
                return (
                  <tr key={key}>
                    <td className="pd-label">{t(label)}</td>
                    <td>{v === NOT_SPECIFIED ? t('common.notSpecified') : v}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      )}

      {scored && (
        <section className="pd-section">
          <h2 className="pd-h2">{t('detail.findings')}</h2>
          <div className="pd-cols">
            <Findings title={t('assess.energySource')} hits={r.energy} empty={t('assess.noEnergy')} />
            <Findings title={t('span.barrier')} hits={r.barrier} empty={t('assess.noBarrier')} />
            <Findings title={t('span.exposure')} hits={r.exposure} empty={t('assess.noExposure')} />
          </div>
          {(r.aggravators?.length || r.mitigators?.length) ? (
            <p className="pd-chips">
              <span className="pd-k">{t('pdf.contextFactors')} </span>
              {r.aggravators?.map((f) => (
                <span key={f.id} className="pd-chip">
                  + {f.label}
                </span>
              ))}
              {r.mitigators?.map((f) => (
                <span key={f.id} className="pd-chip">
                  − {f.label}
                </span>
              ))}
            </p>
          ) : null}
          {r.rulesTriggered && r.rulesTriggered.length > 0 && (
            <div className="pd-rules">
              <p className="pd-strong">{r.rulesTriggered.length > 1 ? t('assess.ruleBreaches') : t('assess.ruleBreach')}</p>
              {r.rulesTriggered.map((rule) => (
                <p key={rule.code}>
                  {rule.title} <span className="pd-muted">· {rule.ref}</span>
                </p>
              ))}
              {r.escalated && <p className="pd-muted pd-small">{t('assess.ruleNet', { score: r.preRuleScore ?? 0 })}</p>}
            </div>
          )}
          {r.potentialOutcomes && r.potentialOutcomes.length > 0 && (
            <p className="pd-chips">
              <span className="pd-k">{t('detail.couldHaveBecome')} </span>
              {r.potentialOutcomes.map((o) => (
                <span key={o} className="pd-chip">
                  {o}
                </span>
              ))}
            </p>
          )}
        </section>
      )}

      {scored && r.contributions && r.contributions.length > 0 && (
        <section className="pd-section pd-keep">
          <h2 className="pd-h2">{t('detail.howBuilt')}</h2>
          <table className="pd-table">
            <thead>
              <tr>
                <th>{t('pdf.factor')}</th>
                <th className="pd-num">{t('pdf.points')}</th>
              </tr>
            </thead>
            <tbody>
              {r.contributions.map((c) => (
                <tr key={c.key}>
                  <td>{c.label}</td>
                  <td className="pd-num">
                    {c.amount > 0 ? '+' : ''}
                    {c.amount}
                  </td>
                </tr>
              ))}
              <tr className="pd-total">
                <td>{t('assess.sifPotential')}</td>
                <td className="pd-num">{r.score} / 100</td>
              </tr>
            </tbody>
          </table>
        </section>
      )}

      {(r.ppe || r.hazard || (r.source === 'photo' && r.photoCheck)) && (
        <section className="pd-section pd-keep">
          <h2 className="pd-h2">{t('pdf.evidence')}</h2>
          <table className="pd-table">
            <tbody>
              {r.camera && (
                <tr>
                  <td className="pd-label">{t('incident.camera.fallback')}</td>
                  <td>
                    {r.camera.label} <span className="pd-muted">({r.camera.id})</span>
                  </td>
                </tr>
              )}
              {r.ppe && (
                <>
                  <tr>
                    <td className="pd-label">{t('pdf.detected')}</td>
                    <td>{formatDateTime(r.ppe.detectedAt)}</td>
                  </tr>
                  <tr>
                    <td className="pd-label">{t('incident.violation')}</td>
                    <td>{[...new Set(r.ppe.violations.map((v) => t(ppeKey(v.type))))].join(', ')}</td>
                  </tr>
                  <tr>
                    <td className="pd-label">{t('incident.confirmedOver')}</td>
                    <td>
                      {t('incident.framesSeconds', {
                        frames: Math.max(...r.ppe.violations.map((v) => v.frames)),
                        seconds: Math.max(...r.ppe.violations.map((v) => v.seconds)).toFixed(1),
                      })}
                    </td>
                  </tr>
                  <tr>
                    <td className="pd-label">{t('incident.model')}</td>
                    <td>
                      {r.ppe.model.name} · {r.ppe.model.architecture}
                    </td>
                  </tr>
                </>
              )}
              {r.hazard && (
                <>
                  <tr>
                    <td className="pd-label">{t('pdf.detected')}</td>
                    <td>{formatDateTime(r.hazard.detectedAt)}</td>
                  </tr>
                  <tr>
                    <td className="pd-label">{t('incident.hazard')}</td>
                    <td>{HAZARDS[r.hazard.type].label}</td>
                  </tr>
                  <tr>
                    <td className="pd-label">{t('incident.seen')}</td>
                    <td>
                      {r.hazard.subject.label} {pct(r.hazard.subject.confidence)}
                      {r.hazard.other && ` · ${r.hazard.other.label} ${pct(r.hazard.other.confidence)}`}
                    </td>
                  </tr>
                  <tr>
                    <td className="pd-label">{t('incident.models')}</td>
                    <td>{r.hazard.models.map((m) => `${m.name} · ${m.architecture}`).join(', ')}</td>
                  </tr>
                </>
              )}
              {r.source === 'photo' && r.photoCheck && (
                <>
                  {r.photoCheck.findings.map((f) => (
                    <tr key={f.type}>
                      <td className="pd-label">
                        {f.type === 'missing-ppe' ? t('incident.missingPpe') : (HAZARDS[f.type as keyof typeof HAZARDS]?.label ?? f.type)}
                      </td>
                      <td>{pct(f.confidence)}</td>
                    </tr>
                  ))}
                  <tr>
                    <td className="pd-label">{t('incident.models')}</td>
                    <td>{r.photoCheck.models.join(', ')}</td>
                  </tr>
                </>
              )}
            </tbody>
          </table>
        </section>
      )}

      <section className="pd-section pd-keep">
        <h2 className="pd-h2">{t('detail.officerReview')}</h2>
        {r.verdict ? (
          <>
            <p>
              <span className="pd-strong">{t(verdictKey(r.verdict.decision))}</span>
              <span className="pd-muted">
                {' '}
                · {r.verdict.officerName} · {formatDateTime(r.verdict.at)}
              </span>
            </p>
            {r.verdict.note && <p className="pd-text">{r.verdict.note}</p>}
          </>
        ) : (
          <p className="pd-muted">{r.status === 'scored' ? t('detail.notReviewed') : t('detail.availableOnceScored')}</p>
        )}
      </section>

      <section className="pd-section">
        <h2 className="pd-h2">{t('nav.actions')}</h2>
        {actions.data?.length ? (
          <table className="pd-table">
            <thead>
              <tr>
                <th>#</th>
                <th>{t('action.control')}</th>
                <th>{t('action.owner')}</th>
                <th>{t('actions.col.due')}</th>
                <th>{t('action.status')}</th>
              </tr>
            </thead>
            <tbody>
              {actions.data.map((a) => (
                <tr key={a.id}>
                  <td>{a.order}</td>
                  <td>
                    <span className="pd-strong">{a.control}</span>
                    {a.rationale && <span className="pd-block pd-muted">{a.rationale}</span>}
                    {a.note && <span className="pd-block">{a.note}</span>}
                  </td>
                  <td>{a.owner}</td>
                  <td className="pd-nowrap">{formatDate(a.dueAt)}</td>
                  <td className="pd-nowrap">{t(actionStatusKey(a.status))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          <p className="pd-muted">{t('detail.noActions')}</p>
        )}
      </section>

      {r.statements && r.statements.length > 0 && (
        <section className="pd-section">
          <h2 className="pd-h2">{t('incident.statements.title')}</h2>
          {r.statements.map((s) => (
            <div key={s.id} className="pd-statement">
              <p className="pd-muted pd-small">
                {t(sourceKey(s.source))} · {formatDateTime(s.at)}
              </p>
              <p className="pd-text">{s.text}</p>
            </div>
          ))}
        </section>
      )}

      {r.attachments && r.attachments.length > 0 && (
        <section className="pd-section pd-keep">
          <h2 className="pd-h2">{t('detail.attachments')}</h2>
          {r.attachments.map((a) => (
            <p key={a.path}>
              {a.name} <span className="pd-muted">· {formatBytes(a.size)}</span>
            </p>
          ))}
        </section>
      )}

      <footer className="pd-foot">
        <p>{t('pdf.disclaimer')}</p>
        <p>
          PRAHARI · {r.id}
          {r.engineVersion ? ` · ${t('detail.engine')} v${r.engineVersion}` : ''}
        </p>
      </footer>
    </article>
  );
}
