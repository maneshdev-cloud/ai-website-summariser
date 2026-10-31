/**
 * Server-side page fetching.
 *
 * Fetching happens on the server, never in the browser, for three reasons:
 *  1. CORS — browsers block cross-origin reads of arbitrary pages; a
 *     server-side fetch has no such restriction.
 *  2. Secrets — the AI API key lives only on the server.
 *  3. Control — we can enforce the SSRF guard on the URL *and on every
 *     redirect hop*, set a timeout, and inspect the response before any
 *     of it reaches the AI pipeline.
 *
 * Failure handling is deliberately specific: the caller gets a distinct
 * error code for "site refused us" (401/403), "no such page" (404), and
 * "that wasn't HTML", so the UI can explain what actually happened instead
 * of summarising an error page.
 */
import { ApiError } from './errors.js';
import { assertPublicUrl } from './ssrf.js';

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const FETCH_TIMEOUT_MS = 15000;
const MAX_REDIRECTS = 5;

async function fetchOnce(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    return await fetch(url, {
      signal: controller.signal,
      redirect: 'manual', // redirects are followed by hand so each hop is SSRF-checked
      headers: {
        'User-Agent': USER_AGENT,
        Accept: 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new ApiError(
        502,
        'FETCH_TIMEOUT',
        `The page at ${url.hostname} took longer than ${FETCH_TIMEOUT_MS / 1000}s to respond.`,
      );
    }
    throw new ApiError(
      502,
      'FETCH_FAILED',
      `Could not fetch ${url.hostname} (${err?.cause?.code || err?.message || 'network error'}).`,
    );
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch a public web page and return its HTML.
 *
 * @param {string} rawUrl user-supplied URL (validated here and per redirect)
 * @returns {Promise<{html: string, finalUrl: string, status: number}>}
 */
export async function fetchPublicHtml(rawUrl) {
  let current = await assertPublicUrl(rawUrl);

  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetchOnce(current);

    // Redirect: re-validate the target before following it — a public URL
    // must not be able to bounce the server into a private address.
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location');
      if (!location) {
        throw new ApiError(502, 'FETCH_FAILED', `The page redirected without a destination.`);
      }
      if (hop === MAX_REDIRECTS) {
        throw new ApiError(502, 'TOO_MANY_REDIRECTS', 'The page redirected too many times.');
      }
      current = await assertPublicUrl(new URL(location, current).toString());
      continue;
    }

    if (response.status === 401 || response.status === 403) {
      throw new ApiError(
        422,
        'UPSTREAM_BLOCKED',
        `${current.hostname} refused the request (HTTP ${response.status}). The page may be bot-protected or require sign-in. Try the paste-text mode instead.`,
      );
    }
    if (response.status === 404 || response.status === 410) {
      throw new ApiError(
        422,
        'PAGE_NOT_FOUND',
        `No page exists at that URL (HTTP ${response.status}). Check the link and try again.`,
      );
    }
    if (!response.ok) {
      throw new ApiError(
        502,
        'FETCH_FAILED',
        `${current.hostname} returned HTTP ${response.status}. Try again later, or use paste-text mode.`,
      );
    }

    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    if (contentType && !contentType.includes('html')) {
      throw new ApiError(
        422,
        'UNSUPPORTED_CONTENT',
        `That URL serves "${contentType.split(';')[0]}", not a web page. This app summarises HTML articles.`,
      );
    }

    const html = await response.text();
    return { html, finalUrl: current.toString(), status: response.status };
  }

  // Unreachable in practice — the loop always returns or throws.
  throw new ApiError(502, 'FETCH_FAILED', 'Could not fetch the page.');
}
