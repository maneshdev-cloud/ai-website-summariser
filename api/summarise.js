/**
 * POST /api/summarise
 *
 * Stage 2 of the pipeline: generate the structured summary for an
 * extraction.
 *
 * Body: { "id": "<extraction id>", "mode": "brief" | "standard" | "detailed",
 *         "text": "<full clean text from /api/extract>", "title": "optional" }
 *
 * The extraction is resolved statelessly (see resolveExtraction in
 * lib/server/cache.js): a warm per-instance cache entry wins, otherwise
 * the extraction is rebuilt from the `text` the client sends back. Only
 * a cold id with no text is EXTRACTION_NOT_FOUND. The extraction is
 * never re-fetched — changing the length mode only re-runs generation,
 * and a mode that was already generated is served from cache
 * (cached: true). The response reports which engine produced the
 * summary: "groq" for the LLM pipeline, or "demo-extractive" for the
 * keyless fallback (see lib/server/summarise.js).
 */
import { ApiError, requirePost, sendError } from '../lib/server/errors.js';
import { getSummary, putSummary, resolveExtraction } from '../lib/server/cache.js';
import { LENGTH_MODES, summariseExtraction, summaryStats } from '../lib/server/summarise.js';

export default async function handler(req, res) {
  try {
    requirePost(req);
    const { id, mode: rawMode, text, title } = req.body ?? {};
    const mode = LENGTH_MODES.includes(rawMode) ? rawMode : 'standard';

    if (typeof id !== 'string' || !id) {
      throw new ApiError(400, 'MISSING_ID', 'Provide the extraction "id" returned by /api/extract.');
    }
    const extraction = resolveExtraction(id, text, title);
    if (!extraction) {
      throw new ApiError(
        404,
        'EXTRACTION_NOT_FOUND',
        'That extraction is not available on this server instance and no page text was sent with the request. Extract the page again.',
      );
    }
    // Key summaries (and report the id) by the resolved extraction: a
    // rebuilt extraction's id is its text hash, which can differ from
    // the requested id for URL-mode pages.
    const extractionId = extraction.id;

    const cachedResult = getSummary(extractionId, mode);
    if (cachedResult) {
      return res.status(200).json({ ...cachedResult, cached: true });
    }

    const result = await summariseExtraction(extraction, mode);
    const payload = {
      id: extractionId,
      mode,
      engine: result.engine,
      models: result.models,
      ...(result.fallbackNote ? { fallbackNote: result.fallbackNote } : {}),
      summary: result.summary,
      chunkCount: result.chunkCount,
      totalChunks: result.totalChunks,
      truncated: result.truncated,
      mapReduce: result.mapReduce,
      stats: summaryStats(extraction, result.summary),
    };
    putSummary(extractionId, mode, payload);
    return res.status(200).json({ ...payload, cached: false });
  } catch (err) {
    return sendError(res, err);
  }
}
