// POST /api/extract — { url } or { text, title } in, extraction out.
//
// The response includes the full clean text on purpose: the client sends
// it back with the summarise/ask calls, because the server cache may not
// survive between serverless instances. Repeat requests for the same
// URL/text are cache hits (cached: true) and skip the fetch.
import { ApiError, requirePost, sendError } from '../lib/server/errors.js';
import { fetchPublicHtml } from '../lib/server/fetchPage.js';
import { extractFromHtml, extractionFromText, publicExtraction } from '../lib/server/extract.js';
import { getExtraction, idForText, idForUrl, putExtraction } from '../lib/server/cache.js';
import { splitIntoChunks } from '../lib/server/chunk.js';

export default async function handler(req, res) {
  try {
    requirePost(req);
    const body = req.body ?? {};
    let extraction;
    let cached;

    if (typeof body.url === 'string' && body.url.trim()) {
      const knownId = idForUrl(body.url.trim());
      const existing = getExtraction(knownId);
      if (existing) {
        extraction = existing;
        cached = true;
      } else {
        const { html, finalUrl } = await fetchPublicHtml(body.url);
        extraction = extractFromHtml(html, finalUrl);
        cached = putExtraction(extraction);
      }
    } else if (typeof body.text === 'string' && body.text.trim()) {
      const knownId = idForText(body.text);
      const existing = getExtraction(knownId);
      if (existing) {
        extraction = existing;
        cached = true;
      } else {
        extraction = extractionFromText(body.text, body.title);
        cached = putExtraction(extraction);
      }
    } else {
      throw new ApiError(400, 'MISSING_INPUT', 'Provide either a "url" or pasted "text".');
    }

    const { chunks, totalChunks, truncated } = splitIntoChunks(extraction.text);
    return res.status(200).json({
      ...publicExtraction(extraction, cached),
      text: extraction.text, // client keeps this, see header note
      chunkCount: chunks.length,
      totalChunks,
      truncated,
    });
  } catch (err) {
    return sendError(res, err);
  }
}
