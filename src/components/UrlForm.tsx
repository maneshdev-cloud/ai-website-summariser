import { useEffect, useState } from 'react';

/** Stable, public sample articles so the app can be tried in one click. */
export const SAMPLE_URLS: { label: string; url: string }[] = [
  { label: 'Wikipedia: Artificial intelligence', url: 'https://en.wikipedia.org/wiki/Artificial_intelligence' },
  { label: 'Paul Graham: How to Do Great Work', url: 'https://paulgraham.com/greatwork.html' },
  { label: 'Wikipedia: Photosynthesis', url: 'https://en.wikipedia.org/wiki/Photosynthesis' },
];

interface Props {
  busy: boolean;
  onSubmitUrl: (url: string) => void;
  onSubmitText: (text: string, title?: string) => void;
  /** Increment this to programmatically switch the form to paste-text mode
   *  (used when a URL fails because the page is paywalled or unreadable). */
  textModeSignal: number;
}

export default function UrlForm({ busy, onSubmitUrl, onSubmitText, textModeSignal }: Props) {
  const [tab, setTab] = useState<'url' | 'text'>('url');
  const [url, setUrl] = useState('');
  const [text, setText] = useState('');
  const [title, setTitle] = useState('');

  useEffect(() => {
    if (textModeSignal > 0) setTab('text');
  }, [textModeSignal]);

  const submitUrl = (value: string) => {
    const trimmed = value.trim();
    if (trimmed && !busy) onSubmitUrl(trimmed);
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <div className="mb-4 flex gap-2">
        {(
          [
            { key: 'url', label: 'Summarise a URL' },
            { key: 'text', label: 'Paste text instead' },
          ] as const
        ).map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key)}
            className={
              tab === t.key
                ? 'rounded-full bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white'
                : 'rounded-full bg-slate-100 px-4 py-1.5 text-sm font-medium text-slate-600 hover:bg-slate-200'
            }
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'url' ? (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            submitUrl(url);
          }}
        >
          <div className="flex flex-col gap-2 sm:flex-row">
            <input
              type="url"
              required
              placeholder="https://example.com/some-long-article"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              disabled={busy}
              className="w-full flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
            />
            <button
              type="submit"
              disabled={busy || !url.trim()}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Summarise'}
            </button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-xs text-slate-500">Try one:</span>
            {SAMPLE_URLS.map((sample) => (
              <button
                key={sample.url}
                type="button"
                disabled={busy}
                onClick={() => {
                  setUrl(sample.url);
                  submitUrl(sample.url);
                }}
                className="rounded-full bg-indigo-50 px-3 py-1 text-xs font-medium text-indigo-700 ring-1 ring-indigo-100 transition hover:bg-indigo-100 disabled:opacity-50"
              >
                {sample.label}
              </button>
            ))}
          </div>
        </form>
      ) : (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (text.trim().length >= 100 && !busy) onSubmitText(text, title || undefined);
          }}
        >
          <input
            type="text"
            placeholder="Title (optional)"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            disabled={busy}
            className="mb-2 w-full rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
          />
          <textarea
            required
            rows={8}
            placeholder="Paste the article text here — useful when a site is paywalled or blocks fetching. It runs through exactly the same summarise pipeline."
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            className="w-full resize-y rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
          />
          <div className="mt-2 flex items-center justify-between">
            <span className="text-xs text-slate-500">
              {text.trim().length} characters{text.trim().length < 100 ? ' — at least 100 needed' : ''}
            </span>
            <button
              type="submit"
              disabled={busy || text.trim().length < 100}
              className="rounded-xl bg-indigo-600 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-indigo-500 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Summarise text'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
