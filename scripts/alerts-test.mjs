#!/usr/bin/env node
/**
 * Tests for Tier 1 alerts (functions/src/lib/alerts.ts) — `npm run test:alerts`.
 *
 * The email and WhatsApp providers are replaced by a small HTTP server on this
 * machine, so the real sending code runs end to end and every request it makes
 * can be inspected. No account, key or network is needed, and nothing is sent
 * to anyone.
 */

import { createServer } from 'node:http';

process.env.GCLOUD_PROJECT ??= 'demo-prahari';

const { buildAlert, channelsFor, sendEmails, sendWhatsApps, emailConfigured, whatsappConfigured } = await import(
  '../functions/lib/lib/alerts.js'
);
const { analyse } = await import('../functions/lib/shared/engine.js');
const { alertSettingsSchema } = await import('../functions/lib/shared/schemas.js');

let pass = 0;
let fail = 0;
function check(label, ok, detail = '') {
  if (ok) pass++;
  else fail++;
  console.log(`  ${ok ? 'ok  ' : 'FAIL'} ${label}${!ok && detail ? `\n         ${detail}` : ''}`);
}

/* ---------- a stand-in for the providers ---------- */

const received = [];
/** Addresses and numbers the stand-in refuses, to exercise partial failure. */
const refuse = new Set();
const server = createServer((req, res) => {
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const json = JSON.parse(body || '{}');
    received.push({ url: req.url, headers: req.headers, body: json });
    const target = json.to?.[0]?.email ?? (Array.isArray(json.to) ? json.to[0] : json.to);
    if (refuse.has(target)) {
      res.writeHead(422, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: `Recipient ${target} is not allowed` }));
      return;
    }
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('{"id":"ok"}');
  });
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const base = `http://127.0.0.1:${server.address().port}`;

const ENV = [
  'ALERT_APP_URL',
  'ALERT_EMAIL_PROVIDER',
  'ALERT_EMAIL_API_KEY',
  'ALERT_EMAIL_FROM',
  'ALERT_EMAIL_API_URL',
  'WHATSAPP_TOKEN',
  'WHATSAPP_PHONE_NUMBER_ID',
  'WHATSAPP_TEMPLATE',
  'WHATSAPP_TEMPLATE_LANG',
  'WHATSAPP_API_URL',
];
function configure(values = {}) {
  for (const k of ENV) delete process.env[k];
  Object.assign(process.env, values);
  received.length = 0;
  refuse.clear();
}

/* ---------- the message ---------- */

console.log('\nThe message');
const text =
  'Night shift. A contract fitter was working at 3.5 metres height on a scaffold without a harness. <b>Guard-rail loose</b>.\nHe was standing directly above two men.';
const report = {
  text,
  installationName: 'Crude Distillation Unit 2',
  activityName: 'Work at height',
  type: 'unsafe-act',
  shift: 'Night',
  reportedBy: 'uid-of-the-reporter-12345',
};
const result = analyse(text);
check('the sample report is Tier 1', result.tier === 1, `tier ${result.tier}`);

configure({ ALERT_APP_URL: 'https://prahari.example/' });
const msg = buildAlert('rep123', report, result, 'Stop the activity and make the area safe.');
check('subject names the site and the score', msg.subject.includes('Crude Distillation Unit 2') && msg.subject.includes(`${result.score}/100`), msg.subject);
check('text carries the narrative as written', msg.text.includes('A contract fitter was working at 3.5 metres height'));
check('text gives the response window and the first action', msg.text.includes(`Respond within ${result.responseWindow}`) && msg.text.includes('First action: Stop the activity'));
check('text links to the report', msg.text.includes('https://prahari.example/app/reports/rep123'));
check('html escapes what the reporter typed', msg.html.includes('&lt;b&gt;Guard-rail loose&lt;/b&gt;') && !msg.html.includes('<b>Guard-rail'));
check('the reporter is not identified anywhere', ![msg.subject, msg.text, msg.html, ...msg.whatsapp].some((s) => s.includes('uid-of-the-reporter')));
check('it says the score is not a prediction', msg.text.includes('It is not a prediction'));
check('WhatsApp gets four single-line values', msg.whatsapp.length === 4 && msg.whatsapp.every((v) => v.length > 0 && !/[\n\t]| {2,}/.test(v)), JSON.stringify(msg.whatsapp));
check('WhatsApp values: site, score, link', msg.whatsapp[0] === 'Crude Distillation Unit 2' && msg.whatsapp[1] === String(result.score) && msg.whatsapp[3].endsWith('/app/reports/rep123'));

configure();
const noLink = buildAlert('rep123', report, result, null);
check('without ALERT_APP_URL there is no link, and no broken one', !noLink.text.includes('http') && noLink.whatsapp[3] === '-');

/* ---------- who is told, and how ---------- */

console.log('\nWho is told');
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
check('by default: email, no WhatsApp', eq(channelsFor({ email: 'a@site.example' }), { email: 'a@site.example', whatsapp: null }));
check('email can be switched off', eq(channelsFor({ email: 'a@site.example', alerts: { email: false } }), { email: null, whatsapp: null }));
check(
  'WhatsApp once a number is given',
  eq(channelsFor({ email: 'a@site.example', alerts: { email: true, whatsapp: true, whatsappNumber: '+919876543210' } }), { email: 'a@site.example', whatsapp: '+919876543210' }),
);
check('a number with WhatsApp switched off is not used', channelsFor({ email: '', alerts: { whatsapp: false, whatsappNumber: '+919876543210' } }).whatsapp === null);
check('phone-only accounts have no email channel', channelsFor({ email: '' }).email === null);

console.log('\nSettings validation');
const ok = alertSettingsSchema.safeParse({ email: true, whatsapp: true, whatsappNumber: '+91 98765-43210' });
check('a spaced number is accepted and normalised', ok.success && ok.data.whatsappNumber === '+919876543210', JSON.stringify(ok.error?.issues));
check('a number without country code is refused', !alertSettingsSchema.safeParse({ email: true, whatsapp: false, whatsappNumber: '9876543210' }).success);
check('WhatsApp on without a number is refused', !alertSettingsSchema.safeParse({ email: true, whatsapp: true, whatsappNumber: '' }).success);
check('everything off is allowed', alertSettingsSchema.safeParse({ email: false, whatsapp: false, whatsappNumber: '' }).success);

/* ---------- sending ---------- */

console.log('\nNot configured');
configure();
check('email reports "not configured"', !emailConfigured() && eq(await sendEmails(['a@site.example'], msg), { status: 'not-configured', sent: 0, failed: 0 }));
check('WhatsApp reports "not configured"', !whatsappConfigured() && eq(await sendWhatsApps(['+919876543210'], msg), { status: 'not-configured', sent: 0, failed: 0 }));
check('and nothing was sent anywhere', received.length === 0);
configure({ ALERT_EMAIL_PROVIDER: 'carrier-pigeon', ALERT_EMAIL_API_KEY: 'k', ALERT_EMAIL_FROM: 'a@b.example' });
check('an unknown email provider counts as not configured', !emailConfigured());

console.log('\nEmail through Resend');
configure({ ALERT_EMAIL_PROVIDER: 'resend', ALERT_EMAIL_API_KEY: 'test-key', ALERT_EMAIL_FROM: 'PRAHARI Alerts <alerts@site.example>', ALERT_EMAIL_API_URL: `${base}/emails` });
let r = await sendEmails(['officer@site.example', 'manager@site.example'], msg);
check('both accepted', eq(r, { status: 'sent', sent: 2, failed: 0 }), JSON.stringify(r));
check('one request per person, so nobody sees who else was told', received.length === 2 && received.every((q) => q.body.to.length === 1));
check('authorised with the key', received.every((q) => q.headers.authorization === 'Bearer test-key'));
check('carries from, subject, text and html', received.every((q) => q.body.from === 'PRAHARI Alerts <alerts@site.example>' && q.body.subject === msg.subject && q.body.text === msg.text && q.body.html === msg.html));

configure({ ALERT_EMAIL_PROVIDER: 'resend', ALERT_EMAIL_API_KEY: 'test-key', ALERT_EMAIL_FROM: 'alerts@site.example', ALERT_EMAIL_API_URL: `${base}/emails` });
refuse.add('manager@site.example');
r = await sendEmails(['officer@site.example', 'manager@site.example'], msg);
check('one refusal is reported as partial, with counts', r.status === 'partial' && r.sent === 1 && r.failed === 1, JSON.stringify(r));
check('the recorded error has the provider status but not the address', r.error?.startsWith('422') && !r.error.includes('manager@site.example'), r.error);
refuse.add('officer@site.example');
r = await sendEmails(['officer@site.example', 'manager@site.example'], msg);
check('all refused is reported as failed, never as sent', r.status === 'failed' && r.sent === 0 && r.failed === 2, JSON.stringify(r));
check('nobody to tell is reported as such', eq(await sendEmails([], msg), { status: 'no-recipients', sent: 0, failed: 0 }));

console.log('\nEmail through Brevo');
configure({ ALERT_EMAIL_PROVIDER: 'brevo', ALERT_EMAIL_API_KEY: 'brevo-key', ALERT_EMAIL_FROM: 'PRAHARI Alerts <alerts@site.example>', ALERT_EMAIL_API_URL: `${base}/v3/smtp/email` });
r = await sendEmails(['officer@site.example'], msg);
check('accepted', r.status === 'sent' && r.sent === 1, JSON.stringify(r));
check('uses Brevo’s header and shape', received[0]?.headers['api-key'] === 'brevo-key' && eq(received[0].body.sender, { name: 'PRAHARI Alerts', email: 'alerts@site.example' }) && eq(received[0].body.to, [{ email: 'officer@site.example' }]) && received[0].body.htmlContent === msg.html);

console.log('\nWhatsApp');
configure({ WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_API_URL: base });
r = await sendWhatsApps(['+91 98765 43210'], msg);
check('accepted', eq(r, { status: 'sent', sent: 1, failed: 0 }), JSON.stringify(r));
const wa = received[0];
check('posted to the sending number’s messages endpoint with the token', wa?.url === '/1234567890/messages' && wa.headers.authorization === 'Bearer wa-token');
check('recipient as digits only', wa?.body.to === '919876543210' && wa.body.messaging_product === 'whatsapp');
check('uses the default approved template in English', wa?.body.type === 'template' && wa.body.template.name === 'prahari_tier1_alert' && wa.body.template.language.code === 'en');
check('the template’s four values are filled in order', eq(wa?.body.template.components[0].parameters.map((p) => p.text), msg.whatsapp));
configure({ WHATSAPP_TOKEN: 'wa-token', WHATSAPP_PHONE_NUMBER_ID: '1234567890', WHATSAPP_API_URL: base, WHATSAPP_TEMPLATE: 'site_alert_hi', WHATSAPP_TEMPLATE_LANG: 'hi' });
refuse.add('919876543210');
r = await sendWhatsApps(['+919876543210'], msg);
check('a refusal is reported as failed, with the number kept out of the record', r.status === 'failed' && r.failed === 1 && !r.error.includes('919876543210'), JSON.stringify(r));
check('a configured template name and language are used', received[0]?.body.template.name === 'site_alert_hi' && received[0].body.template.language.code === 'hi');

server.close();
console.log(`\n${pass} passed, ${fail} failed\n`);
process.exit(fail ? 1 : 0);
