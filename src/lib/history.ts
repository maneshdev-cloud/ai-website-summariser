// Summary history, kept in localStorage. Only URL summaries are stored
// (pasted text isn't kept). Entries keep the page text when it fits, so
// clicking one can reload from the stored text instead of refetching;
// entries without text fall back to re-running their URL.

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  tldr: string;
  timestamp: number;
  text?: string; // full page text, when it fit under the cap below
}

const STORAGE_KEY = 'ai-website-summariser:history';
const MAX_ITEMS = 20;
// A page's clean text is usually ~100KB and localStorage allows ~5MB,
// so this cap keeps 20 entries comfortably inside that.
const MAX_TEXT_CHARS = 200_000;

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
  const capped: HistoryItem =
    item.text && item.text.length > MAX_TEXT_CHARS ? { ...item, text: undefined } : item;
  const next = [capped, ...loadHistory().filter((h) => h.url !== item.url)].slice(0, MAX_ITEMS);
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    // Probably the quota, because of the stored texts — retry without
    // them. History is a nicety, not worth failing over.
    try {
      const slim = next.map((h) => ({
        id: h.id,
        url: h.url,
        title: h.title,
        tldr: h.tldr,
        timestamp: h.timestamp,
      }));
      localStorage.setItem(STORAGE_KEY, JSON.stringify(slim));
    } catch {
      // Storage full/blocked — ignore.
    }
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
