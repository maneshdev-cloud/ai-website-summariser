// Raw HTML in, clean article text + metadata out.
//
// Most of a page is nav, cookie banners, ads and footers — that junk
// would eat the model's context and drag the summary down, so this uses
// Mozilla Readability (the thing behind Firefox Reader View) to pull out
// just the article. If what's left looks like a paywall or login wall
// instead of an article, it throws rather than summarising a sign-in form.
import { JSDOM } from 'jsdom';
import { Readability } from '@mozilla/readability';
import { ApiError } from './errors.js';
import { countWords, readingTimeMinutes } from './chunk.js';
import { idForText, idForUrl } from './cache.js';

// Below this many characters, what we got is not an article.
const MIN_ARTICLE_CHARS = 400;
// Wall markers + text shorter than this = paywall/login wall.
const WALL_CHECK_CHARS = 2000;

const WALL_MARKERS = [
  'subscribe to continue',
  'subscribe to read',
  'sign in to continue',
  'log in to continue',
  'create an account to continue',
  'this article is for subscribers',
  'already a subscriber',
  'you have reached your limit of free articles',
  'please sign in to read',
  'members only',
];

function metaContent(doc, selector) {
  const el = doc.querySelector(selector);
  const value = el?.getAttribute('content')?.trim();
  return value || null;
}

function normaliseText(text) {
  return text
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function looksLikeWall(htmlLower, text) {
  if (text.length >= WALL_CHECK_CHARS) return false;
  return WALL_MARKERS.some((marker) => htmlLower.includes(marker));
}

export function extractFromHtml(html, pageUrl) {
  const rawBytes = Buffer.byteLength(html, 'utf8');
  const dom = new JSDOM(html, { url: pageUrl });
  const doc = dom.window.document;

  // Grab page-level metadata BEFORE Readability mutates the document.
  const ogTitle = metaContent(doc, 'meta[property="og:title"]');
  const ogSite = metaContent(doc, 'meta[property="og:site_name"]');
  const ogImage = metaContent(doc, 'meta[property="og:image"]');
  const docTitle = doc.title?.trim() || null;

  const article = new Readability(doc, { charThreshold: 100 }).parse();
  if (!article || !article.textContent?.trim()) {
    throw new ApiError(
      422,
      'EXTRACTION_FAILED',
      'No readable article content was found on that page. It may be an app or dashboard that needs JavaScript — try the paste-text mode instead.',
    );
  }

  const text = normaliseText(article.textContent);
  const htmlLower = html.slice(0, 200000).toLowerCase();

  if (looksLikeWall(htmlLower, text)) {
    throw new ApiError(
      422,
      'PAYWALL_SUSPECTED',
      'That page looks like a paywall or sign-in wall — only the teaser text is public, so there is not enough real content to summarise honestly. If you can read the article, paste its text instead.',
    );
  }
  if (text.length < MIN_ARTICLE_CHARS) {
    throw new ApiError(
      422,
      'THIN_CONTENT',
      `Only ${text.length} characters of readable text were found — the page may need JavaScript, be a login screen, or not be an article. Try the paste-text mode instead.`,
    );
  }

  let heroImage = ogImage || null;
  if (heroImage) {
    try {
      heroImage = new URL(heroImage, pageUrl).toString();
    } catch {
      heroImage = null;
    }
  }

  return buildExtraction({
    id: idForUrl(pageUrl),
    source: 'url',
    url: pageUrl,
    title: article.title || ogTitle || docTitle || 'Untitled page',
    byline: article.byline || null,
    siteName: article.siteName || ogSite || safeHostname(pageUrl),
    heroImage,
    excerpt: article.excerpt || null,
    text,
    rawBytes,
  });
}

// Same extraction shape built from pasted text, so paste mode runs
// through the same pipeline as URL mode. No HTML here, so noiseRemoved
// is 0.
export function extractionFromText(rawText, title) {
  const text = normaliseText(rawText || '');
  if (text.length < 100) {
    throw new ApiError(
      400,
      'TEXT_TOO_SHORT',
      'Please paste at least 100 characters of text to summarise.',
    );
  }
  return buildExtraction({
    id: idForText(text),
    source: 'text',
    url: null,
    title: title?.trim() || firstLineAsTitle(text),
    byline: null,
    siteName: 'Pasted text',
    heroImage: null,
    excerpt: null,
    text,
    rawBytes: Buffer.byteLength(text, 'utf8'),
  });
}

function buildExtraction({ id, source, url, title, byline, siteName, heroImage, excerpt, text, rawBytes }) {
  const cleanBytes = Buffer.byteLength(text, 'utf8');
  const words = countWords(text);
  return {
    id,
    source,
    url,
    title,
    byline,
    siteName,
    heroImage,
    excerpt,
    text,
    wordCount: words,
    readingTimeMinutes: readingTimeMinutes(words),
    stats: {
      rawBytes,
      cleanBytes,
      // How much of what was downloaded turned out to be boilerplate.
      noiseRemovedPct: rawBytes > 0 ? Math.max(0, Math.round((1 - cleanBytes / rawBytes) * 100)) : 0,
    },
    fetchedAt: new Date().toISOString(),
  };
}

function safeHostname(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return null;
  }
}

function firstLineAsTitle(text) {
  const line = text.split('\n').find((l) => l.trim().length > 0) || 'Pasted text';
  const trimmed = line.trim();
  return trimmed.length > 90 ? `${trimmed.slice(0, 87)}…` : trimmed;
}

export function publicExtraction(extraction, cached) {
  const { text, ...rest } = extraction;
  return {
    ...rest,
    cached,
    textPreview: `${text.slice(0, 300)}${text.length > 300 ? '…' : ''}`,
  };
}
