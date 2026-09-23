/**
 * Typed wrappers for every Cloud Function callable. This file is the whole
 * write API of the application: the browser never writes a report, action,
 * role or reference record to Firestore directly — the rules forbid it — it
 * asks the service layer, which authenticates, authorises, validates and
 * audits.
 */

import { getFunctionsLazy } from '@/lib/firebase';
import type { Role } from '@/shared/constants';
import type {
  ArchiveReportInput,
  CreateActionInput,
  RecordVerdictInput,
  UpdateActionInput,
  UpsertReferenceInput,
  ReferenceKind,
  StatementInput,
} from '@/shared/schemas';
import type { hazardIncidentSchema, ppeIncidentSchema, submitReportSchema } from '@/shared/schemas';
import type { z } from 'zod';

type PpeIncidentPayload = z.input<typeof ppeIncidentSchema>;
type HazardIncidentPayload = z.input<typeof hazardIncidentSchema>;

async function call<I, O>(name: string, data: I): Promise<O> {
  const [functions, { httpsCallable }] = await Promise.all([getFunctionsLazy(), import('firebase/functions')]);
  const res = await httpsCallable<I, O>(functions, name)(data);
  return res.data;
}

type Ok = { ok: true };

export const api = {
  submitReport: (d: z.input<typeof submitReportSchema>) =>
    call<z.input<typeof submitReportSchema>, { reportId: string }>('submitReport', d),
  recordVerdict: (d: RecordVerdictInput) => call<RecordVerdictInput, Ok>('recordVerdict', d),
  rescoreReport: (reportId: string) =>
    call<{ reportId: string }, Ok & { score: number; tier: number }>('rescoreReport', { reportId }),
  archiveReport: (d: ArchiveReportInput) => call<ArchiveReportInput, Ok & { actionsCancelled: number }>('archiveReport', d),

  createAction: (d: CreateActionInput) => call<CreateActionInput, { actionId: string }>('createAction', d),
  updateAction: (d: UpdateActionInput) => call<UpdateActionInput, Ok>('updateAction', d),
  deleteAction: (actionId: string) => call<{ actionId: string }, Ok>('deleteAction', { actionId }),

  setUserRole: (uid: string, role: Role) => call<{ uid: string; role: Role }, Ok>('setUserRole', { uid, role }),
  claimFirstAdmin: () => call<Record<string, never>, Ok>('claimFirstAdmin', {}),
  setUserDisabled: (uid: string, disabled: boolean) =>
    call<{ uid: string; disabled: boolean }, Ok>('setUserDisabled', { uid, disabled }),
  setUserInstallation: (uid: string, installationId: string | null) =>
    call<{ uid: string; installationId: string | null }, Ok>('setUserInstallation', { uid, installationId }),
  deleteUser: (uid: string) => call<{ uid: string }, Ok>('deleteUser', { uid }),

  upsertReference: (d: UpsertReferenceInput) => call<UpsertReferenceInput, { id: string }>('upsertReference', d),
  deleteReference: (kind: ReferenceKind, id: string) =>
    call<{ kind: ReferenceKind; id: string }, Ok>('deleteReference', { kind, id }),

  createPpeIncident: (d: PpeIncidentPayload) =>
    call<PpeIncidentPayload, { deduplicated: boolean; reportId: string | null; types?: string[] }>('createPpeIncident', d),
  createHazardIncident: (d: HazardIncidentPayload) =>
    call<HazardIncidentPayload, { deduplicated: boolean; reportId: string | null; type?: string }>('createHazardIncident', d),
  addStatement: (d: StatementInput) => call<StatementInput, Ok & { id: string }>('addStatement', d),
};
