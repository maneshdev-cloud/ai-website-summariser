/**
 * POST /api/summarise
 *
 * Stage 2 of the pipeline: generate the structured summary for a cached
 * extraction.
 *
 * Body: { "id": "<extraction id>", "mode": "brief" | "standard" | "detailed" }
 *
 * The extraction is never re-fetched — changing the length mode only
 * re-runs generation, and a mode that was already generated is served
 * from cache (cached: true). The response reports which engine produced
 * the summary: "groq" for the LLM pipeline, or "demo-extractive" for the
 * keyless fallback (see lib/server/summarise.js).
 */
import { ApiError, requirePost, sendError } from '../lib/server/errors.js';
import { getExtraction, getSummary, putSummary } from '../lib/server/cache.js';
import { LENGTH_MODES, summariseExtraction, summaryStats } from '../lib/server/summarise.js';

export default async function handler(req, res) {
  try {
    requirePost(req);
    const { id, mode: rawMode } = req.body ?? {};
    const mode = LENGTH_MODES.includes(rawMode) ? rawMode : 'standard';

    if (typeof id !== 'string' || !id) {
      throw new ApiError(400, 'MISSING_ID', 'Provide the extraction "id" returned by /api/extract.');
    }
    const extraction = getExtraction(id);
    if (!extraction) {
      throw new ApiError(
        404,
        'EXTRACTION_NOT_FOUND',
        'That page is no longer in the server cache (entries expire after 30 minutes). Extract it again.',
      );
    }

    const cachedResult = getSummary(id, mode);
    if (cachedResult) {
      return res.status(200).json({ ...cachedResult, cached: true });
    }

    const result = await summariseExtraction(extraction, mode);
    const payload = {
      id,
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
    putSummary(id, mode, payload);
    return res.status(200).json({ ...payload, cached: false });
  } catch (err) {
    return sendError(res, err);
  }
}
