/**
 * Summary history, kept in localStorage.
 *
 * Only URL-based summaries are stored (pasted text isn't kept, for
 * privacy and because it can't be reloaded). Clicking an entry re-runs
 * the flow for that URL — which the server answers from its cache while
 * the entry is warm, so revisits are close to free.
 */

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  tldr: string;
  timestamp: number;
}

const STORAGE_KEY = 'ai-website-summariser:history';
const MAX_ITEMS = 20;

export function loadHistory(): HistoryItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is HistoryItem =>
        item && typeof item.url === 'string' && typeof item.title === 'string',
    );
  } catch {
    return [];
  }
}

export function addHistoryItem(item: HistoryItem): HistoryItem[] {
  const next = [item, ...loadHistory().filter((h) => h.url !== item.url)].slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Storage full/blocked — history is a nicety, not a requirement.
  }
  return next;
}

export function clearHistory(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
