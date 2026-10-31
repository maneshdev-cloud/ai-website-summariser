// POST /api/summarise — { id, mode, text, title }.
//
// The extraction is worked out by resolveExtraction (cache.js): cache
// hit if this instance has it, otherwise rebuilt from the text the
// client sends back. Changing the length mode only re-runs generation,
// and a mode already done comes from cache. The response says which
// engine produced the summary: "groq", or "demo-extractive" (keyless
// fallback).
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
    // Use the resolved id from here — a rebuilt extraction is keyed by
    // text hash, which can differ from the id that was requested.
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
