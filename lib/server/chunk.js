/**
 * Paragraph-aware text chunking for the summarisation pipeline.
 *
 * LLMs have finite context windows, and simply truncating a long article
 * loses its ending (where conclusions usually live). Instead we split the
 * extracted text into chunks that each fit comfortably in a prompt:
 *
 *  - Splitting happens on paragraph boundaries first, so a chunk never
 *    starts mid-argument. Paragraphs that are individually too long are
 *    split on sentence boundaries, then (last resort) hard-sliced.
 *  - Consecutive chunks overlap by ~10%: the tail of chunk N is prepended
 *    to chunk N+1, so a topic straddling a boundary keeps its context in
 *    both — the standard fix for boundary information loss.
 *  - The chunk count is capped (MAX_CHUNKS). A pathological 200,000-word
 *    page cannot turn into hundreds of API calls; instead we summarise the
 *    first MAX_CHUNKS chunks and report `truncated: true` honestly.
 */

export const MAX_CHUNK_CHARS = 3500;
export const OVERLAP_RATIO = 0.1;
export const MAX_CHUNKS = 12;

const SENTENCE_RE = /[^.!?]+[.!?]+["')\]]*\s*/g;

function splitLongParagraph(paragraph, maxChars) {
  const sentences = paragraph.match(SENTENCE_RE) || [paragraph];
  const pieces = [];
  let current = '';
  for (const sentence of sentences) {
    if (sentence.length > maxChars) {
      if (current) pieces.push(current.trim());
      current = '';
      for (let i = 0; i < sentence.length; i += maxChars) {
        pieces.push(sentence.slice(i, i + maxChars).trim());
      }
    } else if ((current + sentence).length <= maxChars) {
      current += sentence;
    } else {
      pieces.push(current.trim());
      current = sentence;
    }
  }
  if (current.trim()) pieces.push(current.trim());
  return pieces.filter(Boolean);
}

/** The last `count` characters of `text`, nudged forward to a word boundary. */
function tailOf(text, count) {
  if (text.length <= count) return text;
  const slice = text.slice(-count);
  const firstSpace = slice.indexOf(' ');
  return firstSpace > 0 ? slice.slice(firstSpace + 1) : slice;
}

/**
 * Split `text` into chunks.
 *
 * @param {string} text clean extracted text (paragraphs separated by \n\n)
 * @param {{maxChars?: number, overlapRatio?: number, maxChunks?: number}} [options]
 * @returns {{chunks: string[], totalChunks: number, truncated: boolean}}
 *   `totalChunks` counts all chunks before capping; `chunks` holds at most
 *   `maxChunks` entries.
 */
export function splitIntoChunks(text, options = {}) {
  const maxChars = options.maxChars ?? MAX_CHUNK_CHARS;
  const overlapRatio = options.overlapRatio ?? OVERLAP_RATIO;
  const maxChunks = options.maxChunks ?? MAX_CHUNKS;

  const clean = (text || '').replace(/\r\n/g, '\n').trim();
  if (!clean) return { chunks: [], totalChunks: 0, truncated: false };

  // 1. Break the text into segments that each fit within maxChars.
  const segments = [];
  for (const paragraph of clean.split(/\n\s*\n/)) {
    const p = paragraph.trim();
    if (!p) continue;
    if (p.length <= maxChars) segments.push(p);
    else segments.push(...splitLongParagraph(p, maxChars));
  }

  // 2. Pack segments into chunks without splitting a segment.
  const rawChunks = [];
  let current = '';
  for (const segment of segments) {
    if (!current) current = segment;
    else if (current.length + 2 + segment.length <= maxChars) current += '\n\n' + segment;
    else {
      rawChunks.push(current);
      current = segment;
    }
  }
  if (current) rawChunks.push(current);

  // 3. Prepend the tail of the previous chunk as overlap context.
  const overlapChars = Math.floor(maxChars * overlapRatio);
  const chunks = rawChunks.map((chunk, i) =>
    i === 0 ? chunk : `${tailOf(rawChunks[i - 1], overlapChars)}\n\n${chunk}`,
  );

  return {
    chunks: chunks.slice(0, maxChunks),
    totalChunks: chunks.length,
    truncated: chunks.length > maxChunks,
  };
}

/** Count words in a block of text. */
export function countWords(text) {
  const matches = (text || '').trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

/** Rough reading time in minutes at 200 words per minute (minimum 1). */
export function readingTimeMinutes(words) {
  return Math.max(1, Math.round(words / 200));
}
