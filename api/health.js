/**
 * GET /api/health
 *
 * Tiny status endpoint. The UI uses `groqConfigured` to show a "demo mode"
 * badge when the server has no GROQ_API_KEY, so nobody mistakes the
 * extractive fallback for the full AI pipeline. The key itself is, of
 * course, never exposed — only whether one exists.
 */
import { hasGroqKey, MODELS } from '../lib/server/groq.js';

export default function handler(req, res) {
  if (req.method !== 'GET') {
    return res
      .status(405)
      .json({ error: { code: 'METHOD_NOT_ALLOWED', message: 'Use GET for this endpoint.' } });
  }
  return res.status(200).json({
    ok: true,
    groqConfigured: hasGroqKey(),
    engine: hasGroqKey() ? 'groq' : 'demo-extractive',
    models: hasGroqKey() ? MODELS : null,
  });
}
