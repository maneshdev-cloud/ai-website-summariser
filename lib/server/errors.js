/**
 * Shared error type for the API layer.
 *
 * Every failure the client can act on is an ApiError with a stable `code`
 * (e.g. "PAYWALL_SUSPECTED") and an HTTP status. Handlers throw these from
 * deep inside the pipeline (fetch, extraction, AI) and the route handler
 * converts them into a JSON body of the shape:
 *
 *   { "error": { "code": "...", "message": "..." } }
 *
 * The UI switches on `code` to show the right recovery hint (for example,
 * offering paste-text mode when a page turns out to be paywalled).
 */
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

/** Convert any thrown value into the JSON error response. */
export function sendError(res, err) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  // Unexpected failure: log the real thing server-side, stay vague client-side.
  console.error('[api] unexpected error:', err);
  return res
    .status(500)
    .json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
}

/** Reject non-POST requests to the JSON endpoints. */
export function requirePost(req) {
  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This endpoint expects a POST request.');
  }
}
