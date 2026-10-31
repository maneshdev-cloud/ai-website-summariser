/**
 * Extraction tests against a saved HTML fixture (no network).
 * The fixture is a realistic article page wrapped in navigation, a cookie
 * banner, an ad slot and a footer — the junk must not survive extraction.
 */
import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractFromHtml, extractionFromText } from '../lib/server/extract.js';

const fixture = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'fixtures', 'article.html'),
  'utf8',
);
const FIXTURE_URL = 'https://example.com/news/bicycle-history';

describe('extractFromHtml', () => {
  it('extracts the article with its metadata', () => {
    const ex = extractFromHtml(fixture, FIXTURE_URL);
    assert.ok(ex.title.includes('Long History of the Bicycle'), `title was: ${ex.title}`);
    assert.equal(ex.siteName, 'Example Gazette');
    assert.equal(ex.heroImage, 'https://example.com/images/bicycle.jpg');
    assert.equal(ex.source, 'url');
    assert.ok(ex.wordCount > 500, `wordCount was ${ex.wordCount}`);
    assert.ok(ex.readingTimeMinutes >= 2);
  });

  it('keeps the article body and strips the boilerplate', () => {
    const ex = extractFromHtml(fixture, FIXTURE_URL);
    assert.ok(ex.text.includes('safety bicycle arrived in 1885'));
    for (const junk of ['NAVJUNK', 'COOKIEJUNK', 'ADJUNK', 'FOOTERJUNK']) {
      assert.ok(!ex.text.includes(junk), `extraction leaked ${junk}`);
    }
    assert.ok(ex.stats.cleanBytes < ex.stats.rawBytes);
    assert.ok(ex.stats.noiseRemovedPct > 0);
  });

  it('refuses to summarise a paywall teaser', () => {
    const paywalled = `<!doctype html><html><head><title>Secret Article</title></head>
      <body><article><h1>Secret Article</h1>
      <p>Subscribe to continue reading this exclusive story. Sign in to continue.
      This preview paragraph is all anyone without an account will ever see here today.</p>
      </article></body></html>`;
    assert.throws(
      () => extractFromHtml(paywalled, 'https://example.com/secret'),
      (err) => {
        assert.equal(err.code, 'PAYWALL_SUSPECTED');
        return true;
      },
    );
  });

  it('rejects pages with almost no readable text', () => {
    const thin = '<!doctype html><html><head><title>x</title></head><body><p>Hi.</p></body></html>';
    assert.throws(
      () => extractFromHtml(thin, 'https://example.com/thin'),
      (err) => {
        assert.ok(['THIN_CONTENT', 'EXTRACTION_FAILED'].includes(err.code), `code was ${err.code}`);
        return true;
      },
    );
  });
});

describe('extractionFromText', () => {
  it('builds an extraction from pasted text', () => {
    const text = Array.from({ length: 6 }, (_, i) => `Paragraph ${i + 1}. ` + 'Some meaningful sentence about cycling history and design. '.repeat(6)).join('\n\n');
    const ex = extractionFromText(text, 'My Pasted Article');
    assert.equal(ex.source, 'text');
    assert.equal(ex.title, 'My Pasted Article');
    assert.equal(ex.stats.noiseRemovedPct, 0);
    assert.ok(ex.wordCount > 50);
  });

  it('rejects very short pasted text', () => {
    assert.throws(
      () => extractionFromText('too short'),
      (err) => {
        assert.equal(err.code, 'TEXT_TOO_SHORT');
        return true;
      },
    );
  });
});
