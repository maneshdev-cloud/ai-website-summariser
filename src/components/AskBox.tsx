import { useState } from 'react';
import { api, ApiError } from '../lib/api';

/**
 * "Ask this page" — grounded Q&A over the current extraction.
 * Rendered with key={extraction.id} by the parent, so its state resets
 * automatically when a different page is summarised.
 */

interface Exchange {
  question: string;
  answer: string;
  covered: boolean;
}

export default function AskBox({
  extractionId,
  text,
  title,
}: {
  extractionId: string;
  /** Full page text, sent back with each question so a cold serverless
   *  instance can rebuild the extraction (stateless flow). */
  text: string;
  title: string;
}) {
  const [exchanges, setExchanges] = useState<Exchange[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const ask = async () => {
    const question = input.trim();
    if (!question || loading) return;
    setInput('');
    setError(null);
    setLoading(true);
    try {
      const res = await api.ask(extractionId, question, text, title);
      setExchanges((prev) => [...prev, { question, answer: res.answer, covered: res.covered }]);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <h3 className="text-base font-semibold text-slate-900">Ask this page</h3>
      <p className="mt-0.5 text-sm text-slate-500">
        Answers come only from this page's text — if the page doesn't cover it, you'll be told.
      </p>

      {exchanges.length > 0 && (
        <div className="mt-4 space-y-4">
          {exchanges.map((ex, i) => (
            <div key={i}>
              <p className="text-sm font-semibold text-slate-800">Q: {ex.question}</p>
              <div
                className={
                  ex.covered
                    ? 'mt-1 rounded-xl bg-slate-50 px-4 py-3 text-sm leading-relaxed text-slate-700 ring-1 ring-slate-100'
                    : 'mt-1 rounded-xl bg-amber-50 px-4 py-3 text-sm leading-relaxed text-amber-900 ring-1 ring-amber-100'
                }
              >
                {!ex.covered && (
                  <span className="mb-1 block text-xs font-semibold uppercase tracking-wide text-amber-600">
                    Not covered by this page
                  </span>
                )}
                {ex.answer}
              </div>
            </div>
          ))}
        </div>
      )}

      <form
        className="mt-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void ask();
        }}
      >
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          disabled={loading}
          placeholder="e.g. What does the article say about…?"
          className="w-full flex-1 rounded-xl border border-slate-300 px-4 py-2.5 text-sm outline-none placeholder:text-slate-400 focus:border-indigo-500 focus:ring-2 focus:ring-indigo-200 disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      {error && <p className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
