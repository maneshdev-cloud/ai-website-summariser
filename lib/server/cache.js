// Small in-memory cache for extractions and summaries.
//
// Fetching + summarising a page is the expensive part, so repeats within
// 30 min are served from here. On serverless this only lives as long as
// the instance does, so it's best-effort: the client keeps the extracted
// text and sends it back with later requests, and resolveExtraction
// rebuilds from that on a cache miss.
import { createHash } from 'node:crypto';
import { extractionFromText } from './extract.js';

const TTL_MS = 30 * 60 * 1000; // 30 minutes
const store = new Map(); // id -> { extraction, summaries: Map<mode, result>, storedAt }

function hash(input) {
  return createHash('sha256').update(input).digest('hex').slice(0, 24);
}

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

// Returns true when this was already cached (so the caller knows the
// fetch work was skipped).
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

export function getExtraction(id) {
  const entry = liveEntry(id);
  return entry ? entry.extraction : null;
}

// Works out which extraction a summarise/ask request means.
// Warm cache entry wins. Otherwise rebuild from the text the client sent
// back and cache that. Null when there's nothing to work with.
// Careful: a rebuilt extraction is keyed by its text hash, which can
// differ from the requested id — use the returned extraction's id.
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

export function putSummary(id, mode, result) {
  const entry = liveEntry(id);
  if (entry) entry.summaries.set(mode, result);
}

export function getSummary(id, mode) {
  const entry = liveEntry(id);
  return entry ? (entry.summaries.get(mode) ?? null) : null;
}

// for tests
export function clearCache() {
  store.clear();
}
