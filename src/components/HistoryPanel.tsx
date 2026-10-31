import type { HistoryItem } from '../lib/history';

interface Props {
  items: HistoryItem[];
  onSelect: (item: HistoryItem) => void;
  onClear: () => void;
}

export default function HistoryPanel({ items, onSelect, onClear }: Props) {
  if (!items.length) return null;
  return (
    <div className="rounded-2xl bg-white p-5 shadow-sm ring-1 ring-slate-200 sm:p-6">
      <div className="flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">Recent summaries</h3>
        <button
          type="button"
          onClick={onClear}
          className="text-xs font-medium text-slate-500 hover:text-slate-700"
        >
          Clear history
        </button>
      </div>
      <ul className="mt-3 divide-y divide-slate-100">
        {items.map((item) => (
          <li key={item.url}>
            <button
              type="button"
              onClick={() => onSelect(item)}
              className="w-full py-3 text-left transition hover:bg-slate-50"
            >
              <p className="truncate text-sm font-medium text-slate-800">{item.title}</p>
              <p className="mt-0.5 line-clamp-2 text-sm text-slate-500">{item.tldr}</p>
              <p className="mt-0.5 text-xs text-slate-400">
                {new Date(item.timestamp).toLocaleString()} · {item.url}
              </p>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
