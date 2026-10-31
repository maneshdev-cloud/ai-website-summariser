# AI Website Summariser

Paste any article URL and get a clean, structured summary — a one-line **TL;DR**, **key points**, a **detailed summary**, topic tags and tone — plus the stats that prove the work: how much boilerplate was stripped out and how much reading time you saved. Then **ask the page questions**, answered strictly from its own text.

Built with React + TypeScript on the front, and a small Node serverless backend that fetches the page itself, extracts the article with Mozilla Readability, and summarises it with Groq using chunked map-reduce — no third-party "summariser API" in the middle.

## Screenshots

<!-- TODO: add screenshots after deploying -->
<!-- ![Home](docs/screenshot-home.png) -->
<!-- ![Summary result](docs/screenshot-result.png) -->

## Features

- **URL summarisation** — server-side fetch (no CORS limits), Readability extraction, structured AI summary.
- **Staged progress UI** — Fetching → Extracting clean text → Analysing → Writing summary, mirroring the real pipeline instead of a lone spinner.
- **Structured output** — `{ tldr, keyPoints[5–7], detailedSummary, topics[], tone }`, requested via Groq JSON mode and validated server-side.
- **Length modes** — Brief / Standard / Detailed. Switching modes re-runs only the generation step from the cached extraction; the page is never re-fetched.
- **Long-page handling** — paragraph-aware chunking with ~10% overlap and a map-reduce pipeline (fast model per chunk, quality model to reduce), with an honest chunk cap.
- **Ask this page** — grounded Q&A over the extracted text only. If the page doesn't cover your question, it says so.
- **Honest failures** — paywalls, login walls, bot blocks (401/403), non-HTML URLs and unreadably thin pages each produce a specific explanation, never a confident summary of a sign-in form.
- **Paste-text mode** — when a site can't be fetched, paste the text and run the identical pipeline.
- **Server cache** — repeat URLs/text are cache hits (30-minute TTL), including per-mode summaries.
- **SSRF protection** — user URLs are validated (scheme, credentials, hostname blocklist, private/reserved IP ranges, DNS resolution check) before fetching, and re-validated on every redirect hop.
- **History, copy, export** — recent summaries in localStorage, one-click copy, and Markdown export.
- **Keyless demo mode** — with no `GROQ_API_KEY` configured, a built-in extractive summariser (sentence-frequency scoring) keeps the app fully runnable, clearly badged as `demo-extractive`.

## How the AI is used

```
 URL ──► SSRF guard ──► server fetch ──► Readability ──► clean text + metadata
                                                              │
                                          ┌───────────────────┴───────────────────┐
                                          │  chunk (paragraph-aware, 10% overlap) │
                                          └───────────────────┬───────────────────┘
                                          1 chunk ──► single Groq call (JSON mode)
                                          n chunks ─► MAP: fast model summarises each chunk
                                                      REDUCE: quality model merges them
                                                              │
                                          validate { tldr, keyPoints, detailedSummary,
                                                     topics, tone } ──► UI

 Ask ──► cached page text + question ──► Groq (temp 0.1, JSON { covered, answer })
         instruction: answer ONLY from the text; if it isn't there, say
         "This page doesn't cover that."
```

- **Models** (overridable via env): `openai/gpt-oss-120b` for the final summary, `openai/gpt-oss-20b` for per-chunk map steps and Q&A. Model IDs were verified against Groq's live catalogue; empty responses from the reasoning models are retried once automatically, and a single failed chunk never fails a whole summary.
- **Grounding**: Q&A receives only the extracted page text as context, runs at low temperature, and must return a machine-readable `covered` verdict — the UI displays "not covered" answers distinctly. For long pages, the chunks most relevant to the question are retrieved first (keyword scoring), so questions about later sections work and token use stays low enough for free-tier rate limits.
- **Why chunk at all?** A long article can exceed a model's comfortable context, and naive truncation silently drops the ending (where conclusions live). Map-reduce summarises every part, then synthesises.

## Architecture

```
Browser (React + Vite + Tailwind)
   │  POST /api/extract    { url } or { text, title }
   │  POST /api/summarise  { id, mode }
   │  POST /api/ask        { id, question }
   ▼
API handlers (Vercel serverless functions — plain (req, res) handlers)
   │
   ├─ lib/server/ssrf.js       URL validation + SSRF guard
   ├─ lib/server/fetchPage.js  fetch with timeout, manual redirects, status handling
   ├─ lib/server/extract.js    JSDOM + Readability → clean text, metadata, stats
   ├─ lib/server/chunk.js      paragraph-aware chunking with overlap + cap
   ├─ lib/server/cache.js      in-memory cache (extractions + per-mode summaries)
   ├─ lib/server/groq.js       Groq chat completions over native fetch
   ├─ lib/server/summarise.js  map-reduce pipeline + schema validation
   ├─ lib/server/ask.js        grounded Q&A
   └─ lib/server/extractive.js keyless fallback summariser + retrieval Q&A
```

Locally, `scripts/dev-server.mjs` (plain `node:http`) mounts the exact same handler files behind a thin Vercel-compatible adapter, and Vite proxies `/api` to it — so development runs the production code paths.

## Folder structure

```
ai-website-summariser/
├── api/                  # Serverless route handlers (thin: parse, delegate, respond)
│   ├── extract.js
│   ├── summarise.js
│   ├── ask.js
│   └── health.js
├── lib/server/           # All server logic (fetch, extract, chunk, cache, AI)
├── src/                  # React frontend (TypeScript)
│   ├── components/       # UrlForm, StageProgress, ResultView, AskBox, HistoryPanel
│   ├── lib/              # api client, history (localStorage), Markdown export
│   ├── App.tsx
│   └── main.tsx
├── scripts/
│   ├── dev.mjs           # `npm run dev`: API server + Vite together
│   └── dev-server.mjs    # local API server for development
├── tests/                # node:test suites (SSRF, chunking, extraction) + HTML fixture
├── index.html
├── vite.config.ts        # dev proxy /api → localhost:8787
└── .env.example
```

## Getting started

Prerequisites: Node.js 18+.

```bash
git clone <this-repo-url>
cd ai-website-summariser
npm install

cp .env.example .env
# Edit .env and add your Groq key (free at https://console.groq.com/keys).
# The app also runs without a key, in the extractive demo mode.

npm run dev
```

Open http://localhost:5173 — Vite serves the UI and proxies `/api` to the local API server on port 8787.

Other scripts:

```bash
npm run build     # type-check (tsc) + production build
npm test          # node:test suites for the SSRF guard, chunking and extraction
npm run dev:api   # API server only
npm run dev:web   # Vite only
```

## Problems in the usual tutorial versions → how this build solves them

Most "AI summariser" demos share the same shortcuts. This project was built specifically to fix them:

| Usual shortcut | Problem | Here |
| --- | --- | --- |
| Frontend calls a third-party summariser API (e.g. via RapidAPI) | No engineering of your own; bound by their limits | Own backend: fetch + extraction + AI pipeline implemented in `lib/server/` |
| API key in a `VITE_*` env var | The key ships to every visitor's browser | The Groq key exists only in server env; the browser talks to relative `/api` paths |
| Browser fetches the URL directly | CORS blocks almost every real site | Server-side fetch; CORS simply doesn't apply |
| Raw HTML (or a naive `innerText`) sent to the model | ~80–90% of a page is nav/ads/cookie boilerplate — wasted tokens, worse summaries (measured here: a Wikipedia article was 970 KB of HTML → 82 KB of text, **92% removed**) | Mozilla Readability extraction, and the UI shows the before/after numbers |
| Long text truncated to fit the prompt | The middle/end silently vanish; summaries skew to the intro | Paragraph-aware chunking + map-reduce with overlap; cap and truncation are reported, not hidden |
| Paywall/login page summarised as if it were the article | Confident nonsense | Wall/thin-content heuristics return a specific error and suggest paste-text mode |
| Fetch-any-URL endpoint with no validation | Textbook SSRF — `http://169.254.169.254/` hands out cloud credentials | SSRF guard: scheme allowlist, no embedded credentials, hostname blocklist, private/reserved range checks, DNS pre-check, and re-validation on every redirect (see `lib/server/ssrf.js` for the threat model and its documented limits) |
| Same URL re-summarised on every click | Slow and costs money each time | Server cache keyed by content hash, per length mode |
| Q&A answered from the model's general knowledge | Hallucinated answers attributed to the page | Grounded prompt, low temperature, explicit `covered` verdict, extractive retrieval fallback |

## API reference

All endpoints return JSON. Errors have the shape `{ "error": { "code": string, "message": string } }`.

### `POST /api/extract`
Body: `{ "url": "https://…" }` or `{ "text": "…", "title": "optional" }`.
Returns the extraction's public view: `id`, `title`, `byline`, `siteName`, `heroImage`, `wordCount`, `readingTimeMinutes`, `stats { rawBytes, cleanBytes, noiseRemovedPct }`, `chunkCount`, `totalChunks`, `truncated`, `cached`, `textPreview`. The full text stays server-side in the cache.

### `POST /api/summarise`
Body: `{ "id": "<extraction id>", "mode": "brief" | "standard" | "detailed" }`.
Returns `{ summary: { tldr, keyPoints, detailedSummary, topics, tone }, engine: "groq" | "demo-extractive", mapReduce, chunkCount, truncated, cached, stats { summaryWordCount, summaryReadingTimeMinutes, readingTimeSavedMinutes } }`.

### `POST /api/ask`
Body: `{ "id": "<extraction id>", "question": "…" }`.
Returns `{ covered: boolean, answer: string, engine }`.

### `GET /api/health`
Returns `{ ok, groqConfigured, engine, models }` — used by the UI to badge demo mode. Never exposes the key itself.

## Deployment (Vercel)

1. Push this repo to GitHub and import it in Vercel (framework preset: Vite).
2. Add the `GROQ_API_KEY` environment variable (Production + Preview).
3. Deploy. The functions in `/api` are picked up automatically; no build changes are needed. The in-memory cache is per warm instance, which is fine at this scale.

Any static host + separate Node host also works: serve `dist/` and run the handlers behind the same `/api` paths.

## Limitations

- Pages that render entirely with client-side JavaScript, and aggressively bot-protected sites, may not fetch — the app detects these, explains, and offers paste-text mode.
- Very long pages are summarised from the first 12 chunks (configurable in `lib/server/chunk.js`); the UI discloses this.
- The SSRF guard has a small documented DNS-rebinding (TOCTOU) window — see the header comment in `lib/server/ssrf.js`.
- The extractive demo mode is a fallback, not a replacement for the LLM: its summaries are noticeably more basic, and it is badged as such wherever it appears.

## Tests

```bash
npm test
```

Covers the SSRF guard (blocked hosts/IPs, schemes, credentials, mapped-IPv6), chunking (boundaries, overlap, size limits, the chunk cap), and extraction against a saved HTML fixture (metadata, boilerplate stripping, paywall/thin-content refusal, paste mode).

## License

MIT
