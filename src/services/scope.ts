import { where, type QueryConstraint } from 'firebase/firestore';

/**
 * Which reports — and their corrective actions — a person may see. Mirrors
 * canSee() in firestore.rules:
 *   all           HSE officers and administrators
 *   installation  an installation manager: the installation assigned to them
 *   own           everyone else: only what they filed themselves
 *
 * Firestore rules are not filters: a query that could return a document the
 * person may not read is refused as a whole, so every report/action query
 * adds these constraints.
 */
export type ReportScope =
  | { kind: 'all' }
  | { kind: 'installation'; installationId: string }
  | { kind: 'own'; uid: string };

export function scopeConstraints(s: ReportScope): QueryConstraint[] {
  switch (s.kind) {
    case 'all':
      return [];
    case 'installation':
      return [where('installationId', '==', s.installationId)];
    case 'own':
      return [where('reportedBy', '==', s.uid)];
  }
}

/** A stable value for hook dependency lists. */
export function scopeKey(s: ReportScope): string {
  return s.kind === 'all' ? 'all' : s.kind === 'installation' ? `installation:${s.installationId}` : `own:${s.uid}`;
}
