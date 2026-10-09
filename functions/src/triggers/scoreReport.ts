/**
 * scoreReport — the only writer of an assessment, anywhere in the system.
 *
 * A report is created by the submitReport callable with status 'pending'. This
 * trigger assesses it, opens corrective actions for Tier 1 and 2, and maintains
 * the two roll-ups the dashboards read (per-installation heat, daily totals),
 * so no screen ever has to scan the whole register to draw a chart. A Tier 1
 * result also alerts the people who must act (lib/alerts.ts).
 */

import { onDocumentCreated } from 'firebase-functions/v2/firestore';
import { logger } from 'firebase-functions';

import { alertTier1 } from '../lib/alerts.js';
import { db, dayKey, FieldValue } from '../lib/core.js';
import { addToHeat, bumpDaily, openEngineActions } from '../lib/rollups.js';
import { COLLECTIONS } from '../shared/constants.js';
import { analyse, draftCapa, ENGINE_VERSION, type Assessment, type CapaStep } from '../shared/engine.js';
import { tokenize } from '../shared/search.js';
import type { PpeType } from '../shared/ppe.js';
import { structureReport, type ReportSource, type StructureInput } from '../shared/structure.js';
import type { HazardType } from '../shared/hazards.js';

/** Every field the engine produced, in the shape the console reads. */
export function assessmentFields(
  result: Assessment,
  capa: CapaStep[],
  searchSource: string,
  report?: Record<string, unknown>,
): Record<string, unknown> {
  // Structured incident fields, derived from the same text and assessment.
  const r = report ?? {};
  const ppe = r.ppe as { violations?: { type: PpeType }[] } | undefined;
  const structured = structureReport({
    text: String(r.text ?? ''),
    source: (r.source as ReportSource | undefined) ?? 'text',
    assessment: result,
    capa,
    installationName: (r.installationName as string | undefined) ?? null,
    geo: (r.geo as StructureInput['geo']) ?? null,
    camera: (r.camera as { label: string } | undefined) ?? null,
    ppeMissing: ppe?.violations ? [...new Set(ppe.violations.map((v) => v.type))] : null,
    hazard: (r.hazard as { type: HazardType } | undefined) ?? null,
  });
  return {
    structured,
    status: 'scored',
    score: result.score,
    preRuleScore: result.preRuleScore,
    tier: result.tier,
    tierLabel: result.tierLabel,
    responseWindow: result.responseWindow,
    escalated: result.escalated,
    noInjury: result.noInjury,
    energy: result.energy,
    barrier: result.barrier,
    exposure: result.exposure,
    aggravators: result.aggravators,
    mitigators: result.mitigators,
    contributions: result.contributions,
    rulesTriggered: result.rulesTriggered,
    potentialOutcomes: result.potentialOutcomes,
    evidence: result.evidence,
    language: result.language,
    capa,
    searchTokens: tokenize(searchSource),
    engineVersion: result.engineVersion,
    modelVersion: result.modelVersion,
    scoredAt: FieldValue.serverTimestamp(),
    error: FieldValue.delete(),
  };
}

export const scoreReport = onDocumentCreated(`${COLLECTIONS.reports}/{reportId}`, async (event) => {
  const snap = event.data;
  if (!snap) return;

  const report = snap.data();
  const ref = snap.ref;
  const installationId = String(report.installationId ?? '');
  const installationName = String(report.installationName ?? 'Unassigned');

  try {
    const result = analyse(String(report.text ?? ''));
    const capa = draftCapa(result, { installation: installationName });
    const created: Date = report.createdAt?.toDate?.() ?? new Date();
    const day = dayKey(created);

    await ref.update(
      assessmentFields(result, capa, `${report.text} ${installationName} ${report.activityName ?? ''}`, report),
    );

    const batch = db.batch();
    // Tier 1 and 2 open tracked actions automatically. An alert nobody closes
    // out is not a safety system.
    if (result.tier <= 2) {
      openEngineActions(batch, {
        reportId: ref.id,
        reportedBy: report.reportedBy ?? null,
        installationId,
        installationName,
        tier: result.tier,
        capa,
        created,
      });
    }
    // Daily totals for the dashboard trend. increment() is commutative, so
    // concurrent reports never lose a count.
    bumpDaily(batch, day, result.tier, 1);
    await batch.commit();

    await addToHeat(installationId, installationName, day, result.score);

    logger.info('scored', { reportId: ref.id, score: result.score, tier: result.tier });

    // After everything else: alertTier1 never throws, so a provider that is
    // down cannot turn a scored report into a failed one.
    await alertTier1(ref.id, report, result, capa[0]?.control ?? null);
  } catch (err) {
    // Never leave a report stuck on 'pending' — a queue that silently swallows
    // reports is more dangerous than one that shows a failure.
    logger.error('scoreReport failed', { reportId: ref.id, error: String(err) });
    await ref.update({
      status: 'failed',
      error: String((err as Error)?.message ?? err).slice(0, 500),
      scoredAt: FieldValue.serverTimestamp(),
      engineVersion: ENGINE_VERSION,
    });
  }
});
