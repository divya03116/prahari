/**
 * Tier 1 alerts — telling the people who must act, by email and WhatsApp, the
 * moment a report is scored Tier 1.
 *
 * Who is told: every HSE officer and administrator, and the managers of the
 * installation the report is about. Each of them chooses their channels in
 * Settings (email is on by default; WhatsApp needs a number).
 *
 * Both channels are off until they are configured (functions/.env.<project>):
 *
 *   ALERT_APP_URL            https://your-site            link in the message
 *   ALERT_EMAIL_PROVIDER     resend | brevo
 *   ALERT_EMAIL_API_KEY      the provider's API key
 *   ALERT_EMAIL_FROM         PRAHARI Alerts <alerts@your-domain>
 *   WHATSAPP_TOKEN           WhatsApp Cloud API access token
 *   WHATSAPP_PHONE_NUMBER_ID the sending number's id
 *   WHATSAPP_TEMPLATE        approved template name (default prahari_tier1_alert)
 *   WHATSAPP_TEMPLATE_LANG   its language code (default en)
 *
 * Nothing is ever reported as sent that was not: every alert leaves a record
 * in alerts/{reportId} with, per channel, how many messages the provider
 * accepted, how many it refused, or that the channel is not set up. One alert
 * per report, however often the report is re-scored. The message never says
 * who filed the report.
 */

import { defineString } from 'firebase-functions/params';
import { logger } from 'firebase-functions';

import { COLLECTIONS, REPORT_TYPE_LABEL, type ReportType } from '../shared/constants.js';
import type { Assessment } from '../shared/engine.js';
import { db, FieldValue } from './core.js';

const APP_URL = defineString('ALERT_APP_URL', { default: '' });
const EMAIL_PROVIDER = defineString('ALERT_EMAIL_PROVIDER', { default: '' });
const EMAIL_API_KEY = defineString('ALERT_EMAIL_API_KEY', { default: '' });
const EMAIL_FROM = defineString('ALERT_EMAIL_FROM', { default: '' });
/** Override of the provider's address; for tests. */
const EMAIL_API_URL = defineString('ALERT_EMAIL_API_URL', { default: '' });
const WHATSAPP_TOKEN = defineString('WHATSAPP_TOKEN', { default: '' });
const WHATSAPP_PHONE_NUMBER_ID = defineString('WHATSAPP_PHONE_NUMBER_ID', { default: '' });
const WHATSAPP_TEMPLATE = defineString('WHATSAPP_TEMPLATE', { default: '' });
const WHATSAPP_TEMPLATE_LANG = defineString('WHATSAPP_TEMPLATE_LANG', { default: '' });
/** Override of the Graph API address; for tests. */
const WHATSAPP_API_URL = defineString('WHATSAPP_API_URL', { default: '' });

const WHATSAPP_DEFAULTS = { template: 'prahari_tier1_alert', lang: 'en', api: 'https://graph.facebook.com/v21.0' };

const EMAIL_ENDPOINT: Record<string, string> = {
  resend: 'https://api.resend.com/emails',
  brevo: 'https://api.brevo.com/v3/smtp/email',
};
const SEND_TIMEOUT_MS = 10_000;

export type ChannelStatus = 'sent' | 'partial' | 'failed' | 'not-configured' | 'no-recipients';

export interface ChannelResult {
  status: ChannelStatus;
  sent: number;
  failed: number;
  /** The provider's first refusal, shortened. Never a recipient's address. */
  error?: string;
}

export interface AlertRecipient {
  email: string | null;
  whatsapp: string | null;
}

export interface AlertMessage {
  subject: string;
  text: string;
  html: string;
  /** The four values of the WhatsApp template: site, score, summary, link. */
  whatsapp: [string, string, string, string];
}

export const emailConfigured = (): boolean =>
  EMAIL_PROVIDER.value() in EMAIL_ENDPOINT && Boolean(EMAIL_API_KEY.value()) && Boolean(EMAIL_FROM.value());
export const whatsappConfigured = (): boolean => Boolean(WHATSAPP_TOKEN.value()) && Boolean(WHATSAPP_PHONE_NUMBER_ID.value());

/* ------------------------------------------------------------------ *
 * The message
 * ------------------------------------------------------------------ */

const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const clip = (s: string, max: number): string => (s.length > max ? `${s.slice(0, max - 1).trimEnd()}…` : s);
/** WhatsApp template values may not contain line breaks, tabs or runs of spaces. */
const oneLine = (s: string): string => s.replace(/\s+/g, ' ').trim();

interface AlertReport {
  text?: unknown;
  installationName?: unknown;
  activityName?: unknown;
  type?: unknown;
  shift?: unknown;
}

export function buildAlert(reportId: string, report: AlertReport, result: Assessment, firstAction: string | null): AlertMessage {
  const site = String(report.installationName ?? 'Unassigned');
  const activity = String(report.activityName ?? '');
  const type = REPORT_TYPE_LABEL[report.type as ReportType] ?? '';
  const narrative = clip(String(report.text ?? '').trim(), 600);
  const base = APP_URL.value().replace(/\/+$/, '');
  const link = base ? `${base}/app/reports/${reportId}` : '';

  const why = [
    result.energy.length ? `Energy: ${result.energy.map((h) => h.label).join(', ')}` : null,
    result.barrier.length ? `Failed barrier: ${result.barrier.map((h) => h.label).join(', ')}` : null,
    result.exposure.length ? `Exposure: ${result.exposure.map((h) => h.label).join(', ')}` : null,
    result.rulesTriggered.length ? `Life-saving rules: ${result.rulesTriggered.map((r) => r.title).join('; ')}` : null,
  ].filter((line): line is string => Boolean(line));

  const context = [site, activity, type, report.shift ? `${String(report.shift)} shift` : ''].filter(Boolean).join(' · ');
  const headline = `Tier 1 · Critical — SIF potential ${result.score}/100`;
  const note =
    'You receive this because you review or manage safety reports in PRAHARI; change it under Settings. ' +
    'The score estimates the potential for serious injury from what the report describes. It is not a prediction.';

  const text = [
    headline,
    context,
    `Respond within ${result.responseWindow}.`,
    '',
    'What was reported (as written):',
    narrative,
    '',
    ...(why.length ? ['Why it scored Tier 1:', ...why.map((w) => `- ${w}`), ''] : []),
    ...(firstAction ? [`First action: ${firstAction}`, ''] : []),
    ...(link ? [`Open the report: ${link}`, ''] : []),
    note,
  ].join('\n');

  const html = [
    '<div style="font-family:Segoe UI,Arial,sans-serif;font-size:14px;line-height:1.5;color:#111827;max-width:560px">',
    `<p style="margin:0 0 4px;font-size:12px;font-weight:700;letter-spacing:.14em">PRAHARI</p>`,
    `<p style="margin:0;padding:10px 14px;border-radius:8px;background:#c62828;color:#fff;font-size:16px;font-weight:700">${esc(headline)}</p>`,
    `<p style="margin:12px 0 0"><strong>${esc(context)}</strong><br>Respond within ${esc(result.responseWindow)}.</p>`,
    `<p style="margin:14px 0 4px;color:#6b7280;font-size:12px">What was reported (as written)</p>`,
    `<p style="margin:0;padding:2px 0 2px 10px;border-left:3px solid #d1d5db;white-space:pre-wrap">${esc(narrative)}</p>`,
    why.length
      ? `<p style="margin:14px 0 4px;color:#6b7280;font-size:12px">Why it scored Tier 1</p><ul style="margin:0;padding-left:18px">${why.map((w) => `<li>${esc(w)}</li>`).join('')}</ul>`
      : '',
    firstAction ? `<p style="margin:14px 0 0"><strong>First action:</strong> ${esc(firstAction)}</p>` : '',
    link
      ? `<p style="margin:18px 0 0"><a href="${esc(link)}" style="display:inline-block;padding:9px 16px;border-radius:999px;background:#111827;color:#fff;text-decoration:none;font-weight:600">Open the report</a></p>`
      : '',
    `<p style="margin:18px 0 0;padding-top:10px;border-top:1px solid #e5e7eb;color:#6b7280;font-size:12px">${esc(note)}</p>`,
    '</div>',
  ].join('');

  return {
    subject: `[PRAHARI] Tier 1 · ${site} · SIF potential ${result.score}/100`,
    text,
    html,
    whatsapp: [oneLine(clip(site, 60)), String(result.score), oneLine(clip(String(report.text ?? ''), 160)) || '-', link || '-'],
  };
}

/* ------------------------------------------------------------------ *
 * Sending
 * ------------------------------------------------------------------ */

async function post(url: string, headers: Record<string, string>, body: unknown): Promise<void> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...headers },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`${res.status} ${scrub(clip((await res.text().catch(() => '')).replace(/\s+/g, ' '), 160))}`.trim());
}

/** A provider's error text may quote who the message was for; the record must not. */
const scrub = (s: string): string => s.replace(/[^\s"'<>]+@[^\s"'<>]+/g, '[address]').replace(/\+?\d[\d\s-]{7,}\d/g, '[number]');

/** "PRAHARI Alerts <alerts@site.example>" or just the address. */
function parseFrom(from: string): { name: string; email: string } {
  const m = /^\s*(.*?)\s*<([^>]+)>\s*$/.exec(from);
  return m ? { name: m[1] || 'PRAHARI', email: m[2].trim() } : { name: 'PRAHARI', email: from.trim() };
}

function summarise(sent: number, failed: number, error: string | undefined): ChannelResult {
  const status: ChannelStatus = failed === 0 ? 'sent' : sent === 0 ? 'failed' : 'partial';
  return { status, sent, failed, ...(error ? { error } : {}) };
}

/** One message per person, so nobody sees who else was told. */
export async function sendEmails(to: string[], message: AlertMessage): Promise<ChannelResult> {
  if (!emailConfigured()) return { status: 'not-configured', sent: 0, failed: 0 };
  if (!to.length) return { status: 'no-recipients', sent: 0, failed: 0 };
  const provider = EMAIL_PROVIDER.value();
  const url = EMAIL_API_URL.value() || EMAIL_ENDPOINT[provider];
  const key = EMAIL_API_KEY.value();
  const from = EMAIL_FROM.value();

  const results = await Promise.allSettled(
    to.map((address) =>
      provider === 'brevo'
        ? post(url, { 'api-key': key }, { sender: parseFrom(from), to: [{ email: address }], subject: message.subject, textContent: message.text, htmlContent: message.html })
        : post(url, { Authorization: `Bearer ${key}` }, { from, to: [address], subject: message.subject, text: message.text, html: message.html }),
    ),
  );
  const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return summarise(results.length - refused.length, refused.length, refused[0] ? String((refused[0].reason as Error)?.message ?? refused[0].reason) : undefined);
}

/**
 * WhatsApp only lets a business start a conversation with an approved
 * template, so the alert is the template's four values:
 *   {{1}} site   {{2}} score   {{3}} what was reported   {{4}} link
 */
export async function sendWhatsApps(to: string[], message: AlertMessage): Promise<ChannelResult> {
  if (!whatsappConfigured()) return { status: 'not-configured', sent: 0, failed: 0 };
  if (!to.length) return { status: 'no-recipients', sent: 0, failed: 0 };
  const url = `${(WHATSAPP_API_URL.value() || WHATSAPP_DEFAULTS.api).replace(/\/+$/, '')}/${WHATSAPP_PHONE_NUMBER_ID.value()}/messages`;
  const headers = { Authorization: `Bearer ${WHATSAPP_TOKEN.value()}` };

  const results = await Promise.allSettled(
    to.map((number) =>
      post(url, headers, {
        messaging_product: 'whatsapp',
        to: number.replace(/\D/g, ''),
        type: 'template',
        template: {
          name: WHATSAPP_TEMPLATE.value() || WHATSAPP_DEFAULTS.template,
          language: { code: WHATSAPP_TEMPLATE_LANG.value() || WHATSAPP_DEFAULTS.lang },
          components: [{ type: 'body', parameters: message.whatsapp.map((value) => ({ type: 'text', text: value })) }],
        },
      }),
    ),
  );
  const refused = results.filter((r): r is PromiseRejectedResult => r.status === 'rejected');
  return summarise(results.length - refused.length, refused.length, refused[0] ? String((refused[0].reason as Error)?.message ?? refused[0].reason) : undefined);
}

/* ------------------------------------------------------------------ *
 * Who is told
 * ------------------------------------------------------------------ */

interface AlertPrefs {
  email?: boolean;
  whatsapp?: boolean;
  whatsappNumber?: string;
}

/** A person's channels: email unless they turned it off; WhatsApp once they gave a number. */
export function channelsFor(user: { email?: unknown; alerts?: AlertPrefs | null }): AlertRecipient {
  const prefs = user.alerts ?? {};
  const email = typeof user.email === 'string' && user.email.includes('@') && prefs.email !== false ? user.email : null;
  const number = typeof prefs.whatsappNumber === 'string' ? prefs.whatsappNumber.trim() : '';
  return { email, whatsapp: number && prefs.whatsapp !== false ? number : null };
}

async function recipientsFor(installationId: string): Promise<AlertRecipient[]> {
  const users = db.collection(COLLECTIONS.users);
  const [reviewers, managers] = await Promise.all([
    users.where('role', 'in', ['hse-officer', 'admin']).get(),
    installationId
      ? users.where('role', '==', 'installation-manager').where('installationId', '==', installationId).get()
      : Promise.resolve(null),
  ]);
  return [...reviewers.docs, ...(managers?.docs ?? [])].filter((d) => d.get('disabled') !== true).map((d) => channelsFor(d.data()));
}

/* ------------------------------------------------------------------ */

/**
 * Alerts for one Tier 1 report, once. Never throws: an alert that cannot be
 * sent must not undo the scoring it follows — it is recorded instead.
 */
export async function alertTier1(reportId: string, report: Record<string, unknown>, result: Assessment, firstAction: string | null): Promise<void> {
  if (result.tier !== 1) return;
  const ref = db.collection(COLLECTIONS.alerts).doc(reportId);
  try {
    // create() fails if the alert exists, which makes "once per report" hold
    // even when the trigger is retried or the report is re-scored.
    await ref.create({
      reportId,
      installationId: String(report.installationId ?? ''),
      installationName: String(report.installationName ?? ''),
      tier: 1,
      score: result.score,
      status: 'sending',
      createdAt: FieldValue.serverTimestamp(),
    });
  } catch {
    return;
  }

  try {
    const people = await recipientsFor(String(report.installationId ?? ''));
    const message = buildAlert(reportId, report, result, firstAction);
    const unique = (values: (string | null)[]) => [...new Set(values.filter((v): v is string => Boolean(v)))];
    const [email, whatsapp] = await Promise.all([
      sendEmails(unique(people.map((p) => p.email)), message),
      sendWhatsApps(unique(people.map((p) => p.whatsapp)), message),
    ]);
    await ref.update({ status: 'done', email, whatsapp, finishedAt: FieldValue.serverTimestamp() });
    logger.info('tier 1 alert', { reportId, email: email.status, whatsapp: whatsapp.status });
  } catch (err) {
    logger.error('tier 1 alert failed', { reportId, error: String(err) });
    await ref
      .update({ status: 'failed', error: clip(String((err as Error)?.message ?? err), 300), finishedAt: FieldValue.serverTimestamp() })
      .catch(() => undefined);
  }
}
