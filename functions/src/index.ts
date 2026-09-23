/**
 * PRAHARI Cloud Functions (2nd gen, Node 20).
 *
 * Cloud Functions v2 runs on Cloud Run and requires the Blaze plan — even for a
 * Firestore trigger. VITE_FUNCTIONS_REGION in the web app must equal REGION:
 * a mismatch surfaces in the browser as a CORS error, which looks like
 * something else entirely.
 */

// First, so the region applies to every function below (see lib/options.ts).
import './lib/options.js';

export { scoreReport } from './triggers/scoreReport.js';
export { cleanupOrphanAttachments } from './triggers/cleanup.js';
export { submitReport, recordVerdict, rescoreReport, archiveReport } from './callables/reports.js';
export { createAction, updateAction, deleteAction } from './callables/actions.js';
export { setUserRole, setUserDisabled, setUserInstallation, deleteUser, claimFirstAdmin } from './callables/users.js';
export { upsertReference, deleteReference } from './callables/reference.js';
export { createPpeIncident, createHazardIncident, addStatement } from './callables/incidents.js';
