"use client";

import {
  ChevronLeft,
  ChevronRight,
  ChevronsLeft,
  ChevronsRight,
  Columns2,
  List,
  Maximize2,
  Minus,
  Plus,
  RotateCcw,
  ScrollText,
  Smartphone,
} from "lucide-react";
import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clampPageIndex, getPagedWindow, inferReaderMode } from "@/lib/reader-mode";
import type { Book, ComicPage, ReaderMode, Series } from "@/lib/types";

type ReaderProgressUpdate = { bookId: string; page: number; progress: number; completed: boolean };

type ReaderProps = {
  book: Book;
  series: Series;
  modeOverride: ReaderMode;
  initialPageIndex?: number;
  onModeOverrideChange: (mode: ReaderMode) => void;
  onProgressChange?: (update: ReaderProgressUpdate) => void;
  onBack?: () => void;
  onNextBook?: () => void;
  onPreviousBook?: () => void;
};

type PageState = "loading" | "ready" | "error";

export function Reader({
  book,
  series,
  modeOverride,
  initialPageIndex = 0,
  onModeOverrideChange,
  onProgressChange,
  onBack,
  onNextBook,
  onPreviousBook,
}: ReaderProps) {
  const initialActiveIndex = clampPageIndex(initialPageIndex, book.pageCount ?? book.pages.length);
  const [activeIndex, setActiveIndex] = useState(initialActiveIndex);
  const [spreadEnabled, setSpreadEnabled] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [bottomNavVisible, setBottomNavVisible] = useState(true);
  const [remotePages, setRemotePages] = useState<ComicPage[] | null>(null);
  const [pageState, setPageState] = useState<PageState>(book.pages.length > 0 ? "ready" : "loading");
  const webtoonStageRef = useRef<HTMLDivElement | null>(null);
  const webtoonPageRefs = useRef<Array<HTMLSpanElement | null>>([]);
  const lastSyncedPageRef = useRef<number | null>(null);
  const pages = remotePages ?? book.pages;
  const activePageIndex = pages.length > 0 ? clampPageIndex(activeIndex, pages.length) : 0;
  const readerProgressPercent = pages.length > 0 ? Math.round(((activePageIndex + 1) / pages.length) * 100) : 0;
  const readingDirection = book.readingDirection ?? series.readingDirection;

  useEffect(() => {
    if (book.pages.length > 0) {
      return;
    }

    let cancelled = false;

    async function loadPages() {
      try {
        const response = await fetch(`/api/komga/books/${encodeURIComponent(book.id)}/pages`, { cache: "no-store" });
        const payload = (await response.json()) as { pages?: ComicPage[]; error?: string };
        if (!response.ok) {
          throw new Error(payload.error ?? `Page metadata returned ${response.status}`);
        }
        if (!cancelled) {
          setRemotePages(Array.isArray(payload.pages) ? payload.pages : []);
          setPageState("ready");
        }
      } catch {
        if (!cancelled) {
          setPageState("error");
        }
      }
    }

    void loadPages();

    return () => {
      cancelled = true;
    };
  }, [book.id, book.pages.length]);

  const inferredMode = useMemo(
    () =>
      inferReaderMode(
        pages,
        [...series.tags, ...book.tags],
        readingDirection,
        modeOverride,
      ),
    [book.tags, modeOverride, pages, readingDirection, series.tags],
  );

  const visiblePages = useMemo(
    () => getPagedWindow(pages, activePageIndex, spreadEnabled, readingDirection),
    [activePageIndex, pages, readingDirection, spreadEnabled],
  );

  const canGoPrevious = activePageIndex > 0;
  const canGoNext = activePageIndex < pages.length - 1;
  const nextPageStep = inferredMode === "paged" && spreadEnabled ? Math.max(visiblePages.length, 1) : 1;
  const previousPageStep = inferredMode === "paged" && spreadEnabled && activePageIndex > 1 ? 2 : 1;
  const isRtlPaged = inferredMode === "paged" && readingDirection === "RIGHT_TO_LEFT";

  const setReaderIndex = useCallback(
    (nextIndex: number) => {
      const clampedIndex = clampPageIndex(nextIndex, pages.length);
      setActiveIndex(clampedIndex);

      if (inferredMode === "webtoon") {
        requestAnimationFrame(() => {
          webtoonPageRefs.current[clampedIndex]?.scrollIntoView({ block: "start", behavior: "smooth" });
        });
      }
    },
    [inferredMode, pages.length],
  );

  useEffect(() => {
    if (pages.length === 0 || pageState !== "ready") return;

    const targetIndex = clampPageIndex(initialPageIndex, pages.length);
    requestAnimationFrame(() => {
      if (inferredMode === "webtoon" && targetIndex > 0) {
        webtoonPageRefs.current[targetIndex]?.scrollIntoView({ block: "start", behavior: "auto" });
      } else {
        webtoonStageRef.current?.scrollTo({ top: 0, left: 0, behavior: "auto" });
      }
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
    });
  }, [book.id, inferredMode, initialPageIndex, pageState, pages.length]);

  function handleWebtoonScroll(event: React.UIEvent<HTMLDivElement>) {
    const stage = event.currentTarget;
    const marker = stage.scrollTop + stage.clientHeight * 0.35;
    let nextIndex = 0;

    for (let index = 0; index < pages.length; index += 1) {
      const node = webtoonPageRefs.current[index];
      if (node && node.offsetTop <= marker) {
        nextIndex = index;
      }
    }

    setActiveIndex((current) => (current === nextIndex ? current : nextIndex));
  }

  function goPrevious() {
    setReaderIndex(activePageIndex - previousPageStep);
  }

  function goNext() {
    setReaderIndex(activePageIndex + nextPageStep);
  }

  function resetReader() {
    setReaderIndex(0);
    setZoom(100);
  }

  function toggleZoom() {
    setZoom((value) => (value >= 125 ? 100 : 130));
  }

  function toggleBottomNavigation(event: React.MouseEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.closest("button, input, a, [role='button']")) {
      return;
    }

    setBottomNavVisible((visible) => !visible);
  }

  useEffect(() => {
    if (pages.length === 0) return;

    function isEditableTarget(target: EventTarget | null) {
      if (!(target instanceof HTMLElement)) return false;
      return Boolean(target.closest("input, textarea, select, [contenteditable='true']"));
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (isEditableTarget(event.target)) return;

      if (event.key === "ArrowRight") {
        event.preventDefault();
        if (isRtlPaged) {
          if (canGoPrevious) setReaderIndex(activePageIndex - previousPageStep);
        } else if (canGoNext) {
          setReaderIndex(activePageIndex + nextPageStep);
        }
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        if (isRtlPaged) {
          if (canGoNext) setReaderIndex(activePageIndex + nextPageStep);
        } else if (canGoPrevious) {
          setReaderIndex(activePageIndex - previousPageStep);
        }
      }

      if (event.key === "Home") {
        event.preventDefault();
        setReaderIndex(0);
      }

      if (event.key === "End") {
        event.preventDefault();
        setReaderIndex(pages.length - 1);
      }
    }

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [activePageIndex, canGoNext, canGoPrevious, isRtlPaged, nextPageStep, pages.length, previousPageStep, setReaderIndex]);

  useEffect(() => {
    if (pages.length === 0 || pageState !== "ready") return;

    const page = pages[activePageIndex]?.number ?? activePageIndex;
    if (lastSyncedPageRef.current === page) return;
    lastSyncedPageRef.current = page;

    const completed = activePageIndex >= pages.length - 1;
    const progress = completed ? 100 : Math.min(99, readerProgressPercent);
    onProgressChange?.({ bookId: book.id, page, progress, completed });

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      void fetch(`/api/komga/books/${encodeURIComponent(book.id)}/progress`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          page,
          completed,
        }),
        signal: controller.signal,
      }).catch(() => undefined);
    }, 900);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [activePageIndex, book.id, onProgressChange, pageState, pages, readerProgressPercent]);

  if (pages.length === 0) {
    const isLoading = pageState === "loading";
    const isError = pageState === "error";

    return (
      <section className="reader" aria-label="Reader">
        <div className="readerToolbar">
          <div className="readerHeading">
            {onBack ? (
              <button className="readerBackButton" onClick={onBack} type="button">
                <ChevronLeft size={20} />
                작품
              </button>
            ) : null}
            <div className="readerTitleBlock">
              <span className="eyebrow">{series.title}</span>
              <h2>{book.title}</h2>
            </div>
          </div>
        </div>
        <div className="readerEmpty">
          <ScrollText size={34} />
          <h3>{isLoading ? "페이지를 불러오는 중" : "No pages loaded"}</h3>
          <p>
            {isLoading
              ? "Komga에서 페이지 정보를 가져오고 있습니다."
              : isError
                ? "Komga pages endpoint를 확인해 주세요."
                : "이 회차에 불러올 페이지가 없습니다."}
          </p>
        </div>
      </section>
    );
  }

  return (
    <section className="reader" aria-label="Reader">
      <div className="readerToolbar">
        <div className="readerHeading">
          {onBack ? (
            <button className="readerBackButton" onClick={onBack} type="button">
              <ChevronLeft size={20} />
              작품
            </button>
          ) : null}
          <div className="readerTitleBlock">
            <span className="eyebrow">{series.title}</span>
            <h2>{book.title}</h2>
          </div>
        </div>

        <div className="toolbarGroups">
          <div className="segmented" aria-label="Reader mode">
            <button
              className={modeOverride === "auto" ? "active" : ""}
              onClick={() => onModeOverrideChange("auto")}
              title="Auto"
              type="button"
            >
              <Maximize2 size={16} />
              자동
            </button>
            <button
              className={modeOverride === "paged" ? "active" : ""}
              onClick={() => onModeOverrideChange("paged")}
              title="Paged"
              type="button"
            >
              <Smartphone size={16} />
              페이지
            </button>
            <button
              className={modeOverride === "webtoon" ? "active" : ""}
              onClick={() => onModeOverrideChange("webtoon")}
              title="Webtoon"
              type="button"
            >
              <ScrollText size={16} />
              세로
            </button>
          </div>

          <button className="iconButton" onClick={resetReader} title="Reset reader" type="button">
            <RotateCcw size={18} />
          </button>
        </div>
      </div>

      <div className="readerControls">
        <div className="pageStepper">
          <button className="iconButton" disabled={!canGoPrevious} onClick={goPrevious} title="Previous page" type="button">
            <ChevronLeft size={20} />
          </button>
          <span>
            {Math.min(activePageIndex + 1, pages.length)} / {pages.length}
          </span>
          <button className="iconButton" disabled={!canGoNext} onClick={goNext} title="Next page" type="button">
            <ChevronRight size={20} />
          </button>
        </div>

        <label className="zoomControl">
          <Minus size={16} />
          <input
            aria-label="Zoom"
            max="140"
            min="70"
            onChange={(event) => setZoom(Number(event.target.value))}
            step="5"
            type="range"
            value={zoom}
          />
          <Plus size={16} />
        </label>

        <button
          className={`toggleButton ${spreadEnabled ? "active" : ""}`}
          onClick={() => setSpreadEnabled((value) => !value)}
          title="Spread"
          type="button"
        >
          <Columns2 size={17} />
          양면
        </button>
      </div>

      <div
        aria-label={`읽기 진행률 ${readerProgressPercent}%`}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={readerProgressPercent}
        className="readerProgressMeter"
        role="progressbar"
      >
        <span
          className="readerProgressFill"
          style={{ "--reader-progress": `${readerProgressPercent}%` } as React.CSSProperties}
        />
        <span className="readerProgressText">{readerProgressPercent}%</span>
      </div>

      {inferredMode === "webtoon" ? (
        <div
          className="webtoonStage"
          onClick={toggleBottomNavigation}
          onDoubleClick={toggleZoom}
          onScroll={handleWebtoonScroll}
          ref={webtoonStageRef}
          style={{ "--reader-zoom": `${zoom}%` } as React.CSSProperties}
        >
          {pages.map((page) => (
            <span
              className="webtoonPageAnchor"
              key={page.index}
              ref={(node) => {
                webtoonPageRefs.current[page.index] = node;
              }}
            >
              <Image
                alt={page.alt}
                className="webtoonPage"
                height={page.height}
                loading={page.index === 0 ? "eager" : "lazy"}
                src={page.src}
                unoptimized
                width={page.width}
              />
            </span>
          ))}
        </div>
      ) : (
        <div
          className="pagedStage"
          onClick={toggleBottomNavigation}
          onDoubleClick={toggleZoom}
          style={{ "--reader-zoom": `${zoom}%` } as React.CSSProperties}
        >
          <div className={`pagedSpread ${visiblePages.length > 1 ? "twoUp" : "singleUp"}`}>
            {visiblePages.map((page) => (
              <Image
                alt={page.alt}
                className="pagedPage"
                height={page.height}
                key={page.index}
                loading="eager"
                src={page.src}
                unoptimized
                width={page.width}
              />
            ))}
          </div>
        </div>
      )}

      <nav
        aria-hidden={!bottomNavVisible}
        aria-label="Reader bottom navigation"
        className={`readerBottomBar ${bottomNavVisible ? "visible" : "hidden"}`}
      >
        <button className="bottomNavButton" disabled={!onPreviousBook} onClick={onPreviousBook} type="button">
          <ChevronsLeft size={18} />
          이전화
        </button>
        <button className="bottomNavButton" disabled={!canGoPrevious} onClick={goPrevious} type="button">
          <ChevronLeft size={18} />
          이전
        </button>
        <button className="bottomEpisodeButton" disabled={!onBack} onClick={onBack} type="button">
          <List size={18} />
          회차 선택
        </button>
        <button className="bottomNavButton" disabled={!canGoNext} onClick={goNext} type="button">
          다음
          <ChevronRight size={18} />
        </button>
        <button className="bottomNavButton" disabled={!onNextBook} onClick={onNextBook} type="button">
          다음화
          <ChevronsRight size={18} />
        </button>
      </nav>
    </section>
  );
}
