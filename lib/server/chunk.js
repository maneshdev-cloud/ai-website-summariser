// Splits page text into prompt-sized chunks.
//
// Splits on paragraph boundaries where it can (then sentences, then hard
// cuts) so chunks don't start mid-argument, and overlaps neighbours by
// ~10% so a topic split across a boundary keeps its context in both.
// The count is capped: a huge page gets truncated: true instead of
// turning into hundreds of API calls.

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

function tailOf(text, count) {
  if (text.length <= count) return text;
  const slice = text.slice(-count);
  const firstSpace = slice.indexOf(' ');
  return firstSpace > 0 ? slice.slice(firstSpace + 1) : slice;
}

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

export function countWords(text) {
  const matches = (text || '').trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function readingTimeMinutes(words) {
  return Math.max(1, Math.round(words / 200));
}
