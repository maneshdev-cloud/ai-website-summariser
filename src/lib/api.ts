// Client for the /api endpoints. Only relative paths — Vite proxies
// them to the local API server in dev, Vercel serves them in prod.

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
  // Full clean text. The client sends it back with summarise/ask calls
  // because the server cache is per-instance — the id alone might not
  // resolve on whichever instance handles the next request.
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
