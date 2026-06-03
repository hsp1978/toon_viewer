"use client";

import {
  AlertTriangle,
  ArrowDownAZ,
  BookOpen,
  CheckCircle2,
  ChevronLeft,
  CircleDot,
  Clock,
  Database,
  Grid2X2,
  LibraryBig,
  List,
  Loader2,
  PanelRightOpen,
  Play,
  Search,
} from "lucide-react";
import Image from "next/image";
import type { CSSProperties } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
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

function getContinueActionLabel(book?: Book, fallbackProgress = 0) {
  if (book?.progress && book.progress > 0 && book.progress < 100) return "이어서 읽기";
  if (!book && fallbackProgress > 0 && fallbackProgress < 100) return "이어서 읽기";
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
  const [seriesViewMode, setSeriesViewMode] = useState<SeriesViewMode>("grid");
  const [seriesSortMode, setSeriesSortMode] = useState<SeriesSortMode>("latest");
  const [readerStartPage, setReaderStartPage] = useState(0);
  const [view, setView] = useState<AppView>("browse");
  const [seriesBooksById, setSeriesBooksById] = useState<Record<string, Book[]>>({});
  const [bookStateBySeriesId, setBookStateBySeriesId] = useState<Record<string, SeriesBooksState>>({});
  const [bookErrorBySeriesId, setBookErrorBySeriesId] = useState<Record<string, string>>({});

  const selectedLibrary = catalog.libraries.find((item) => item.id === selectedLibraryId) ?? catalog.libraries[0];

  const visibleSeries = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    const filtered = catalog.series.filter((item) => {
      const inLibrary = item.libraryId === selectedLibrary?.id;
      const matchesQuery =
        normalized.length === 0 ||
        item.title.toLowerCase().includes(normalized) ||
        item.subtitle.toLowerCase().includes(normalized) ||
        item.tags.some((tag) => tag.toLowerCase().includes(normalized));
      return inLibrary && matchesQuery;
    });

    return [...filtered].sort((left, right) => {
      if (seriesSortMode === "name") {
        return left.title.localeCompare(right.title, "ko");
      }

      const latestDiff = getSeriesTimestamp(right) - getSeriesTimestamp(left);
      return latestDiff || left.title.localeCompare(right.title, "ko");
    });
  }, [catalog.series, query, selectedLibrary?.id, seriesSortMode]);

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
    getContinueBook(selectedSeriesBooks) ?? selectedSeriesBooks.find((book) => book.id === selectedSeries?.primaryBookId);
  const completedBookCount =
    selectedBooksState === "ready"
      ? selectedSeriesBooks.filter((book) => book.progress >= 100).length
      : selectedSeries?.completedBookCount ?? 0;
  const selectedSeriesProgress = selectedSeries ? getSeriesProgressPercent(selectedSeries, selectedSeriesBooks) : 0;
  const featuredSeries = visibleSeries[0] ?? selectedSeries;
  const featuredBooks = featuredSeries ? seriesBooksById[featuredSeries.id] ?? [] : [];
  const featuredBook =
    getContinueBook(featuredBooks) ?? featuredBooks.find((book) => book.id === featuredSeries?.primaryBookId);
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
        const response = await fetch(`/api/komga/series/${encodeURIComponent(seriesId)}/books`, { cache: "no-store" });
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
  }, []);

  useEffect(() => {
    if ((view === "series" || view === "reader") && selectedSeriesKey) {
      void loadSeriesBooks(selectedSeriesKey);
    }
  }, [loadSeriesBooks, selectedSeriesKey, view]);

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
    setSelectedBookId(book.id);
    setReaderStartPage(options.resume ? getBookResumePage(book) : 0);
    setModeOverride("auto");
    setView("reader");
  }

  async function openPrimaryBook(series: Series) {
    setSelectedSeriesId(series.id);
    setSelectedLibraryId(series.libraryId);
    setModeOverride("auto");

    const books = await loadSeriesBooks(series.id);
    const book = getContinueBook(books) ?? books.find((item) => item.id === series.primaryBookId);

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
                  src={featuredSeries.coverSrc}
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
                        {getContinueActionLabel(featuredBook, featuredProgress)}
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
              </div>
            </div>

            {visibleSeries.length > 0 ? (
              <div className={`seriesShelf ${seriesViewMode === "list" ? "listView" : "gridView"}`}>
                {visibleSeries.map((item) => {
                  const itemProgress = getSeriesProgressPercent(item, seriesBooksById[item.id] ?? []);
                  return (
                    <button
                      className={`posterCard ${seriesViewMode === "list" ? "listCard" : ""}`}
                      key={item.id}
                      onClick={() => openSeries(item.id)}
                      type="button"
                    >
                      <span className="posterFrame">
                        <Image
                          alt={`${item.title} cover`}
                          className="posterCover"
                          height={256}
                          src={item.coverSrc}
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
                  );
                })}
              </div>
            ) : (
              <div className="noResults">
                <Search size={28} />
                <h3>검색 결과가 없습니다</h3>
                <p>다른 제목이나 태그로 다시 검색해 주세요.</p>
              </div>
            )}
          </section>
        </div>
      ) : (
        <div className="contentShell detailShell">
          <button className="detailBack" onClick={() => setView("browse")} type="button">
            <ChevronLeft size={20} />
            책장
          </button>

          <section className="seriesDetail" aria-label="Series detail">
            <div className="detailCoverFrame">
              <Image
                alt={`${selectedSeries.title} cover`}
                className="detailCover"
                height={360}
                src={selectedSeries.coverSrc}
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
                  <strong>{selectedSeries.status}</strong>
                  <small>상태</small>
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
                  return (
                    <button
                      className="episodeRow"
                      key={book.id}
                      onClick={() => openBook(book, { resume })}
                      type="button"
                    >
                      <span className="episodeIcon">
                        {book.progress >= 100 ? <CheckCircle2 size={19} /> : <CircleDot size={19} />}
                      </span>
                      <span className="episodeMain">
                        <strong>{book.title}</strong>
                        <small>{book.updatedAt}</small>
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
        </div>
      )}
    </main>
  );
}
