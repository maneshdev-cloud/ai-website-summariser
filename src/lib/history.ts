/**
 * Summary history, kept in localStorage.
 *
 * Only URL-based summaries are stored (pasted text isn't kept, for
 * privacy and because it can't be reloaded). Each entry also keeps the
 * page's clean text (up to a cap), so clicking an entry can reload it
 * statelessly from the stored text — no refetch, and no reliance on a
 * warm server instance. Entries without stored text fall back to
 * re-running the flow for their URL.
 */

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  tldr: string;
  timestamp: number;
  /** Full clean page text, when it fit under the storage cap. */
  text?: string;
}

const STORAGE_KEY = 'ai-website-summariser:history';
const MAX_ITEMS = 20;
/**
 * Per-entry text cap. A page's clean text is typically ~100KB and the
 * localStorage budget is ~5MB, so 20 capped entries stay well inside
 * it; anything larger is stored without its text.
 */
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
    // Quota most likely blown by the stored page texts — drop them and
    // retry slimmer before giving up; history itself is a nicety.
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
