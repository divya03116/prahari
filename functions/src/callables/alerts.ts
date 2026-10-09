/**
 * Tier 1 alert preferences and a test send.
 *
 * Preferences live on the person's own profile (users/{uid}.alerts) but are
 * written only here: the rules let a browser change nothing on a profile
 * except the display name.
 */

import { onCall, HttpsError } from 'firebase-functions/v2/https';

import { buildAlert, emailConfigured, sendEmails, sendWhatsApps, whatsappConfigured } from '../lib/alerts.js';
import { audit, db, guard, internal, parse, rateLimit } from '../lib/core.js';
import { COLLECTIONS, hasRole } from '../shared/constants.js';
import { analyse } from '../shared/engine.js';
import { alertSettingsSchema, type AlertSettings } from '../shared/schemas.js';

/** Who is alerted at all: the people who review reports or manage an installation. */
const ALERT_ROLE = 'installation-manager';

function readPrefs(stored: unknown): AlertSettings {
  const p = (stored ?? {}) as Partial<AlertSettings>;
  const whatsappNumber = typeof p.whatsappNumber === 'string' ? p.whatsappNumber : '';
  return { email: p.email !== false, whatsapp: Boolean(whatsappNumber) && p.whatsapp !== false, whatsappNumber };
}

export const getAlertSettings = onCall(async (request) => {
  const caller = await guard(request);
  try {
    const profile = await db.collection(COLLECTIONS.users).doc(caller.uid).get();
    return {
      eligible: hasRole(caller.role, ALERT_ROLE),
      settings: readPrefs(profile.get('alerts')),
      // Whether the server can send at all — so the screen never promises an
      // alert the deployment is not set up to deliver.
      channels: { email: emailConfigured(), whatsapp: whatsappConfigured() },
    };
  } catch (err) {
    internal(err, { fn: 'getAlertSettings' });
  }
});

export const setAlertSettings = onCall(async (request) => {
  const caller = await guard(request, ALERT_ROLE);
  const settings = parse(alertSettingsSchema, request.data);
  try {
    await db.collection(COLLECTIONS.users).doc(caller.uid).set({ alerts: settings }, { merge: true });
    // The number itself stays out of the audit trail.
    await audit('alerts.settings', caller, caller.uid, { email: settings.email, whatsapp: settings.whatsapp });
    return { ok: true as const };
  } catch (err) {
    internal(err, { fn: 'setAlertSettings' });
  }
});

/**
 * Sends a clearly marked test alert to the administrator who asked, on the
 * channels they have switched on, and reports exactly what each provider said.
 */
export const sendTestAlert = onCall(async (request) => {
  const caller = await guard(request, 'admin');
  await rateLimit(caller.uid, 'test-alert', 10);
  try {
    const profile = await db.collection(COLLECTIONS.users).doc(caller.uid).get();
    const prefs = readPrefs(profile.get('alerts'));
    const text = 'TEST ALERT — no action needed. This checks that PRAHARI can reach you. A fitter was working at height on a scaffold without a harness, directly above two people.';
    const message = buildAlert('test', { text, installationName: 'Test installation', activityName: 'Test', type: 'unsafe-act' }, analyse(text), null);
    message.subject = `[TEST] ${message.subject}`;
    const [email, whatsapp] = await Promise.all([
      sendEmails(prefs.email && caller.email ? [caller.email] : [], message),
      sendWhatsApps(prefs.whatsapp ? [prefs.whatsappNumber] : [], message),
    ]);
    await audit('alerts.test', caller, caller.uid, { email: email.status, whatsapp: whatsapp.status });
    return { email, whatsapp };
  } catch (err) {
    if (err instanceof HttpsError) throw err;
    internal(err, { fn: 'sendTestAlert' });
  }
});
