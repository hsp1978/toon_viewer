import type { Book, Catalog, Library, Series } from "./types";

export const libraries: Library[] = [
  {
    id: "library-webtoon",
    name: "Verticals",
    seriesCount: 1,
    bookCount: 2,
    description: "Long-strip titles",
  },
  {
    id: "library-comics",
    name: "Comics",
    seriesCount: 2,
    bookCount: 4,
    description: "Paged comics and manga",
  },
];

export const series: Series[] = [
  {
    id: "series-neon",
    libraryId: "library-webtoon",
    title: "Neon Staircase",
    subtitle: "Smartphone-first long strips",
    status: "Reading",
    tags: ["webtoon", "manhwa"],
    coverSrc: "/mock/neon-cover.svg",
    bookIds: ["book-neon-01", "book-neon-02"],
    bookCount: 2,
    completedBookCount: 0,
    progress: 34,
    primaryBookId: "book-neon-01",
    updatedAt: "2026-05-29",
  },
  {
    id: "series-orbit",
    libraryId: "library-comics",
    title: "Orbit Detective",
    subtitle: "Classic page turns with spreads",
    status: "Queued",
    tags: ["comic", "sci-fi"],
    coverSrc: "/mock/orbit-cover.svg",
    bookIds: ["book-orbit-01", "book-orbit-02"],
    bookCount: 2,
    completedBookCount: 0,
    progress: 21,
    primaryBookId: "book-orbit-01",
    updatedAt: "2026-05-18",
    readingDirection: "LEFT_TO_RIGHT",
  },
  {
    id: "series-garden",
    libraryId: "library-comics",
    title: "Silent Garden",
    subtitle: "Right-to-left manga sample",
    status: "Complete",
    tags: ["manga", "drama"],
    coverSrc: "/mock/garden-cover.svg",
    bookIds: ["book-garden-01", "book-garden-02"],
    bookCount: 2,
    completedBookCount: 1,
    progress: 58,
    primaryBookId: "book-garden-02",
    updatedAt: "2026-04-29",
    readingDirection: "RIGHT_TO_LEFT",
  },
];

export const books: Book[] = [
  {
    id: "book-neon-01",
    seriesId: "series-neon",
    title: "Episode 01 - Rainline",
    number: "1",
    updatedAt: "2026-05-29",
    progress: 68,
    readProgressPage: 1,
    tags: ["webtoon", "long strip"],
    pages: [
      { index: 0, number: 0, width: 900, height: 3600, src: "/mock/webtoon-01.svg", alt: "Neon Staircase long strip 1" },
      { index: 1, number: 1, width: 900, height: 3300, src: "/mock/webtoon-02.svg", alt: "Neon Staircase long strip 2" },
      { index: 2, number: 2, width: 900, height: 3900, src: "/mock/webtoon-03.svg", alt: "Neon Staircase long strip 3" },
    ],
  },
  {
    id: "book-neon-02",
    seriesId: "series-neon",
    title: "Episode 02 - Signal",
    number: "2",
    updatedAt: "2026-05-22",
    progress: 0,
    tags: ["webtoon"],
    readingDirection: "WEBTOON",
    pages: [
      { index: 0, number: 0, width: 900, height: 3400, src: "/mock/webtoon-02.svg", alt: "Neon Staircase episode 2 strip 1" },
      { index: 1, number: 1, width: 900, height: 3700, src: "/mock/webtoon-03.svg", alt: "Neon Staircase episode 2 strip 2" },
    ],
  },
  {
    id: "book-orbit-01",
    seriesId: "series-orbit",
    title: "Case File 01",
    number: "1",
    updatedAt: "2026-05-18",
    progress: 42,
    readProgressPage: 1,
    tags: ["comic"],
    readingDirection: "LEFT_TO_RIGHT",
    pages: [
      { index: 0, number: 0, width: 1200, height: 1800, src: "/mock/comic-page-01.svg", alt: "Orbit Detective cover page" },
      { index: 1, number: 1, width: 1200, height: 1800, src: "/mock/comic-page-02.svg", alt: "Orbit Detective page 2" },
      { index: 2, number: 2, width: 1800, height: 1200, src: "/mock/comic-spread.svg", alt: "Orbit Detective landscape spread" },
      { index: 3, number: 3, width: 1200, height: 1800, src: "/mock/comic-page-03.svg", alt: "Orbit Detective page 4" },
    ],
  },
  {
    id: "book-orbit-02",
    seriesId: "series-orbit",
    title: "Case File 02",
    number: "2",
    updatedAt: "2026-05-11",
    progress: 0,
    tags: ["comic"],
    pages: [
      { index: 0, number: 0, width: 1200, height: 1800, src: "/mock/comic-page-03.svg", alt: "Orbit Detective issue 2 page 1" },
      { index: 1, number: 1, width: 1200, height: 1800, src: "/mock/comic-page-01.svg", alt: "Orbit Detective issue 2 page 2" },
    ],
  },
  {
    id: "book-garden-01",
    seriesId: "series-garden",
    title: "Chapter 01",
    number: "1",
    updatedAt: "2026-04-29",
    progress: 100,
    readProgressPage: 2,
    tags: ["manga"],
    readingDirection: "RIGHT_TO_LEFT",
    pages: [
      { index: 0, number: 0, width: 1100, height: 1650, src: "/mock/manga-page-01.svg", alt: "Silent Garden page 1" },
      { index: 1, number: 1, width: 1100, height: 1650, src: "/mock/manga-page-02.svg", alt: "Silent Garden page 2" },
      { index: 2, number: 2, width: 1100, height: 1650, src: "/mock/manga-page-03.svg", alt: "Silent Garden page 3" },
    ],
  },
  {
    id: "book-garden-02",
    seriesId: "series-garden",
    title: "Chapter 02",
    number: "2",
    updatedAt: "2026-04-22",
    progress: 15,
    readProgressPage: 0,
    tags: ["manga"],
    pages: [
      { index: 0, number: 0, width: 1100, height: 1650, src: "/mock/manga-page-02.svg", alt: "Silent Garden chapter 2 page 1" },
      { index: 1, number: 1, width: 1100, height: 1650, src: "/mock/manga-page-03.svg", alt: "Silent Garden chapter 2 page 2" },
    ],
  },
];

export const mockCatalog: Catalog = {
  libraries,
  series,
  books,
};

export function getSeriesBooks(seriesId: string) {
  return books.filter((book) => book.seriesId === seriesId);
}
