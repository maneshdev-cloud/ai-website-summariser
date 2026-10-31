/**
 * Cache + stateless-resolution tests (no network).
 *
 * The production bug these lock in: on serverless platforms each API
 * route runs in its own function instance with its own in-memory cache,
 * so an id created by /api/extract may be unknown to the instance that
 * handles /api/summarise. resolveExtraction must rebuild the extraction
 * from the client-supplied text instead of giving up — and must still
 * fail cleanly when there is no text to rebuild from.
 */
import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  clearCache,
  getExtraction,
  idForText,
  putExtraction,
  resolveExtraction,
} from '../lib/server/cache.js';
import { extractionFromText } from '../lib/server/extract.js';

// Already in normalised form (single spaces, \n\n between paragraphs),
// so idForText(TEXT) is exactly the id extractionFromText derives.
const PARAGRAPHS = Array.from(
  { length: 6 },
  (_, i) =>
    `Paragraph ${i + 1} of the article. ` +
    'Cycling history is full of interesting machines and the people who rode them. '.repeat(4),
);
const TEXT = PARAGRAPHS.join('\n\n');
const UNKNOWN_ID = 'f'.repeat(24);

describe('resolveExtraction', () => {
  beforeEach(() => clearCache());

  it('rebuilds from client-supplied text when the id is cold', () => {
    const ex = resolveExtraction(UNKNOWN_ID, TEXT, 'The Stored Title');
    assert.ok(ex, 'expected an extraction');
    // The rebuilt extraction is keyed by the text hash, not the
    // (meaningless on this instance) requested id.
    assert.equal(ex.id, idForText(TEXT));
    assert.equal(ex.title, 'The Stored Title');
    assert.ok(ex.text.includes('Cycling history'));
    // …and the rebuild warms the cache under its own id.
    assert.equal(getExtraction(ex.id), ex);
  });

  it('returns null when the id is cold and no text is provided', () => {
    assert.equal(resolveExtraction(UNKNOWN_ID), null);
    assert.equal(resolveExtraction(UNKNOWN_ID, ''), null);
    assert.equal(resolveExtraction(UNKNOWN_ID, '   '), null);
    assert.equal(resolveExtraction(undefined, undefined), null);
  });

  it('prefers the warm cache entry over rebuilding from text', () => {
    const original = extractionFromText(TEXT, 'Original Title');
    putExtraction(original);
    const otherText = Array.from(
      { length: 4 },
      (_, i) => `Different paragraph ${i + 1}. ` + 'Entirely other content about trains. '.repeat(4),
    ).join('\n\n');
    const resolved = resolveExtraction(original.id, otherText, 'Other Title');
    assert.equal(resolved, original);
  });
});
