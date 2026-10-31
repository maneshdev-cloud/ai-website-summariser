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
 * shared store, which is fine for this app's scale.
 */
import { createHash } from 'node:crypto';

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
