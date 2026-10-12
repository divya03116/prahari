/**
 * Vercel function: GET /api/health — {"ok": true} once FIREBASE_SERVICE_ACCOUNT
 * is set and Google accepts it; otherwise what is missing, in plain words.
 */
import { health } from '../functions/lib/vercel.js';

export default async function handler(_req, res) {
  const reply = await health();
  res.setHeader('Cache-Control', 'no-store');
  res.status(reply.status).json(reply.body);
}
