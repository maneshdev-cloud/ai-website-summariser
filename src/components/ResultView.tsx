import { useState } from 'react';
import type { Extraction, LengthMode, SummariseResponse } from '../lib/api';
import { downloadTextFile, fileNameFor, summaryToMarkdown, summaryToPlainText } from '../lib/export';

interface Props {
  extraction: Extraction;
  result: SummariseResponse;
  onModeChange: (mode: LengthMode) => void;
  modeBusy: boolean;
}

const MODES: { key: LengthMode; label: string }[] = [
  { key: 'brief', label: 'Brief' },
  { key: 'standard', label: 'Standard' },
  { key: 'detailed', label: 'Detailed' },
];

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  return `${(bytes / 1024).toFixed(1)} KB`;
}

function Stat({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-xl bg-slate-50 px-4 py-3 ring-1 ring-slate-100">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-500">{label}</p>
      <p className="mt-0.5 text-lg font-semibold text-slate-900">{value}</p>
      {sub && <p className="text-xs text-slate-500">{sub}</p>}
    </div>
  );
}

export default function ResultView({ extraction, result, onModeChange, modeBusy }: Props) {
  const { summary, stats } = result;
  const [copied, setCopied] = useState(false);
  const [imageOk, setImageOk] = useState(true);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(summaryToPlainText(summary));
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard unavailable (permissions) — leave the button unchanged.
    }
  };

  const exportMarkdown = () => {
    downloadTextFile(fileNameFor(extraction, result.mode), summaryToMarkdown(extraction, result));
  };

  return (
    <div className="space-y-4">
      {/* ---- Article header + stats ---- */}
      <div className="overflow-hidden rounded-2xl bg-white shadow-sm ring-1 ring-slate-200">
        {extraction.heroImage && imageOk && (
          <img
            src={extraction.heroImage}
            alt=""
            onError={() => setImageOk(false)}
            className="h-44 w-full object-cover sm:h-56"
          />
        )}
        <div className="p-5 sm:p-6">
          <p className="text-xs font-semibold uppercase tracking-wide text-indigo-600">
            {extraction.siteName || 'Web page'}
            {extraction.byline ? ` · ${extraction.byline}` : ''}
            {extraction.cached ? ' · served from cache' : ''}
          </p>
          <h2 className="mt-1 text-xl font-bold leading-snug text-slate-900 sm:text-2xl">
            {extraction.title}
          </h2>
          {extraction.url && (
            <a
              href={extraction.url}
              target="_blank"
              rel="noreferrer"
              className="mt-1 block truncate text-sm text-slate-500 underline-offset-2 hover:underline"
            >
              {extraction.url}
            </a>
          )}

          <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat
              label="Original"
              value={`${extraction.readingTimeMinutes} min read`}
              sub={`${extraction.wordCount.toLocaleString()} words`}
            />
            <Stat
              label="Boilerplate removed"
              value={`${extraction.stats.noiseRemovedPct}%`}
              sub={`${formatBytes(extraction.stats.rawBytes)} HTML → ${formatBytes(extraction.stats.cleanBytes)} clean text`}
            />
            <Stat
              label="Summary"
              value={`${stats.summaryWordCount.toLocaleString()} words`}
              sub={`~${stats.summaryReadingTimeMinutes} min read`}
            />
            <Stat
              label="Reading time saved"
              value={`${stats.readingTimeSavedMinutes} min`}
              sub={result.mapReduce ? `Summarised in ${result.chunkCount} chunks (map-reduce)` : 'Single-pass summary'}
            />
          </div>

          {result.truncated && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
              This page is very long ({result.totalChunks} chunks). To keep the request
              reasonable, the summary covers the first {result.chunkCount} chunks.
            </p>
          )}
          {result.engine === 'demo-extractive' && (
            <p className="mt-3 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 ring-1 ring-amber-100">
              Demo mode: no GROQ_API_KEY is configured on the server, so this summary was
              produced by the built-in extractive fallback rather than the AI model.
              {result.fallbackNote ? ` ${result.fallbackNote}` : ''}
            </p>
          )}
        </div>
      </div>

      {/* ---- Controls: length mode + actions ---- */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium text-slate-500">Length:</span>
          <div className="flex rounded-full bg-white p-1 ring-1 ring-slate-200">
            {MODES.map((m) => (
              <button
                key={m.key}
                type="button"
                disabled={modeBusy}
                onClick={() => onModeChange(m.key)}
                className={
                  result.mode === m.key
                    ? 'rounded-full bg-indigo-600 px-3.5 py-1 text-sm font-medium text-white'
                    : 'rounded-full px-3.5 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100 disabled:opacity-50'
                }
              >
                {m.label}
              </button>
            ))}
          </div>
          {modeBusy && <span className="text-xs text-slate-500">Regenerating… (no re-fetch)</span>}
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={copy}
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
          >
            {copied ? 'Copied ✓' : 'Copy summary'}
          </button>
          <button
            type="button"
            onClick={exportMarkdown}
            className="rounded-xl bg-white px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300 transition hover:bg-slate-50"
          >
            Export .md
          </button>
        </div>
      </div>

      {/* ---- TL;DR ---- */}
      <div className="rounded-2xl bg-indigo-600 p-5 text-white shadow-sm sm:p-6">
        <p className="text-xs font-semibold uppercase tracking-widest text-indigo-200">TL;DR</p>
        <p className="mt-2 text-lg font-medium leading-relaxed">{summary.tldr}</p>
      </div>

      {/* ---- Key points + detail ---- */}
      <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Key points</h3>
        <ul className="mt-3 space-y-2.5">
          {summary.keyPoints.map((point, i) => (
            <li key={i} className="flex gap-2.5 text-[15px] leading-relaxed text-slate-800">
              <svg
                viewBox="0 0 24 24"
                className="mt-1 h-4 w-4 shrink-0 text-emerald-500"
                fill="none"
                stroke="currentColor"
                strokeWidth="3"
              >
                <path d="M5 13l4 4L19 7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
              <span>{point}</span>
            </li>
          ))}
        </ul>

        <h3 className="mt-6 text-sm font-semibold uppercase tracking-wide text-slate-500">
          Detailed summary
        </h3>
        <div className="mt-3 space-y-3 text-[15px] leading-relaxed text-slate-700">
          {summary.detailedSummary.split(/\n{2,}/).map((paragraph, i) => (
            <p key={i}>{paragraph}</p>
          ))}
        </div>

        {(summary.topics.length > 0 || summary.tone) && (
          <div className="mt-6 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
            {summary.topics.map((topic) => (
              <span
                key={topic}
                className="rounded-full bg-slate-100 px-3 py-1 text-xs font-medium text-slate-700"
              >
                {topic}
              </span>
            ))}
            <span className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100">
              Tone: {summary.tone}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
