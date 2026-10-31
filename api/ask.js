/**
 * POST /api/ask
 *
 * "Ask this page": grounded Q&A over an extraction.
 *
 * Body: { "id": "<extraction id>", "question": "…",
 *         "text": "<full clean text from /api/extract>", "title": "optional" }
 *
 * The extraction is resolved statelessly (see resolveExtraction in
 * lib/server/cache.js): a warm per-instance cache entry wins, otherwise
 * the extraction is rebuilt from the `text` the client sends back. Only
 * a cold id with no text is EXTRACTION_NOT_FOUND.
 *
 * The answer uses ONLY the extracted page text. When the page doesn't
 * contain the answer, the response says so (covered: false) rather than
 * guessing — see lib/server/ask.js for the grounding contract.
 */
import { ApiError, requirePost, sendError } from '../lib/server/errors.js';
import { resolveExtraction } from '../lib/server/cache.js';
import { answerQuestion } from '../lib/server/ask.js';

export default async function handler(req, res) {
  try {
    requirePost(req);
    const { id, question, text, title } = req.body ?? {};

    if (typeof id !== 'string' || !id) {
      throw new ApiError(400, 'MISSING_ID', 'Provide the extraction "id" returned by /api/extract.');
    }
    if (typeof question !== 'string' || question.trim().length < 3) {
      throw new ApiError(400, 'INVALID_QUESTION', 'Please ask a question of at least a few characters.');
    }
    if (question.length > 500) {
      throw new ApiError(400, 'INVALID_QUESTION', 'Questions are limited to 500 characters.');
    }
    const extraction = resolveExtraction(id, text, title);
    if (!extraction) {
      throw new ApiError(
        404,
        'EXTRACTION_NOT_FOUND',
        'That extraction is not available on this server instance and no page text was sent with the request. Extract the page again.',
      );
    }

    const { covered, answer, engine } = await answerQuestion(extraction, question.trim());
    return res.status(200).json({ id: extraction.id, question: question.trim(), covered, answer, engine });
  } catch (err) {
    return sendError(res, err);
  }
}
