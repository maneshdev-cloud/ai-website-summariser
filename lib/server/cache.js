/**
 * In-memory cache for extractions and summaries.
 *
 * Summarising a page costs an HTTP fetch plus one or more LLM calls, so a
 * repeat request for the same URL (or the same pasted text) should be
 * instant and free. Entries are keyed by a SHA-256 hash of the normalised
 * URL / trimmed text, and each entry stores:
 *
 *   - the extraction (clean text + metadata), so /api/summarise and
 *     /api/ask can work from it without re-fetching, and
 *   - summaries already generated, per length mode, so switching modes
 *     back and forth doesn't re-run the model.
 *
 * Entries expire after a TTL so a long-lived server doesn't serve stale
 * pages forever or grow without bound. Note: on serverless platforms this
 * cache lives per warm instance — it is a best-effort optimisation, not a
 * shared store. The request flow is therefore stateless by design:
 * /api/extract returns the full clean text to the client, and the client
 * sends that text back with /api/summarise and /api/ask requests, so a
 * cold instance can rebuild the extraction on demand (see
 * resolveExtraction) instead of failing with EXTRACTION_NOT_FOUND.
 */
import { createHash } from 'node:crypto';
import { extractionFromText } from './extract.js';

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map(); // id -> { extraction, summaries: Map<mode, result>, storedAt }

function hash(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

/** Stable cache id for a URL: lowercased host, no fragment. */
export function idForUrl(rawUrl) {
  try {
    const url = new URL(rawUrl);
    url.hash = '';
    url.hostname = url.hostname.toLowerCase();
    return hash(`url:${url.toString()}`);
  } catch {
    return hash(`url:${rawUrl}`);
  }
}

/** Stable cache id for pasted text. */
export function idForText(text) {
  return hash(`text:${(text || '').trim()}`);
}

function liveEntry(id) {
  const entry = store.get(id);
  if (!entry) return null;
  if (Date.now() - entry.storedAt > TTL_MS) {
    store.delete(id);
    return null;
  }
  return entry;
}

/**
 * Store an extraction. Returns true if an identical entry was already
 * cached (i.e. this request was a cache hit and the work was skipped).
 */
export function putExtraction(extraction) {
  const existing = liveEntry(extraction.id);
  if (existing) return true;
  store.set(extraction.id, {
    extraction,
    summaries: new Map(),
    storedAt: Date.now(),
  });
  return false;
}

/** Fetch a cached extraction by id, or null if unknown/expired. */
export function getExtraction(id) {
  const entry = liveEntry(id);
  return entry ? entry.extraction : null;
}

/**
 * Resolve the extraction a summarise/ask request refers to, statelessly.
 *
 * 1. If `id` names a warm cache entry, that entry wins — the cache is
 *    the fast path and carries the full URL-mode metadata.
 * 2. Otherwise, if the client sent the page `text` back (the client
 *    always holds it, because /api/extract returned it), rebuild the
 *    extraction from that text, warm the cache with it, and return it.
 *    The rebuilt extraction's id is the text hash, which may differ from
 *    the requested id for URL-mode pages — callers should key off the
 *    returned extraction's id from this point on.
 * 3. Otherwise return null; the caller reports EXTRACTION_NOT_FOUND.
 *
 * A rebuild can throw the same errors as extractionFromText (e.g.
 * TEXT_TOO_SHORT) if the supplied text is unusable.
 *
 * @param {string} [id] extraction id from /api/extract
 * @param {string} [text] full clean text, as returned by /api/extract
 * @param {string} [title] page title, used when rebuilding
 * @returns the extraction, or null if it cannot be resolved
 */
export function resolveExtraction(id, text, title) {
  if (typeof id === 'string' && id) {
    const cached = getExtraction(id);
    if (cached) return cached;
  }
  if (typeof text === 'string' && text.trim()) {
    const rebuilt = extractionFromText(text, title);
    putExtraction(rebuilt);
    return rebuilt;
  }
  return null;
}

/** Store a generated summary for (extraction id, length mode). */
export function putSummary(id, mode, result) {
  const entry = liveEntry(id);
  if (entry) entry.summaries.set(mode, result);
}

/** Fetch a previously generated summary, or null. */
export function getSummary(id, mode) {
  const entry = liveEntry(id);
  return entry ? (entry.summaries.get(mode) ?? null) : null;
}

/** Test/debug helper: wipe the cache. */
export function clearCache() {
  store.clear();
}
