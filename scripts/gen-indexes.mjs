#!/usr/bin/env node
/**
 * Generates firestore.indexes.json from the queries the app actually issues.
 *
 * The emulator never enforces composite indexes, so a query that works
 * locally can fail in production with FAILED_PRECONDITION. Deriving the index
 * list from the same filter/sort matrix the UI exposes (src/services/*) is
 * how that gap is closed. Change a query's filters or sort there, change the
 * matrix here, then run:  npm run indexes
 */

import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const out = fileURLToPath(new URL('../firestore.indexes.json', import.meta.url));

const ASC = 'ASCENDING';
const DESC = 'DESCENDING';
const eq = (fieldPath) => ({ fieldPath, order: ASC });
const contains = (fieldPath) => ({ fieldPath, arrayConfig: 'CONTAINS' });

function subsets(list) {
  return list.reduce((acc, item) => acc.flatMap((s) => [s, [...s, item]]), [[]]);
}

const indexes = [];
const add = (collectionGroup, fields) => {
  if (fields.length < 2) return; // single-field indexes are automatic
  indexes.push({ collectionGroup, queryScope: 'COLLECTION', fields });
};

/* ---------------- reports: the register ---------------- */

const BY_PRIORITY = [{ fieldPath: 'score', order: DESC }, { fieldPath: 'createdAt', order: DESC }];
const BY_NEWEST = [{ fieldPath: 'createdAt', order: DESC }];

// Who may see what (src/services/scope.ts): officers query the whole register,
// a manager's queries carry installationId (already covered by the filter
// combinations below), everyone else's carry reportedBy.
const SCOPES = [[], ['reportedBy']];

// Active register: archived == false, status == scored, plus any combination
// of tier / installation / "awaiting review", sorted by priority or newest.
// The same prefix serves the processing view, the dashboard feed and samples.
for (const scope of SCOPES) {
  for (const extra of subsets(['tier', 'installationId', 'verdictDecision'])) {
    const equality = ['archived', 'status', ...scope, ...extra].map(eq);
    add('reports', [...equality, ...BY_PRIORITY]);
    add('reports', [...equality, ...BY_NEWEST]);
  }
}

// Word search: array-contains on searchTokens, with tier / installation,
// newest first. (Search deliberately does not combine with the review queue
// or the priority sort: every array-contains index multiplies index entries
// by the token count, so they are kept to the few combinations offered.)
for (const scope of SCOPES) {
  for (const extra of subsets(['tier', 'installationId'])) {
    add('reports', [...['archived', 'status', ...scope, ...extra].map(eq), contains('searchTokens'), ...BY_NEWEST]);
  }
}

// Archived view (per scope) and "my reports".
for (const scope of [[], ['reportedBy'], ['installationId']]) add('reports', [...['archived', ...scope].map(eq), ...BY_NEWEST]);
add('reports', [eq('reportedBy'), ...BY_NEWEST]);

/* ---------------- actions ---------------- */

const BY_DUE = [{ fieldPath: 'dueAt', order: ASC }];
const BY_UPDATED = [{ fieldPath: 'updatedAt', order: DESC }];
for (const scope of SCOPES) {
  for (const extra of [[], ['installationId']]) {
    add('actions', [...[...scope, ...extra, 'status'].map(eq), ...BY_DUE]); // open / in progress / overdue
    add('actions', [...[...scope, ...extra, 'status'].map(eq), ...BY_UPDATED]); // closed / cancelled
    add('actions', [...[...scope, ...extra].map(eq), ...BY_DUE]); // all statuses
  }
}
// A report's own actions, per scope.
for (const scope of [[], ['reportedBy'], ['installationId']]) {
  add('actions', [...['reportId', ...scope].map(eq), { fieldPath: 'order', order: ASC }]);
}

/* ---------------- users, audit ---------------- */

add('users', [eq('role'), { fieldPath: 'email', order: ASC }]);
add('auditLogs', [eq('action'), { fieldPath: 'at', order: DESC }]);

/* ---------------- exemptions ---------------- */

// Large free text and arrays of maps are never queried. Indexing them would
// only add write latency and storage cost to every report.
const exempt = (collectionGroup, fieldPath) => ({ collectionGroup, fieldPath, indexes: [] });
const fieldOverrides = [
  ...[
    'text',
    'evidence',
    'contributions',
    'energy',
    'barrier',
    'exposure',
    'aggravators',
    'mitigators',
    'rulesTriggered',
    'potentialOutcomes',
    'capa',
    'language',
    'attachments',
    'verdict',
  ].map((f) => exempt('reports', f)),
  exempt('auditLogs', 'detail'),
  exempt('labels', 'text'),
];

writeFileSync(out, `${JSON.stringify({ indexes, fieldOverrides }, null, 2)}\n`);
console.log(`firestore.indexes.json: ${indexes.length} composite indexes, ${fieldOverrides.length} exemptions`);
