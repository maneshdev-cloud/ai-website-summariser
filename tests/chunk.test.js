/**
 * Chunking tests: boundaries, overlap, size limits, and the chunk cap.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { splitIntoChunks, MAX_CHUNKS } from '../lib/server/chunk.js';

const paragraph = (words, tail = '') =>
  `${'lorem ipsum dolor sit amet consectetur adipiscing elit '.repeat(Math.ceil(words / 8)).slice(0, words * 6)} ${tail}`.trim();

describe('splitIntoChunks', () => {
  it('returns no chunks for empty text', () => {
    const { chunks, totalChunks, truncated } = splitIntoChunks('   ');
    assert.deepEqual(chunks, []);
    assert.equal(totalChunks, 0);
    assert.equal(truncated, false);
  });

  it('keeps short text in a single chunk', () => {
    const text = 'One short paragraph.\n\nAnd a second one.';
    const { chunks, totalChunks } = splitIntoChunks(text);
    assert.equal(totalChunks, 1);
    assert.ok(chunks[0].includes('second one'));
  });

  it('splits on paragraph boundaries and respects the size limit', () => {
    const p1 = paragraph(320, 'ENDOFONE.');
    const p2 = paragraph(320, 'ENDOFTWO.');
    const p3 = paragraph(320, 'ENDOFTHREE.');
    const { chunks, totalChunks } = splitIntoChunks([p1, p2, p3].join('\n\n'), {
      maxChars: 3500,
    });
    assert.ok(totalChunks >= 2, `expected multiple chunks, got ${totalChunks}`);
    for (const chunk of chunks) {
      // Chunk body <= maxChars, plus up to 10% overlap prepended.
      assert.ok(chunk.length <= 3500 * 1.1 + 10, `chunk too long: ${chunk.length}`);
    }
    // No paragraph was lost at a boundary.
    const joined = chunks.join('\n');
    for (const marker of ['ENDOFONE.', 'ENDOFTWO.', 'ENDOFTHREE.']) {
      assert.ok(joined.includes(marker), `missing ${marker}`);
    }
  });

  it('prepends the tail of the previous chunk as overlap', () => {
    const p1 = `${'alpha '.repeat(320)} FINALMARKERONE.`;
    const p2 = `${'beta '.repeat(320)} FINALMARKERTWO.`;
    const { chunks, totalChunks } = splitIntoChunks([p1, p2].join('\n\n'), { maxChars: 3500 });
    assert.equal(totalChunks, 2);
    assert.ok(
      chunks[1].includes('FINALMARKERONE.'),
      'second chunk should carry the tail of the first as overlap context',
    );
  });

  it('splits a single oversized paragraph instead of dropping it', () => {
    const huge = `${'Sentence number one is here. '.repeat(400)}`;
    const { chunks, totalChunks } = splitIntoChunks(huge, { maxChars: 3500 });
    assert.ok(totalChunks > 1);
    assert.ok(chunks.every((c) => c.length <= 3500 * 1.1 + 10));
  });

  it('caps the chunk count and reports truncation honestly', () => {
    const manyParagraphs = Array.from({ length: 40 }, (_, i) =>
      paragraph(500, `PARA${i}END.`),
    ).join('\n\n');
    const { chunks, totalChunks, truncated } = splitIntoChunks(manyParagraphs);
    assert.ok(totalChunks > MAX_CHUNKS);
    assert.equal(chunks.length, MAX_CHUNKS);
    assert.equal(truncated, true);
  });
});
