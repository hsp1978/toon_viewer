const STORAGE_KEY = "panelshift:readingHistory";
const MAX_ENTRIES = 60;

export type ReadingHistoryEntry = {
  seriesId: string;
  bookId: string;
  page: number;
  at: number;
};

/** Keyed by series id: one entry per series, holding the episode read last. */
export type ReadingHistory = Record<string, ReadingHistoryEntry>;

function isEntry(value: unknown): value is ReadingHistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<ReadingHistoryEntry>;
  return (
    typeof entry.seriesId === "string" &&
    entry.seriesId.length > 0 &&
    typeof entry.bookId === "string" &&
    entry.bookId.length > 0 &&
    typeof entry.page === "number" &&
    typeof entry.at === "number"
  );
}

/** Newest first, so callers can take the head as "the webtoon I was last reading". */
export function sortHistoryEntries(history: ReadingHistory) {
  return Object.values(history).sort((left, right) => right.at - left.at);
}

export function loadReadingHistory(): ReadingHistory {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const history: ReadingHistory = {};
    for (const [seriesId, entry] of Object.entries(parsed as Record<string, unknown>)) {
      if (isEntry(entry)) history[seriesId] = entry;
    }
    return history;
  } catch {
    return {};
  }
}

export function saveReadingHistory(history: ReadingHistory) {
  if (typeof window === "undefined") return;
  try {
    // Keep the store bounded; the oldest series drop off first.
    const kept = sortHistoryEntries(history).slice(0, MAX_ENTRIES);
    const trimmed = Object.fromEntries(kept.map((entry) => [entry.seriesId, entry]));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
  } catch {
    // Ignore write failures (private mode, quota, etc.)
  }
}

/**
 * Returns a new history with this read recorded, or the same object when
 * nothing changed, so React state updates stay no-ops for repeat page syncs.
 */
export function withReadingRecorded(
  history: ReadingHistory,
  read: { seriesId: string; bookId: string; page?: number },
): ReadingHistory {
  if (!read.seriesId || !read.bookId) return history;

  const page = Math.max(0, Math.round(read.page ?? 0));
  const current = history[read.seriesId];
  const isNewest = sortHistoryEntries(history)[0]?.seriesId === read.seriesId;
  if (current && current.bookId === read.bookId && current.page === page && isNewest) {
    return history;
  }

  return {
    ...history,
    [read.seriesId]: { seriesId: read.seriesId, bookId: read.bookId, page, at: Date.now() },
  };
}

export function getLastReadEntry(history: ReadingHistory): ReadingHistoryEntry | undefined {
  return sortHistoryEntries(history)[0];
}
