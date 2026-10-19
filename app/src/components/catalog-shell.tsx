"use client";

import {
  AlertTriangle,
  ArrowDownAZ,
  Bookmark,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  ChevronsDown,
  ChevronsUp,
  CircleDot,
  Clock,
  Database,
  Eye,
  EyeOff,
  Grid2X2,
  House,
  LibraryBig,
  List,
  Loader2,
  PanelRightOpen,
  Play,
  Search,
  Trash2,
} from "lucide-react";
import Image from "next/image";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { appUrl } from "@/lib/app-url";
import { loadAdminToken, saveAdminToken } from "@/lib/admin-token";
import { loadHiddenSeries, saveHiddenSeries } from "@/lib/hidden-series";
import {
  getLastReadEntry,
  loadReadingHistory,
  saveReadingHistory,
  withReadingRecorded,
} from "@/lib/reading-history";
import type { ReadingHistory, ReadingHistoryEntry } from "@/lib/reading-history";
import type { Book, CatalogOverview, CatalogSource, ReaderMode, Series } from "@/lib/types";
import { Reader } from "./reader";

type CatalogShellProps = {
  catalog: CatalogOverview;
  source: CatalogSource;
  warning?: string;
};

type AppView = "browse" | "series" | "reader";
type SeriesBooksState = "idle" | "loading" | "ready" | "error";
type SeriesViewMode = "grid" | "list";
type SeriesSortMode = "latest" | "name";
type ShelfTab = "ongoing" | "ended";
type PendingEndedChange = { series: Series; ended: boolean };
type OpenBookOptions = { resume?: boolean };
type ReaderProgressUpdate = { bookId: string; page: number; progress: number; completed: boolean };

function clampProgress(value: number) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, Math.round(value)));
}

function getBookPageCount(book: Book) {
  return book.pages.length || book.pageCount || 0;
}

function clampBookPage(index: number, total: number) {
  if (total <= 0) return 0;
  return Math.min(Math.max(Math.round(index), 0), total - 1);
}

function getBookReadPageIndex(book: Book) {
  const total = getBookPageCount(book);
  const estimatedPage = total > 0 ? Math.floor((book.progress / 100) * total) : 0;
  const progressPage = book.readProgressPage ?? estimatedPage;

  if (book.pages.length > 0) {
    const matchingIndex = book.pages.findIndex((page) => page.number === progressPage);
    if (matchingIndex >= 0) return matchingIndex;
  }

  return clampBookPage(progressPage, total);
}

function getBookResumePage(book: Book) {
  if (book.progress <= 0 || book.progress >= 100) return 0;
  return getBookReadPageIndex(book);
}

function getContinueBook(books: Book[]) {
  return (
    books.find((book) => book.progress > 0 && book.progress < 100) ??
    books.find((book) => book.progress < 100) ??
    books[0]
  );
}

/**
 * The episode to land on when reopening a series: whatever was read last on
 * this device, or — when that one is finished — the first unread episode after
 * it. Falls back to Komga's own progress when there is no local history.
 */
function getResumeBook(books: Book[], entry?: ReadingHistoryEntry) {
  const lastReadIndex = entry ? books.findIndex((book) => book.id === entry.bookId) : -1;
  if (lastReadIndex < 0) return getContinueBook(books);

  const lastRead = books[lastReadIndex];
  if (lastRead.progress < 100) return lastRead;

  return books.slice(lastReadIndex + 1).find((book) => book.progress < 100) ?? books[lastReadIndex + 1] ?? lastRead;
}

function getSeriesProgressPercent(series: Series, books: Book[] = []) {
  if (books.length > 0) {
    const total = books.reduce((sum, book) => sum + clampProgress(book.progress), 0);
    return clampProgress(total / books.length);
  }

  return clampProgress(series.progress);
}

function getProgressLabel(progress: number) {
  const value = clampProgress(progress);
  if (value >= 100) return "완독";
  if (value > 0) return `${value}% 읽음`;
  return "읽기 전";
}

function getBookProgressLabel(book: Book) {
  if (book.progress >= 100) return "완독";

  const total = getBookPageCount(book);
  if (book.progress > 0 && total > 0) {
    const currentPage = getBookReadPageIndex(book) + 1;
    return `${currentPage}/${total}쪽`;
  }

  return total > 0 ? `${total}쪽` : "쪽수 정보 없음";
}

function getContinueActionLabel(book?: Book, fallbackProgress = 0, hasHistory = false) {
  if (book?.progress && book.progress > 0 && book.progress < 100) return "이어서 읽기";
  // Episodes are not loaded on the browse screen, so local history stands in.
  if (!book && (hasHistory || (fallbackProgress > 0 && fallbackProgress < 100))) return "이어서 읽기";
  if (book?.progress && book.progress >= 100) return "다시 읽기";
  return "읽기 시작";
}

function ProgressMeter({ className = "", label, value }: { className?: string; label: string; value: number }) {
  const progress = clampProgress(value);
  return (
    <span
      aria-label={label}
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={progress}
      className={`progressMeter ${className}`}
      role="progressbar"
    >
      <span className="progressMeterFill" style={{ "--progress-value": `${progress}%` } as CSSProperties} />
      <span className="progressMeterLabel">{label}</span>
    </span>
  );
}

function getSeriesTimestamp(series: Series) {
  const timestamp = Date.parse(series.updatedAt);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function formatSeriesUpdatedAt(value: string) {
  if (!value) return "업데이트 정보 없음";
  return value.split("T")[0] || value;
}

export function CatalogShell({ catalog, source, warning }: CatalogShellProps) {
  const firstLibraryId = catalog.libraries[0]?.id ?? "";
  const firstSeriesId = catalog.series[0]?.id ?? "";
  const [selectedLibraryId, setSelectedLibraryId] = useState(firstLibraryId);
  const [selectedSeriesId, setSelectedSeriesId] = useState(firstSeriesId);
  const [selectedBookId, setSelectedBookId] = useState("");
  const [modeOverride, setModeOverride] = useState<ReaderMode>("auto");
  const [query, setQuery] = useState("");
  const [seriesViewMode, setSeriesViewMode] = useState<SeriesViewMode>("list");
  const [seriesSortMode, setSeriesSortMode] = useState<SeriesSortMode>("latest");
  const [readerStartPage, setReaderStartPage] = useState(0);
  const [view, setView] = useState<AppView>("browse");
  const [seriesBooksById, setSeriesBooksById] = useState<Record<string, Book[]>>({});
  const [bookStateBySeriesId, setBookStateBySeriesId] = useState<Record<string, SeriesBooksState>>({});
  const [bookErrorBySeriesId, setBookErrorBySeriesId] = useState<Record<string, string>>({});
  const [hiddenSeriesIds, setHiddenSeriesIds] = useState<Set<string>>(new Set());
  const [deletedSeriesIds, setDeletedSeriesIds] = useState<Set<string>>(new Set());
  const [showHidden, setShowHidden] = useState(false);
  const [shelfTab, setShelfTab] = useState<ShelfTab>("ongoing");
  const [endedOverrides, setEndedOverrides] = useState<Record<string, boolean>>({});
  const [pendingEnded, setPendingEnded] = useState<PendingEndedChange | null>(null);
  const [savingEndedId, setSavingEndedId] = useState("");
  const [endedError, setEndedError] = useState("");
  const [pendingDelete, setPendingDelete] = useState<Series | null>(null);
  const [adminToken, setAdminToken] = useState("");
  const [deletingSeriesId, setDeletingSeriesId] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [readingHistory, setReadingHistory] = useState<ReadingHistory>({});
  const episodeRowRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const seriesBooksByIdRef = useRef<Record<string, Book[]>>({});
  const episodeScrollTargetRef = useRef("");

  useEffect(() => {
    setHiddenSeriesIds(new Set(loadHiddenSeries()));
    setAdminToken(loadAdminToken());
    setReadingHistory(loadReadingHistory());
  }, []);

  const recordReading = useCallback((read: { seriesId: string; bookId: string; page?: number }) => {
    setReadingHistory((current) => {
      const next = withReadingRecorded(current, read);
      if (next !== current) saveReadingHistory(next);
      return next;
    });
  }, []);

  const lastReadSeriesId = getLastReadEntry(readingHistory)?.seriesId ?? "";

  const selectedLibrary = catalog.libraries.find((item) => item.id === selectedLibraryId) ?? catalog.libraries[0];

  const isSeriesEnded = useCallback(
    (item: Series) => endedOverrides[item.id] ?? item.ended,
    [endedOverrides],
  );

  // Everything in the library that passes search/hidden filters, before the
  // 구독중/완결 split, so both tab counts and the hero come from the same list.
  const shelfSeries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = catalog.series.filter((item) => {
      if (deletedSeriesIds.has(item.id)) return false;
      if (hiddenSeriesIds.has(item.id) && !showHidden) return false;
      const inLibrary = item.libraryId === selectedLibrary?.id;
      const matchesQuery =
        normalized.length === 0 ||
        item.title.toLowerCase().includes(normalized) ||
        item.subtitle.toLowerCase().includes(normalized) ||
        item.tags.some((tag) => tag.toLowerCase().includes(normalized));
      return inLibrary && matchesQuery;
    });

    const sorted = [...filtered].sort((left, right) => {
      if (seriesSortMode === "name") {
        return left.title.localeCompare(right.title, "ko");
      }

      const latestDiff = getSeriesTimestamp(right) - getSeriesTimestamp(left);
      return latestDiff || left.title.localeCompare(right.title, "ko");
    });

    // Pin the webtoon this device was last reading so it is the first thing on
    // screen (and the hero) on the next visit, whatever the sort mode is.
    const pinnedIndex = lastReadSeriesId ? sorted.findIndex((item) => item.id === lastReadSeriesId) : -1;
    if (pinnedIndex > 0) {
      const [pinned] = sorted.splice(pinnedIndex, 1);
      sorted.unshift(pinned);
    }

    return sorted;
  }, [
    catalog.series,
    deletedSeriesIds,
    hiddenSeriesIds,
    lastReadSeriesId,
    query,
    selectedLibrary?.id,
    seriesSortMode,
    showHidden,
  ]);

  const endedShelfCount = useMemo(() => shelfSeries.filter(isSeriesEnded).length, [isSeriesEnded, shelfSeries]);
  const ongoingShelfCount = shelfSeries.length - endedShelfCount;
  const visibleSeries = useMemo(
    () => shelfSeries.filter((item) => isSeriesEnded(item) === (shelfTab === "ended")),
    [isSeriesEnded, shelfSeries, shelfTab],
  );

  const hiddenCount = useMemo(
    () =>
      catalog.series.filter(
        (item) =>
          item.libraryId === selectedLibrary?.id && hiddenSeriesIds.has(item.id) && !deletedSeriesIds.has(item.id),
      ).length,
    [catalog.series, deletedSeriesIds, hiddenSeriesIds, selectedLibrary?.id],
  );

  const selectedSeries =
    catalog.series.find((item) => item.id === selectedSeriesId) ?? visibleSeries[0] ?? catalog.series[0];
  const selectedSeriesKey = selectedSeries?.id ?? "";
  const selectedSeriesBooks = selectedSeriesKey ? seriesBooksById[selectedSeriesKey] ?? [] : [];
  const selectedBooksState = selectedSeriesKey ? bookStateBySeriesId[selectedSeriesKey] ?? "idle" : "idle";
  const selectedBooksError = selectedSeriesKey ? bookErrorBySeriesId[selectedSeriesKey] : undefined;
  const selectedBook = selectedSeriesBooks.find((item) => item.id === selectedBookId) ?? selectedSeriesBooks[0];
  const selectedBookIndex = selectedBook ? selectedSeriesBooks.findIndex((book) => book.id === selectedBook.id) : -1;
  const previousBook = selectedBookIndex > 0 ? selectedSeriesBooks[selectedBookIndex - 1] : undefined;
  const nextBook =
    selectedBookIndex >= 0 && selectedBookIndex < selectedSeriesBooks.length - 1
      ? selectedSeriesBooks[selectedBookIndex + 1]
      : undefined;
  const primaryBook =
    getResumeBook(selectedSeriesBooks, readingHistory[selectedSeriesKey]) ??
    selectedSeriesBooks.find((book) => book.id === selectedSeries?.primaryBookId);
  const resumeBookId = primaryBook?.id ?? "";
  const firstEpisodeId = selectedSeriesBooks[0]?.id ?? "";
  const completedBookCount =
    selectedBooksState === "ready"
      ? selectedSeriesBooks.filter((book) => book.progress >= 100).length
      : selectedSeries?.completedBookCount ?? 0;
  const selectedSeriesProgress = selectedSeries ? getSeriesProgressPercent(selectedSeries, selectedSeriesBooks) : 0;
  const featuredSeries = shelfSeries[0] ?? selectedSeries;
  const featuredBooks = featuredSeries ? seriesBooksById[featuredSeries.id] ?? [] : [];
  const featuredBook =
    getResumeBook(featuredBooks, featuredSeries ? readingHistory[featuredSeries.id] : undefined) ??
    featuredBooks.find((book) => book.id === featuredSeries?.primaryBookId);
  const featuredProgress = featuredSeries ? getSeriesProgressPercent(featuredSeries, featuredBooks) : 0;
  const featuredState = featuredSeries ? bookStateBySeriesId[featuredSeries.id] ?? "idle" : "idle";
  const selectedSeriesIsLoading = selectedBooksState === "idle" || selectedBooksState === "loading";

  const loadSeriesBooks = useCallback(
    async (seriesId: string) => {
      if (!seriesId) return [];
      const cached = seriesBooksById[seriesId];
      if (cached) return cached;
      if (bookStateBySeriesId[seriesId] === "loading") return [];

      setBookStateBySeriesId((current) => ({ ...current, [seriesId]: "loading" }));
      setBookErrorBySeriesId((current) => {
        const next = { ...current };
        delete next[seriesId];
        return next;
      });

      try {
        const response = await fetch(appUrl(`/api/komga/series/${encodeURIComponent(seriesId)}/books`), { cache: "no-store" });
        const payload = (await response.json()) as { books?: Book[]; error?: string; warning?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? `Series books returned ${response.status}`);
        }
        const books = Array.isArray(payload.books) ? payload.books : [];
        setSeriesBooksById((current) => ({ ...current, [seriesId]: books }));
        setBookStateBySeriesId((current) => ({ ...current, [seriesId]: "ready" }));
        if (payload.warning) {
          setBookErrorBySeriesId((current) => ({ ...current, [seriesId]: payload.warning ?? "" }));
        }
        return books;
      } catch (error) {
        setBookStateBySeriesId((current) => ({ ...current, [seriesId]: "error" }));
        setBookErrorBySeriesId((current) => ({
          ...current,
          [seriesId]: error instanceof Error ? error.message : "Unable to load episodes",
        }));
        return [];
      }
    },
    [bookStateBySeriesId, seriesBooksById],
  );

  const handleReaderProgressChange = useCallback((update: ReaderProgressUpdate) => {
    setSeriesBooksById((current) => {
      let changed = false;
      const nextEntries = Object.entries(current).map(([seriesId, books]) => {
        let seriesChanged = false;
        const nextBooks = books.map((book) => {
          if (book.id !== update.bookId) return book;

          const nextProgress = update.completed ? 100 : clampProgress(update.progress);
          if (book.progress === nextProgress && book.readProgressPage === update.page) return book;

          seriesChanged = true;
          return { ...book, progress: nextProgress, readProgressPage: update.page };
        });

        if (seriesChanged) changed = true;
        return [seriesId, seriesChanged ? nextBooks : books] as const;
      });

      return changed ? (Object.fromEntries(nextEntries) as Record<string, Book[]>) : current;
    });

    const owningSeriesId = Object.entries(seriesBooksByIdRef.current).find(([, books]) =>
      books.some((book) => book.id === update.bookId),
    )?.[0];

    if (owningSeriesId) {
      recordReading({ seriesId: owningSeriesId, bookId: update.bookId, page: update.page });
    }
  }, [recordReading]);

  useEffect(() => {
    if ((view === "series" || view === "reader") && selectedSeriesKey) {
      void loadSeriesBooks(selectedSeriesKey);
    }
  }, [loadSeriesBooks, selectedSeriesKey, view]);

  useEffect(() => {
    seriesBooksByIdRef.current = seriesBooksById;
  }, [seriesBooksById]);

  // Bring the episode list to where reading left off instead of making the
  // reader scroll for it. Re-runs whenever the resume target changes.
  useEffect(() => {
    if (view !== "series") {
      episodeScrollTargetRef.current = "";
      return;
    }

    if (selectedBooksState !== "ready" || !resumeBookId) return;

    const target = `${selectedSeriesKey}:${resumeBookId}`;
    if (episodeScrollTargetRef.current === target) return;
    episodeScrollTargetRef.current = target;

    const isFirstEpisode = firstEpisodeId === resumeBookId;
    requestAnimationFrame(() => {
      if (isFirstEpisode) {
        window.scrollTo({ top: 0, behavior: "auto" });
        return;
      }
      episodeRowRefs.current[resumeBookId]?.scrollIntoView({ block: "center", behavior: "auto" });
    });
  }, [firstEpisodeId, resumeBookId, selectedBooksState, selectedSeriesKey, view]);

  function selectLibrary(libraryId: string) {
    setSelectedLibraryId(libraryId);
    const nextSeries = catalog.series.find((item) => item.libraryId === libraryId);
    if (nextSeries) {
      setSelectedSeriesId(nextSeries.id);
      setSelectedBookId("");
    }
    setModeOverride("auto");
    setView("browse");
  }

  function openSeries(seriesId: string) {
    const nextSeries = catalog.series.find((item) => item.id === seriesId);
    if (!nextSeries) {
      return;
    }
    setSelectedSeriesId(seriesId);
    setSelectedLibraryId(nextSeries.libraryId);
    setSelectedBookId("");
    setModeOverride("auto");
    setView("series");
    void loadSeriesBooks(seriesId);
  }

  function openBook(book: Book, options: OpenBookOptions = {}) {
    const startPage = options.resume ? getBookResumePage(book) : 0;
    setSelectedBookId(book.id);
    setReaderStartPage(startPage);
    setModeOverride("auto");
    setView("reader");
    recordReading({ seriesId: book.seriesId, bookId: book.id, page: startPage });
  }

  function scrollPageTo(position: "top" | "bottom") {
    const top = position === "top" ? 0 : document.documentElement.scrollHeight;
    window.scrollTo({ top, behavior: "smooth" });
  }

  function scrollToResumeEpisode() {
    if (!resumeBookId) return;
    episodeRowRefs.current[resumeBookId]?.scrollIntoView({ block: "center", behavior: "smooth" });
  }

  function setSeriesHidden(seriesId: string, hidden: boolean) {
    setHiddenSeriesIds((current) => {
      const next = new Set(current);
      if (hidden) {
        next.add(seriesId);
      } else {
        next.delete(seriesId);
      }
      saveHiddenSeries([...next]);
      return next;
    });
  }

  function requestDeleteSeries(series: Series) {
    setDeleteError("");
    setPendingDelete(series);
  }

  async function confirmDeleteSeries() {
    if (!pendingDelete) return;
    const seriesId = pendingDelete.id;
    const token = adminToken.trim();

    if (!token) {
      setDeleteError("관리자 토큰을 입력해 주세요.");
      return;
    }

    setDeletingSeriesId(seriesId);
    setDeleteError("");

    try {
      const response = await fetch(appUrl(`/api/komga/series/${encodeURIComponent(seriesId)}`), {
        method: "DELETE",
        headers: { "X-Admin-Token": token },
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        if (response.status === 403) {
          saveAdminToken("");
          throw new Error("관리자 토큰이 올바르지 않습니다.");
        }
        if (response.status === 503) {
          throw new Error("서버에 ADMIN_TOKEN이 설정되지 않아 삭제가 비활성화되어 있습니다.");
        }
        throw new Error(payload.error ?? `Delete returned ${response.status}`);
      }

      // Only remember a token the server has actually accepted.
      saveAdminToken(token);

      setDeletedSeriesIds((current) => new Set(current).add(seriesId));
      setSeriesHidden(seriesId, false);
      setPendingDelete(null);
      if (view !== "browse") {
        setView("browse");
      }
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "삭제에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setDeletingSeriesId("");
    }
  }

  function requestSeriesEnded(series: Series, ended: boolean) {
    setEndedError("");
    if (adminToken.trim()) {
      void saveSeriesEnded(series, ended, adminToken.trim());
    } else {
      setPendingEnded({ series, ended });
    }
  }

  async function saveSeriesEnded(series: Series, ended: boolean, token: string) {
    if (!token) {
      setEndedError("관리자 토큰을 입력해 주세요.");
      return;
    }

    setSavingEndedId(series.id);
    setEndedError("");

    try {
      const response = await fetch(appUrl(`/api/komga/series/${encodeURIComponent(series.id)}`), {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "X-Admin-Token": token },
        body: JSON.stringify({ ended }),
      });
      const payload = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) {
        if (response.status === 403) {
          saveAdminToken("");
          setAdminToken("");
          throw new Error("관리자 토큰이 올바르지 않습니다.");
        }
        if (response.status === 503) {
          throw new Error("서버에 ADMIN_TOKEN이 설정되지 않아 변경이 비활성화되어 있습니다.");
        }
        throw new Error(payload.error ?? `Update returned ${response.status}`);
      }

      saveAdminToken(token);
      setEndedOverrides((current) => ({ ...current, [series.id]: ended }));
      setPendingEnded(null);
    } catch (error) {
      // Keep the dialog (or open it) so the token can be fixed and retried.
      setPendingEnded({ series, ended });
      setEndedError(error instanceof Error ? error.message : "변경에 실패했습니다. 다시 시도해 주세요.");
    } finally {
      setSavingEndedId("");
    }
  }

  async function openPrimaryBook(series: Series) {
    setSelectedSeriesId(series.id);
    setSelectedLibraryId(series.libraryId);
    setModeOverride("auto");

    const books = await loadSeriesBooks(series.id);
    const book = getResumeBook(books, readingHistory[series.id]) ?? books.find((item) => item.id === series.primaryBookId);

    if (book) {
      openBook(book, { resume: true });
    } else {
      setView("series");
    }
  }

  if (!selectedLibrary || !selectedSeries) {
    return (
      <main className="emptyShell">
        <div className="emptyState">
          <PanelRightOpen size={32} />
          <h1>Panelshift</h1>
          <p>No catalog data is available yet.</p>
        </div>
      </main>
    );
  }

  if (view === "reader") {
    if (!selectedBook) {
      return (
        <main className="readerShell">
          <section className="reader" aria-label="Reader">
            <div className="readerToolbar">
              <div className="readerHeading">
                <button className="readerBackButton" onClick={() => setView("series")} type="button">
                  <ChevronLeft size={20} />
                  작품
                </button>
                <div className="readerTitleBlock">
                  <span className="eyebrow">{selectedSeries.title}</span>
                  <h2>{selectedSeriesIsLoading ? "회차를 불러오는 중" : "읽을 회차가 없습니다"}</h2>
                </div>
              </div>
            </div>
            <div className="readerEmpty">
              {selectedSeriesIsLoading ? <Loader2 size={34} /> : <AlertTriangle size={34} />}
              <h3>{selectedSeriesIsLoading ? "회차 목록 로딩" : "No episode loaded"}</h3>
              <p>{selectedBooksError ?? "잠시 후 다시 시도해 주세요."}</p>
            </div>
          </section>
        </main>
      );
    }

    return (
      <main className="readerShell">
        <Reader
          key={`${selectedBook.id}-${readerStartPage}`}
          book={selectedBook}
          initialPageIndex={readerStartPage}
          modeOverride={modeOverride}
          onBack={() => setView("series")}
          onHome={() => setView("browse")}
          onModeOverrideChange={setModeOverride}
          onProgressChange={handleReaderProgressChange}
          onNextBook={nextBook ? () => openBook(nextBook) : undefined}
          onPreviousBook={previousBook ? () => openBook(previousBook) : undefined}
          series={selectedSeries}
        />
      </main>
    );
  }

  return (
    <main className="appShell">
      <header className="topBar">
        <button className="brandButton" onClick={() => setView("browse")} title="Panelshift" type="button">
          <PanelRightOpen size={20} />
        </button>
        <div className="brandCopy">
          <h1>Panelshift</h1>
          <p>{source === "komga" ? "Komga catalog" : "Mock catalog"}</p>
        </div>
        <div className="topBarActions">
          {warning ? (
            <div className="warningPill" title={warning}>
              <AlertTriangle size={16} />
              Fallback
            </div>
          ) : null}
          <div className="connectionPill">
            <Database size={16} />
            {source === "komga" ? "Komga" : "Mock"}
          </div>
        </div>
      </header>

      {view === "browse" ? (
        <div className="contentShell">
          <section className="browseHero" aria-label="Library summary">
            <div className="heroCopy">
              <span className="eyebrow">{selectedLibrary.name}</span>
              <h2>내 웹툰 책장</h2>
              <div className="heroStats" aria-label="Library counts">
                <span>
                  <strong>{selectedLibrary.seriesCount}</strong>
                  <small>작품</small>
                </span>
                <span>
                  <strong>{selectedLibrary.bookCount}</strong>
                  <small>회차</small>
                </span>
                <span>
                  <strong>{visibleSeries.length}</strong>
                  <small>표시 중</small>
                </span>
              </div>
            </div>

            {featuredSeries ? (
              <div className="heroFeature">
                <Image
                  alt={`${featuredSeries.title} cover`}
                  className="featureCover"
                  height={220}
                  src={appUrl(featuredSeries.coverSrc)}
                  unoptimized
                  width={160}
                />
                <div className="featureCopy">
                  <span className="statusPill">바로 이어보기</span>
                  <h3>{featuredSeries.title}</h3>
                  <p>{featuredSeries.subtitle || `${featuredSeries.bookCount}개 회차`}</p>
                  <ProgressMeter label={getProgressLabel(featuredProgress)} value={featuredProgress} />
                  <div className="featureActions">
                    <button className="primaryAction" onClick={() => openSeries(featuredSeries.id)} type="button">
                      <BookOpen size={18} />
                      작품 보기
                    </button>
                    {featuredSeries.bookCount > 0 ? (
                      <button className="secondaryAction" onClick={() => void openPrimaryBook(featuredSeries)} type="button">
                        {featuredState === "loading" && !featuredBook ? <Loader2 size={17} /> : <Play size={17} />}
                        {getContinueActionLabel(
                          featuredBook,
                          featuredProgress,
                          Boolean(featuredSeries && readingHistory[featuredSeries.id]),
                        )}
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            ) : null}
          </section>

          <section className="libraryBand" aria-label="Libraries">
            <div className="sectionTitle">
              <LibraryBig size={18} />
              <span>라이브러리</span>
            </div>
            <div className="libraryTabs">
              {catalog.libraries.map((library) => (
                <button
                  className={`libraryTab ${library.id === selectedLibrary.id ? "selected" : ""}`}
                  key={library.id}
                  onClick={() => selectLibrary(library.id)}
                  type="button"
                >
                  <span>{library.name}</span>
                  <strong>{library.seriesCount}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="catalogSection" aria-label="Catalog">
            <div className="shelfTabs" role="tablist" aria-label="연재 상태">
              <button
                aria-selected={shelfTab === "ongoing"}
                className={`shelfTab ${shelfTab === "ongoing" ? "active" : ""}`}
                onClick={() => setShelfTab("ongoing")}
                role="tab"
                type="button"
              >
                구독중
                <strong>{ongoingShelfCount}</strong>
              </button>
              <button
                aria-selected={shelfTab === "ended"}
                className={`shelfTab ${shelfTab === "ended" ? "active" : ""}`}
                onClick={() => setShelfTab("ended")}
                role="tab"
                type="button"
              >
                완결
                <strong>{endedShelfCount}</strong>
              </button>
            </div>

            <div className="catalogSectionHeader">
              <div>
                <span className="eyebrow">작품</span>
                <h2>{selectedLibrary.name}</h2>
              </div>
              <div className="catalogTools">
                <label className="searchBox">
                  <Search size={17} />
                  <input
                    aria-label="Search catalog"
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="작품 검색"
                    type="search"
                    value={query}
                  />
                </label>
                <div className="optionGroup" aria-label="정렬">
                  <button
                    className={`optionButton ${seriesSortMode === "latest" ? "active" : ""}`}
                    onClick={() => setSeriesSortMode("latest")}
                    type="button"
                  >
                    <Clock size={16} />
                    최신순
                  </button>
                  <button
                    className={`optionButton ${seriesSortMode === "name" ? "active" : ""}`}
                    onClick={() => setSeriesSortMode("name")}
                    type="button"
                  >
                    <ArrowDownAZ size={16} />
                    이름순
                  </button>
                </div>
                <div className="optionGroup" aria-label="보기 방식">
                  <button
                    className={`optionButton ${seriesViewMode === "grid" ? "active" : ""}`}
                    onClick={() => setSeriesViewMode("grid")}
                    type="button"
                  >
                    <Grid2X2 size={16} />
                    바둑판
                  </button>
                  <button
                    className={`optionButton ${seriesViewMode === "list" ? "active" : ""}`}
                    onClick={() => setSeriesViewMode("list")}
                    type="button"
                  >
                    <List size={16} />
                    리스트
                  </button>
                </div>
                {hiddenCount > 0 ? (
                  <div className="optionGroup" aria-label="숨긴 작품">
                    <button
                      className={`optionButton ${showHidden ? "active" : ""}`}
                      onClick={() => setShowHidden((value) => !value)}
                      type="button"
                    >
                      {showHidden ? <Eye size={16} /> : <EyeOff size={16} />}
                      숨긴 작품 {hiddenCount}
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            {visibleSeries.length > 0 ? (
              <div className={`seriesShelf ${seriesViewMode === "list" ? "listView" : "gridView"}`}>
                {visibleSeries.map((item) => {
                  const itemProgress = getSeriesProgressPercent(item, seriesBooksById[item.id] ?? []);
                  const itemHidden = hiddenSeriesIds.has(item.id);
                  const itemEnded = isSeriesEnded(item);
                  return (
                    <div
                      className={`posterCardWrap ${seriesViewMode === "list" ? "listCardWrap" : ""} ${itemHidden ? "isHidden" : ""}`}
                      key={item.id}
                    >
                      <button
                        className={`posterCard ${seriesViewMode === "list" ? "listCard" : ""}`}
                        onClick={() => openSeries(item.id)}
                        type="button"
                      >
                        <span className="posterFrame">
                          <Image
                            alt={`${item.title} cover`}
                            className="posterCover"
                            height={256}
                            src={appUrl(item.coverSrc)}
                            unoptimized
                            width={192}
                          />
                        </span>
                        <span className="posterMeta">
                          <strong>{item.title}</strong>
                          <span className="posterInfoLine">
                            <small>{item.subtitle || `${item.bookCount}개 회차`}</small>
                            <small>{formatSeriesUpdatedAt(item.updatedAt)}</small>
                          </span>
                          {item.id === lastReadSeriesId ? (
                            <span className="resumeBadge">
                              <Bookmark size={13} />
                              마지막으로 읽던 작품
                            </span>
                          ) : null}
                          <ProgressMeter label={getProgressLabel(itemProgress)} value={itemProgress} />
                          <span className="posterTags">
                            {item.tags.slice(0, 2).map((tag) => (
                              <span className="tag" key={tag}>
                                {tag}
                              </span>
                            ))}
                          </span>
                        </span>
                      </button>
                      <div className="posterActions">
                        <button
                          aria-label={itemEnded ? "구독중으로 되돌리기" : "완결로 표시"}
                          className="posterActionButton"
                          disabled={savingEndedId === item.id}
                          onClick={() => requestSeriesEnded(item, !itemEnded)}
                          title={itemEnded ? "구독중으로 되돌리기" : "완결로 표시"}
                          type="button"
                        >
                          {savingEndedId === item.id ? (
                            <Loader2 size={16} />
                          ) : itemEnded ? (
                            <CircleDot size={16} />
                          ) : (
                            <CheckCircle2 size={16} />
                          )}
                        </button>
                        <button
                          aria-label={itemHidden ? "숨김 해제" : "목록에서 숨기기"}
                          className="posterActionButton"
                          onClick={() => setSeriesHidden(item.id, !itemHidden)}
                          title={itemHidden ? "숨김 해제" : "목록에서 숨기기"}
                          type="button"
                        >
                          {itemHidden ? <Eye size={16} /> : <EyeOff size={16} />}
                        </button>
                        <button
                          aria-label="작품 삭제"
                          className="posterActionButton danger"
                          onClick={() => requestDeleteSeries(item)}
                          title="작품 삭제 (파일 영구 삭제)"
                          type="button"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="noResults">
                <Search size={28} />
                {query.trim() ? (
                  <>
                    <h3>검색 결과가 없습니다</h3>
                    <p>다른 제목이나 태그로 다시 검색해 주세요.</p>
                  </>
                ) : shelfTab === "ended" ? (
                  <>
                    <h3>완결된 작품이 없습니다</h3>
                    <p>작품 카드나 상세 화면에서 완결로 표시하면 여기로 옮겨집니다.</p>
                  </>
                ) : (
                  <>
                    <h3>구독 중인 작품이 없습니다</h3>
                    <p>완결 탭에서 작품을 확인해 보세요.</p>
                  </>
                )}
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="contentShell detailShell">
          <div className="detailTopNav">
            <button className="detailBack" onClick={() => setView("browse")} type="button">
              <ChevronLeft size={20} />
              책장
            </button>
            <button className="detailBack" onClick={() => setView("browse")} type="button">
              <House size={20} />
              홈
            </button>
          </div>

          <section className="seriesDetail" aria-label="Series detail">
            <div className="detailCoverFrame">
              <Image
                alt={`${selectedSeries.title} cover`}
                className="detailCover"
                height={360}
                src={appUrl(selectedSeries.coverSrc)}
                unoptimized
                width={260}
              />
            </div>
            <div className="detailCopy">
              <span className="eyebrow">작품 상세</span>
              <h2>{selectedSeries.title}</h2>
              <p>{selectedSeries.subtitle || selectedLibrary.name}</p>
              <div className="tagRow detailTags">
                {selectedSeries.tags.map((tag) => (
                  <span className="tag" key={tag}>
                    {tag}
                  </span>
                ))}
              </div>
              <div className="detailStats">
                <span>
                  <strong>{selectedSeries.bookCount}</strong>
                  <small>회차</small>
                </span>
                <span>
                  <strong>{completedBookCount}</strong>
                  <small>완독</small>
                </span>
                <span>
                  <strong>{isSeriesEnded(selectedSeries) ? "완결" : "연재중"}</strong>
                  <small>연재</small>
                </span>
              </div>
              <ProgressMeter
                className="detailProgress"
                label={getProgressLabel(selectedSeriesProgress)}
                value={selectedSeriesProgress}
              />
              <div className="detailActions">
                {selectedSeries.bookCount > 0 ? (
                  <button className="primaryAction" onClick={() => void openPrimaryBook(selectedSeries)} type="button">
                    {selectedSeriesIsLoading && !primaryBook ? <Loader2 size={18} /> : <Play size={18} />}
                    {getContinueActionLabel(primaryBook, selectedSeriesProgress)}
                  </button>
                ) : null}
                <button className="secondaryAction" onClick={() => setView("browse")} type="button">
                  <Search size={17} />
                  다른 작품
                </button>
                <button
                  className="secondaryAction"
                  disabled={savingEndedId === selectedSeries.id}
                  onClick={() => requestSeriesEnded(selectedSeries, !isSeriesEnded(selectedSeries))}
                  type="button"
                >
                  {savingEndedId === selectedSeries.id ? (
                    <Loader2 size={17} />
                  ) : isSeriesEnded(selectedSeries) ? (
                    <CircleDot size={17} />
                  ) : (
                    <CheckCircle2 size={17} />
                  )}
                  {isSeriesEnded(selectedSeries) ? "구독중으로 되돌리기" : "완결로 표시"}
                </button>
              </div>
            </div>
          </section>

          <section className="episodeSection" aria-label="Episodes">
            <div className="episodeHeader">
              <div>
                <span className="eyebrow">회차</span>
                <h3>{selectedSeries.title}</h3>
              </div>
              <span>{selectedBooksState === "ready" ? selectedSeriesBooks.length : selectedSeries.bookCount}개</span>
            </div>

            {selectedSeriesIsLoading ? (
              <div className="noResults">
                <Loader2 size={28} />
                <h3>회차를 불러오는 중</h3>
                <p>Komga에서 선택한 작품의 회차 목록을 가져오고 있습니다.</p>
              </div>
            ) : selectedBooksState === "error" ? (
              <div className="noResults">
                <AlertTriangle size={28} />
                <h3>회차를 불러오지 못했습니다</h3>
                <p>{selectedBooksError ?? "Komga 연결을 확인해 주세요."}</p>
              </div>
            ) : selectedSeriesBooks.length > 0 ? (
              <div className="episodeList">
                {selectedSeriesBooks.map((book) => {
                  const resume = book.progress > 0 && book.progress < 100;
                  const isResumeTarget = book.id === resumeBookId;
                  return (
                    <button
                      className={`episodeRow ${isResumeTarget ? "isResumeTarget" : ""}`}
                      key={book.id}
                      onClick={() => openBook(book, { resume })}
                      ref={(node) => {
                        episodeRowRefs.current[book.id] = node;
                        return () => {
                          delete episodeRowRefs.current[book.id];
                        };
                      }}
                      type="button"
                    >
                      <span className="episodeIcon">
                        {book.progress >= 100 ? <CheckCircle2 size={19} /> : <CircleDot size={19} />}
                      </span>
                      <span className="episodeMain">
                        <strong>{book.title}</strong>
                        <span className="episodeSubline">
                          <small>{book.updatedAt}</small>
                          {isResumeTarget ? (
                            <small className="resumeBadge">
                              <Bookmark size={12} />
                              {readingHistory[selectedSeriesKey]?.bookId === book.id ? "마지막으로 읽던 회차" : "이어볼 회차"}
                            </small>
                          ) : null}
                        </span>
                      </span>
                      <span className="pageCount">{getBookProgressLabel(book)}</span>
                      <ProgressMeter className="episodeProgress" label={getProgressLabel(book.progress)} value={book.progress} />
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="noResults">
                <Search size={28} />
                <h3>회차가 없습니다</h3>
                <p>이 작품에 표시할 회차가 없습니다.</p>
              </div>
            )}
          </section>

          <nav aria-label="회차 목록 이동" className="listSideRail">
            <button
              aria-label="맨 위로"
              className="sideRailButton"
              onClick={() => scrollPageTo("top")}
              title="맨 위로"
              type="button"
            >
              <ChevronsUp size={20} />
            </button>
            {resumeBookId ? (
              <button
                aria-label="이어볼 회차로"
                className="sideRailButton"
                onClick={scrollToResumeEpisode}
                title="이어볼 회차로"
                type="button"
              >
                <Bookmark size={18} />
              </button>
            ) : null}
            <button
              aria-label="맨 아래로"
              className="sideRailButton"
              onClick={() => scrollPageTo("bottom")}
              title="맨 아래로"
              type="button"
            >
              <ChevronsDown size={20} />
            </button>
          </nav>
        </div>
      )}

      {pendingDelete ? (
        <div
          className="modalOverlay"
          onClick={() => {
            if (!deletingSeriesId) setPendingDelete(null);
          }}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="modalCard"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modalIcon danger">
              <AlertTriangle size={26} />
            </div>
            <h3>작품을 삭제할까요?</h3>
            <p>
              <strong>{pendingDelete.title}</strong>의 모든 파일이 Komga 서버 디스크에서 <strong>영구 삭제</strong>됩니다.
              이 작업은 되돌릴 수 없습니다.
            </p>
            <p className="modalHint">
              지우지 않고 목록에서만 감추려면 취소 후 <EyeOff size={13} /> 숨기기를 사용하세요.
            </p>
            <label className="modalField">
              <span>관리자 토큰</span>
              <input
                autoComplete="off"
                disabled={Boolean(deletingSeriesId)}
                onChange={(event) => setAdminToken(event.target.value)}
                placeholder="서버의 ADMIN_TOKEN"
                type="password"
                value={adminToken}
              />
            </label>
            {deleteError ? <p className="modalError">{deleteError}</p> : null}
            <div className="modalActions">
              <button
                className="secondaryAction"
                disabled={Boolean(deletingSeriesId)}
                onClick={() => setPendingDelete(null)}
                type="button"
              >
                취소
              </button>
              <button
                className="dangerAction"
                disabled={Boolean(deletingSeriesId)}
                onClick={() => void confirmDeleteSeries()}
                type="button"
              >
                {deletingSeriesId ? <Loader2 size={17} /> : <Trash2 size={17} />}
                삭제
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {pendingEnded ? (
        <div
          className="modalOverlay"
          onClick={() => {
            if (!savingEndedId) setPendingEnded(null);
          }}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="modalCard"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
          >
            <div className="modalIcon">
              {pendingEnded.ended ? <CheckCircle2 size={26} /> : <CircleDot size={26} />}
            </div>
            <h3>{pendingEnded.ended ? "완결로 표시할까요?" : "구독중으로 되돌릴까요?"}</h3>
            <p>
              <strong>{pendingEnded.series.title}</strong>의 연재 상태를 Komga에{" "}
              <strong>{pendingEnded.ended ? "완결" : "연재중"}</strong>으로 저장합니다. 모든 기기에 함께 반영됩니다.
            </p>
            <label className="modalField">
              <span>관리자 토큰</span>
              <input
                autoComplete="off"
                disabled={Boolean(savingEndedId)}
                onChange={(event) => setAdminToken(event.target.value)}
                placeholder="서버의 ADMIN_TOKEN"
                type="password"
                value={adminToken}
              />
            </label>
            {endedError ? <p className="modalError">{endedError}</p> : null}
            <div className="modalActions">
              <button
                className="secondaryAction"
                disabled={Boolean(savingEndedId)}
                onClick={() => setPendingEnded(null)}
                type="button"
              >
                취소
              </button>
              <button
                className="primaryAction"
                disabled={Boolean(savingEndedId)}
                onClick={() => void saveSeriesEnded(pendingEnded.series, pendingEnded.ended, adminToken.trim())}
                type="button"
              >
                {savingEndedId ? <Loader2 size={17} /> : <CheckCircle2 size={17} />}
                저장
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </main>
  );
}
