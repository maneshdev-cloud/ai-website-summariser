/**
 * Typed client for the /api endpoints.
 *
 * The client only ever talks to relative /api paths — in development Vite
 * proxies them to the local API server, in production Vercel serves them
 * as serverless functions. The API key never reaches this code.
 */

export type LengthMode = 'brief' | 'standard' | 'detailed';

export interface Extraction {
  id: string;
  source: 'url' | 'text';
  url: string | null;
  title: string;
  byline: string | null;
  siteName: string | null;
  heroImage: string | null;
  excerpt: string | null;
  /**
   * The full clean text. The client keeps it and sends it back with
   * summarise/ask requests: the server cache is per serverless instance,
   * so the id alone may not resolve on the instance that handles the
   * next stage — the text makes the flow stateless.
   */
  text: string;
  wordCount: number;
  readingTimeMinutes: number;
  stats: { rawBytes: number; cleanBytes: number; noiseRemovedPct: number };
  fetchedAt: string;
  cached: boolean;
  textPreview: string;
  chunkCount: number;
  totalChunks: number;
  truncated: boolean;
}

export interface Summary {
  tldr: string;
  keyPoints: string[];
  detailedSummary: string;
  topics: string[];
  tone: string;
}

export interface SummariseResponse {
  id: string;
  mode: LengthMode;
  engine: 'groq' | 'demo-extractive';
  models: { summary: string; fast: string } | null;
  fallbackNote?: string;
  summary: Summary;
  chunkCount: number;
  totalChunks: number;
  truncated: boolean;
  mapReduce: boolean;
  cached: boolean;
  stats: {
    summaryWordCount: number;
    summaryReadingTimeMinutes: number;
    readingTimeSavedMinutes: number;
  };
}

export interface AskResponse {
  id: string;
  question: string;
  covered: boolean;
  answer: string;
  engine: 'groq' | 'demo-extractive';
}

/** Error carrying the server's stable error code (e.g. "PAYWALL_SUSPECTED"). */
export class ApiError extends Error {
  code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, {
      headers: { 'Content-Type': 'application/json' },
      ...init,
    });
  } catch {
    throw new ApiError('NETWORK', 'Could not reach the API server. Is it running?');
  }
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    const code = data?.error?.code || 'HTTP_' + response.status;
    const message = data?.error?.message || `Request failed (HTTP ${response.status}).`;
    throw new ApiError(code, message);
  }
  return data as T;
}

function post<T>(path: string, body: unknown): Promise<T> {
  return request<T>(path, { method: 'POST', body: JSON.stringify(body) });
}

export const api = {
  health: () =>
    request<{ ok: boolean; groqConfigured: boolean; engine: string }>('/api/health'),
  extractUrl: (url: string) => post<Extraction>('/api/extract', { url }),
  extractText: (text: string, title?: string) =>
    post<Extraction>('/api/extract', { text, title }),
  summarise: (id: string, mode: LengthMode, text?: string, title?: string) =>
    post<SummariseResponse>('/api/summarise', { id, mode, text, title }),
  ask: (id: string, question: string, text?: string, title?: string) =>
    post<AskResponse>('/api/ask', { id, question, text, title }),
};
