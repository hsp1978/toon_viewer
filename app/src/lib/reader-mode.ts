import type { ComicPage, InferredReaderMode, ReaderMode, ReadingDirection } from "./types";

const webtoonTags = new Set(["webtoon", "long strip", "manhwa"]);

export function inferReaderMode(
  pages: Pick<ComicPage, "width" | "height">[],
  tags: string[] = [],
  readingDirection?: ReadingDirection,
  override: ReaderMode = "auto",
): InferredReaderMode {
  if (override !== "auto") {
    return override;
  }

  if (readingDirection === "WEBTOON" || readingDirection === "VERTICAL") {
    return "webtoon";
  }

  const normalizedTags = tags.map((tag) => tag.toLowerCase());
  if (normalizedTags.some((tag) => webtoonTags.has(tag))) {
    return "webtoon";
  }

  const ratios = pages
    .slice(0, 5)
    .filter((page) => page.width > 0 && page.height > 0)
    .map((page) => page.height / page.width)
    .sort((a, b) => a - b);

  if (ratios.length === 0) {
    return "paged";
  }

  const median = ratios[Math.floor(ratios.length / 2)];
  return median >= 2.2 ? "webtoon" : "paged";
}

export function shouldRenderSinglePage(page: ComicPage, index: number, total: number) {
  return page.width > page.height || index === 0 || index === total - 1;
}

export function getPagedWindow(
  pages: ComicPage[],
  activeIndex: number,
  spreadEnabled: boolean,
  readingDirection?: ReadingDirection,
) {
  const current = pages[activeIndex];
  if (!current || !spreadEnabled || shouldRenderSinglePage(current, activeIndex, pages.length)) {
    return current ? [current] : [];
  }

  const next = pages[activeIndex + 1];
  if (!next || shouldRenderSinglePage(next, activeIndex + 1, pages.length)) {
    return [current];
  }

  return readingDirection === "RIGHT_TO_LEFT" ? [next, current] : [current, next];
}

export function clampPageIndex(index: number, total: number) {
  return Math.min(Math.max(index, 0), Math.max(total - 1, 0));
}
