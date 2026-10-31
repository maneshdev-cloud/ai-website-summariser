// GET /api/health — the UI checks groqConfigured to show a demo-mode
// badge when the server has no API key. Only says whether a key exists,
// never the key itself.
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
