/**
 * Validation schemas shared by the browser (form validation) and the Cloud
 * Functions (authoritative input validation). Canonical source:
 * functions/src/shared/ — synced verbatim into src/shared/. Edit here only.
 *
 * The browser validates for the user's benefit: fast feedback, no round trip.
 * The server validates because the browser cannot be trusted. Both use these
 * exact schemas, so a limit can never be enforced on one side and forgotten on
 * the other.
 */

import { z } from 'zod';
import {
  ACTION_STATUSES,
  LIMITS,
  REPORT_TYPES,
  ROLES,
  SHIFTS,
  VERDICTS,
} from './constants.js';
import { HAZARD_TYPES } from './hazards.js';
import { PPE_SETTINGS_LIMITS, PPE_TYPES } from './ppe.js';

/** Firestore auto-IDs, Auth UIDs and our own document ids. */
export const idSchema = z
  .string()
  .min(1, 'Required')
  .max(128)
  .regex(/^[A-Za-z0-9_-]+$/, 'Invalid identifier');

const trimmed = (min: number, max: number, label: string) =>
  z
    .string()
    .trim()
    .min(min, min <= 1 ? `${label} is required` : `${label} must be at least ${min} characters`)
    .max(max, `${label} must be at most ${max} characters`);

/* ------------------------------------------------------------------ *
 * Reports
 * ------------------------------------------------------------------ */

export const attachmentSchema = z.object({
  path: z.string().min(1).max(512),
  name: z.string().trim().min(1).max(200),
  size: z.number().int().positive().max(LIMITS.attachmentBytesMax, 'File is larger than 10 MB'),
  contentType: z
    .string()
    .refine((t) => LIMITS.attachmentTypes.includes(t), 'Only JPEG, PNG, WebP or PDF files are accepted'),
});
export type AttachmentInput = z.infer<typeof attachmentSchema>;

/** The fields a person fills in. Shared by the submit form and the callable. */
export const reportFieldsSchema = z.object({
  text: trimmed(LIMITS.reportTextMin, LIMITS.reportTextMax, 'Report'),
  installationId: idSchema.refine((v) => v.length > 0, 'Choose an installation'),
  activityId: idSchema.refine((v) => v.length > 0, 'Choose an activity'),
  shift: z.enum(SHIFTS),
  type: z.enum(REPORT_TYPES),
  contractor: z.boolean(),
});
export type ReportFields = z.infer<typeof reportFieldsSchema>;

/** Browser geolocation, only ever sent when the reporter chooses to share it. */
export const geoSchema = z.object({
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  accuracy: z.number().min(0).max(100_000).nullable().default(null),
});
export type GeoInput = z.infer<typeof geoSchema>;

export const submitReportSchema = reportFieldsSchema.extend({
  reportId: idSchema,
  attachments: z.array(attachmentSchema).max(LIMITS.attachmentsMax, 'At most 5 attachments').default([]),
  // The quick mobile report may leave the activity out.
  activityId: idSchema.optional(),
  // 'photo': the text was drafted by the AI photo check and sent by the worker.
  source: z.enum(['text', 'voice', 'photo']).default('text'),
  geo: geoSchema.nullable().default(null),
  photoCheck: z
    .object({
      models: z.array(z.string().trim().min(1).max(80)).min(1).max(4),
      findings: z
        .array(z.object({ type: z.string().trim().min(1).max(40), confidence: z.number().min(0).max(1) }))
        .max(10),
    })
    .nullable()
    .default(null),
});
export type SubmitReportInput = z.infer<typeof submitReportSchema>;

export const reportRefSchema = z.object({ reportId: idSchema });

export const recordVerdictSchema = z.object({
  reportId: idSchema,
  decision: z.enum(VERDICTS),
  note: z.string().trim().max(LIMITS.noteMax).default(''),
});
export type RecordVerdictInput = z.infer<typeof recordVerdictSchema>;

export const archiveReportSchema = z.object({
  reportId: idSchema,
  reason: trimmed(3, 500, 'Reason'),
});
export type ArchiveReportInput = z.infer<typeof archiveReportSchema>;

/* ------------------------------------------------------------------ *
 * Corrective actions
 * ------------------------------------------------------------------ */

export const actionFieldsSchema = z.object({
  control: trimmed(3, 200, 'Control'),
  rationale: z.string().trim().max(LIMITS.noteMax).default(''),
  owner: trimmed(1, LIMITS.nameMax, 'Owner'),
  dueInDays: z.coerce.number().int().min(1, 'At least 1 day').max(365, 'At most 365 days'),
});
export type ActionFields = z.infer<typeof actionFieldsSchema>;

export const createActionSchema = actionFieldsSchema.extend({ reportId: idSchema });
export type CreateActionInput = z.infer<typeof createActionSchema>;

export const updateActionSchema = z
  .object({
    actionId: idSchema,
    status: z.enum(ACTION_STATUSES).optional(),
    owner: trimmed(1, LIMITS.nameMax, 'Owner').optional(),
    dueInDays: z.coerce.number().int().min(1).max(365).optional(),
    note: z.string().trim().max(LIMITS.noteMax).optional(),
  })
  .refine(
    (v) => v.status !== undefined || v.owner !== undefined || v.dueInDays !== undefined || v.note !== undefined,
    'Nothing to update',
  );
export type UpdateActionInput = z.infer<typeof updateActionSchema>;

export const actionRefSchema = z.object({ actionId: idSchema });

/* ------------------------------------------------------------------ *
 * Users
 * ------------------------------------------------------------------ */

export const setUserRoleSchema = z.object({ uid: idSchema, role: z.enum(ROLES) });
export const setUserDisabledSchema = z.object({ uid: idSchema, disabled: z.boolean() });
export const setUserInstallationSchema = z.object({ uid: idSchema, installationId: idSchema.nullable() });
export const userRefSchema = z.object({ uid: idSchema });

export const profileSchema = z.object({
  displayName: trimmed(1, LIMITS.nameMax, 'Name'),
});
export type ProfileInput = z.infer<typeof profileSchema>;

/* ------------------------------------------------------------------ *
 * Reference data
 * ------------------------------------------------------------------ */

export const REFERENCE_KINDS = ['installations', 'activities'] as const;
export type ReferenceKind = (typeof REFERENCE_KINDS)[number];

export const referenceFieldsSchema = z.object({
  name: trimmed(2, LIMITS.nameMax, 'Name'),
  code: z
    .string()
    .trim()
    .max(16, 'Code must be at most 16 characters')
    .regex(/^[A-Za-z0-9-]*$/, 'Letters, numbers and dashes only')
    .transform((v) => v.toUpperCase())
    .default(''),
  region: z.string().trim().max(LIMITS.nameMax).default(''),
  active: z.boolean().default(true),
});
export type ReferenceFields = z.infer<typeof referenceFieldsSchema>;

export const upsertReferenceSchema = referenceFieldsSchema.extend({
  kind: z.enum(REFERENCE_KINDS),
  // Absent on create. The callable protocol turns `undefined` into `null`,
  // so accept both as "no id".
  id: idSchema.nullish().transform((v) => v ?? undefined),
});
export type UpsertReferenceInput = z.input<typeof upsertReferenceSchema>;

export const deleteReferenceSchema = z.object({ kind: z.enum(REFERENCE_KINDS), id: idSchema });

/* ------------------------------------------------------------------ *
 * Camera PPE incidents and worker statements
 * ------------------------------------------------------------------ */

const unit = z.number().min(0).max(1);
const px = z.number().min(0).max(20_000);
const boxSchema = z.object({ x1: px, y1: px, x2: px, y2: px });
const ppeTypeSchema = z.enum(PPE_TYPES);

export const ppeIncidentSchema = z.object({
  reportId: idSchema,
  installationId: idSchema,
  camera: z.object({
    id: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, 'Invalid camera id'),
    label: trimmed(1, LIMITS.nameMax, 'Camera name'),
    kind: z.enum(['device', 'stream']),
  }),
  violations: z
    .array(
      z.object({
        type: ppeTypeSchema,
        trackId: z.number().int().min(0),
        personConfidence: unit,
        frames: z.number().int().min(1).max(100_000),
        seconds: z.number().min(0).max(86_400),
      }),
    )
    .min(1)
    .max(10),
  workers: z
    .array(
      z.object({
        trackId: z.number().int().min(0),
        box: boxSchema,
        confidence: unit,
        ppe: z.record(z.string(), z.object({ state: z.enum(['present', 'missing']), confidence: unit.nullable() })),
      }),
    )
    .max(30),
  frame: z.object({ width: z.number().int().min(1).max(20_000), height: z.number().int().min(1).max(20_000) }),
  evidence: attachmentSchema,
  model: z.object({
    name: trimmed(1, 80, 'Model name'),
    architecture: z.string().trim().max(40),
    backend: z.enum(['webgpu', 'wasm', 'remote']),
    classes: z.array(z.string().max(40)).max(50),
  }),
  settings: z.object({
    minConfidence: z.number().min(PPE_SETTINGS_LIMITS.minConfidence[0]).max(PPE_SETTINGS_LIMITS.minConfidence[1]),
    confirmationFrames: z.number().int().min(PPE_SETTINGS_LIMITS.confirmationFrames[0]).max(PPE_SETTINGS_LIMITS.confirmationFrames[1]),
    violationSeconds: z.number().min(PPE_SETTINGS_LIMITS.violationSeconds[0]).max(PPE_SETTINGS_LIMITS.violationSeconds[1]),
    incidentCooldownSeconds: z
      .number()
      .min(PPE_SETTINGS_LIMITS.incidentCooldownSeconds[0])
      .max(PPE_SETTINGS_LIMITS.incidentCooldownSeconds[1]),
  }),
  required: z.array(ppeTypeSchema).min(1).max(PPE_TYPES.length),
  geo: geoSchema.nullable().default(null),
});
export type PpeIncidentInput = z.infer<typeof ppeIncidentSchema>;

const seenSchema = z.object({ label: z.string().trim().min(1).max(40), confidence: unit, box: boxSchema });
const zoneIdSchema = z.string().regex(/^[A-Za-z0-9_-]{1,40}$/, 'Invalid zone id');

/** A confirmed camera hazard (unsafe act, unsafe condition or near miss). */
export const hazardIncidentSchema = z
  .object({
    reportId: idSchema,
    installationId: idSchema,
    camera: z.object({
      id: z.string().regex(/^[A-Za-z0-9_-]{4,64}$/, 'Invalid camera id'),
      label: trimmed(1, LIMITS.nameMax, 'Camera name'),
      kind: z.enum(['device', 'stream']),
    }),
    event: z.object({
      key: z.string().max(80),
      type: z.enum(HAZARD_TYPES),
      frames: z.number().int().min(1).max(100_000),
      seconds: z.number().min(0).max(86_400),
      subject: seenSchema,
      other: seenSchema.optional(),
      zone: z.object({ id: zoneIdSchema, name: trimmed(1, 60, 'Zone name'), kind: z.enum(['danger', 'keep-clear']) }).optional(),
      objects: z.array(z.string().trim().min(1).max(40)).max(20).optional(),
      method: z.enum(['pose', 'box']).optional(),
    }),
    frame: z.object({ width: z.number().int().min(1).max(20_000), height: z.number().int().min(1).max(20_000) }),
    evidence: attachmentSchema,
    models: z
      .array(z.object({ role: z.enum(['ppe', 'general', 'pose', 'fire']), name: trimmed(1, 80, 'Model name'), architecture: z.string().trim().max(40) }))
      .min(1)
      .max(4),
    settings: z.object({
      minConfidence: z.number().min(0.25).max(0.95),
      incidentCooldownSeconds: z
        .number()
        .min(PPE_SETTINGS_LIMITS.incidentCooldownSeconds[0])
        .max(PPE_SETTINGS_LIMITS.incidentCooldownSeconds[1]),
    }),
    geo: geoSchema.nullable().default(null),
  })
  .superRefine((v, ctx) => {
    // The de-duplication key is the type, or type + zone for zone rules — nothing else.
    const zoneRule = v.event.type === 'restricted-zone' || v.event.type === 'blocked-zone';
    if (zoneRule && !v.event.zone) ctx.addIssue({ code: 'custom', path: ['event', 'zone'], message: 'Zone rules need their zone.' });
    const want = zoneRule && v.event.zone ? `${v.event.type}:${v.event.zone.id}` : v.event.type;
    if (v.event.key !== want) ctx.addIssue({ code: 'custom', path: ['event', 'key'], message: 'Invalid hazard key.' });
  });
export type HazardIncidentInput = z.infer<typeof hazardIncidentSchema>;

/** A worker's own account added to an existing incident (voice or typed). */
export const statementSchema = z.object({
  reportId: idSchema,
  text: trimmed(3, LIMITS.reportTextMax, 'Statement'),
  source: z.enum(['text', 'voice']),
});
export type StatementInput = z.infer<typeof statementSchema>;
