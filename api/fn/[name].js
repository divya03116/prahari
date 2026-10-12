/**
 * Vercel function: POST /api/fn/<name>.
 *
 * The free way to run PRAHARI's server: the same service layer that deploys to
 * Firebase Cloud Functions, called through one small adapter
 * (functions/src/vercel.ts, compiled to functions/lib during install).
 * It needs FIREBASE_SERVICE_ACCOUNT in the Vercel project's settings.
 */
import { callFunction } from '../../functions/lib/vercel.js';

export default async function handler(req, res) {
  let body;
  try {
    body = req.body; // Vercel parses JSON on first access and throws if it is malformed
  } catch {
    body = undefined;
  }
  const reply = await callFunction(String(req.query.name ?? ''), { method: req.method, headers: req.headers, body });
  res.setHeader('Cache-Control', 'no-store');
  res.status(reply.status).json(reply.body);
}
