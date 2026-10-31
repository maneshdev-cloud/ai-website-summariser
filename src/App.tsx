import { useEffect, useRef, useState } from 'react';
import UrlForm from './components/UrlForm';
import StageProgress, { Stage } from './components/StageProgress';
import ResultView from './components/ResultView';
import AskBox from './components/AskBox';
import HistoryPanel from './components/HistoryPanel';
import { api, ApiError } from './lib/api';
import type { Extraction, LengthMode, SummariseResponse } from './lib/api';
import { addHistoryItem, clearHistory, loadHistory } from './lib/history';
import type { HistoryItem } from './lib/history';

// For these errors, paste-text mode is the way around the problem.
const PASTE_SUGGEST_CODES = new Set([
  'PAYWALL_SUSPECTED',
  'THIN_CONTENT',
  'UPSTREAM_BLOCKED',
  'EXTRACTION_FAILED',
  'UNSUPPORTED_CONTENT',
]);

type Phase = 'idle' | 'working' | 'done' | 'error';

export default function App() {
  const [groqConfigured, setGroqConfigured] = useState<boolean | null>(null);
  const [phase, setPhase] = useState<Phase>('idle');
  const [stage, setStage] = useState(0);
  const [analyseDetail, setAnalyseDetail] = useState<string | undefined>(undefined);
  const [extraction, setExtraction] = useState<Extraction | null>(null);
  const [result, setResult] = useState<SummariseResponse | null>(null);
  const [mode, setMode] = useState<LengthMode>('standard');
  const [modeBusy, setModeBusy] = useState(false);
  const [modeError, setModeError] = useState<string | null>(null);
  const [error, setError] = useState<{ code: string; message: string } | null>(null);
  const [history, setHistory] = useState<HistoryItem[]>(() => loadHistory());
  const [textModeSignal, setTextModeSignal] = useState(0);
  const timers = useRef<number[]>([]);

  useEffect(() => {
    api
      .health()
      .then((h) => setGroqConfigured(h.groqConfigured))
      .catch(() => setGroqConfigured(null));
  }, []);

  useEffect(
    () => () => {
      timers.current.forEach((t) => window.clearTimeout(t));
    },
    [],
  );

  const later = (fn: () => void, ms: number) => {
    timers.current.push(window.setTimeout(fn, ms));
  };
  const clearTimers = () => {
    timers.current.forEach((t) => window.clearTimeout(t));
    timers.current = [];
  };

  const stages: Stage[] = [
    { label: 'Fetching page' },
    { label: 'Extracting clean text' },
    { label: 'Analysing content', detail: analyseDetail },
    { label: 'Writing summary' },
  ];

  // Two calls, matching the stage checklist: extract, then summarise.
  // The timers just advance the checklist while requests are in flight.
  async function runPipeline(doExtract: () => Promise<Extraction>, usedMode: LengthMode) {
    clearTimers();
    setError(null);
    setModeError(null);
    setResult(null);
    setPhase('working');
    setStage(0);
    setAnalyseDetail(undefined);
    later(() => setStage(1), 900);
    try {
      const ex = await doExtract();
      setExtraction(ex);
      setAnalyseDetail(
        ex.totalChunks > 1
          ? `${ex.totalChunks} chunks — summarising each, then combining (map-reduce)`
          : 'Single chunk — summarising directly',
      );
      setStage(2);
      later(() => setStage(3), 1500);
      // Send the text back too — summarise might land on a different
      // serverless instance, where this id means nothing on its own.
      const res = await api.summarise(ex.id, usedMode, ex.text, ex.title);
      clearTimers();
      setResult(res);
      setStage(4);
      setPhase('done');
      if (ex.source === 'url' && ex.url) {
        setHistory(
          addHistoryItem({
            id: ex.id,
            url: ex.url,
            title: ex.title,
            tldr: res.summary.tldr,
            timestamp: Date.now(),
            text: ex.text,
          }),
        );
      }
    } catch (err) {
      clearTimers();
      setPhase('error');
      setError(
        err instanceof ApiError
          ? { code: err.code, message: err.message }
          : { code: 'UNKNOWN', message: 'Something went wrong. Please try again.' },
      );
    }
  }

  const handleUrl = (url: string) => void runPipeline(() => api.extractUrl(url), mode);
  const handleText = (text: string, title?: string) =>
    void runPipeline(() => api.extractText(text, title), mode);

  // Mode change re-runs generation only, no re-fetch.
  async function handleModeChange(next: LengthMode) {
    if (!extraction || next === mode || modeBusy) return;
    setMode(next);
    setModeBusy(true);
    setModeError(null);
    try {
      const res = await api.summarise(extraction.id, next, extraction.text, extraction.title);
      setResult(res);
    } catch (err) {
      setModeError(
        err instanceof ApiError ? err.message : 'Could not regenerate the summary. Try again.',
      );
    } finally {
      setModeBusy(false);
    }
  }

  const handleHistorySelect = (item: HistoryItem) => {
    setMode('standard');
    // Reload from the stored text when there is any (no refetch).
    // Entries without text fall back to their URL.
    if (item.text) {
      void runPipeline(() => api.extractText(item.text as string, item.title), 'standard');
    } else {
      void runPipeline(() => api.extractUrl(item.url), 'standard');
    }
  };

  return (
    <div className="mx-auto flex min-h-screen w-full max-w-4xl flex-col px-4 pb-16 sm:px-6">
      <header className="pb-8 pt-12 text-center">
        <h1 className="text-3xl font-bold tracking-tight text-slate-900 sm:text-4xl">
          AI Website <span className="text-indigo-600">Summariser</span>
        </h1>
        <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-slate-600">
          Paste any article URL. The page is fetched and cleaned on the server, summarised
          into a TL;DR, key points and a detailed brief — then you can ask it questions.
        </p>
        {groqConfigured === false && (
          <p className="mx-auto mt-3 inline-block rounded-full bg-amber-100 px-3 py-1 text-xs font-medium text-amber-800 ring-1 ring-amber-200">
            Demo mode — no GROQ_API_KEY on the server, using the extractive fallback
          </p>
        )}
      </header>

      <main className="space-y-4">
        <UrlForm
          busy={phase === 'working'}
          onSubmitUrl={handleUrl}
          onSubmitText={handleText}
          textModeSignal={textModeSignal}
        />

        {(phase === 'working' || phase === 'error') && (
          <StageProgress stages={stages} current={stage} failed={phase === 'error'} />
        )}

        {error && (
          <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-red-200">
            <p className="text-sm font-semibold text-red-700">That didn't work</p>
            <p className="mt-1 text-sm leading-relaxed text-slate-700">{error.message}</p>
            {PASTE_SUGGEST_CODES.has(error.code) && (
              <button
                type="button"
                onClick={() => {
                  setTextModeSignal((n) => n + 1);
                  window.scrollTo({ top: 0, behavior: 'smooth' });
                }}
                className="mt-3 rounded-xl bg-indigo-600 px-4 py-2 text-sm font-semibold text-white transition hover:bg-indigo-500"
              >
                Switch to paste-text mode
              </button>
            )}
          </div>
        )}

        {modeError && (
          <div className="rounded-2xl bg-white p-4 shadow-sm ring-1 ring-red-200">
            <p className="text-sm text-red-700">{modeError}</p>
          </div>
        )}

        {phase === 'done' && extraction && result && (
          <>
            <ResultView
              extraction={extraction}
              result={result}
              onModeChange={handleModeChange}
              modeBusy={modeBusy}
            />
            <AskBox
              key={extraction.id}
              extractionId={extraction.id}
              text={extraction.text}
              title={extraction.title}
            />
          </>
        )}

        <HistoryPanel
          items={history}
          onSelect={handleHistorySelect}
          onClear={() => {
            clearHistory();
            setHistory([]);
          }}
        />
      </main>

      <footer className="mt-auto pt-12 text-center text-xs text-slate-400">
        Server-side fetching · Mozilla Readability extraction · Chunked map-reduce summarisation
        with Groq · Answers grounded in the page text
      </footer>
    </div>
  );
}
