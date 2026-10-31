// One error type for the whole API. Anything the client should react to
// is an ApiError with a stable code (like "PAYWALL_SUSPECTED"); handlers
// throw them from anywhere and the route turns them into
// { error: { code, message } }. The UI switches on the code — paywall
// errors offer paste-text mode, for example.
export class ApiError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export function sendError(res, err) {
  if (err instanceof ApiError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message } });
  }
  // Something unexpected: log the real thing here, stay vague to the client.
  console.error('[api] unexpected error:', err);
  return res
    .status(500)
    .json({ error: { code: 'INTERNAL', message: 'Something went wrong on the server.' } });
}

export function requirePost(req) {
  if (req.method !== 'POST') {
    throw new ApiError(405, 'METHOD_NOT_ALLOWED', 'This endpoint expects a POST request.');
  }
}
