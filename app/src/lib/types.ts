export type ReadingDirection =
  | "LEFT_TO_RIGHT"
  | "RIGHT_TO_LEFT"
  | "VERTICAL"
  | "WEBTOON";

export type ReaderMode = "auto" | "paged" | "webtoon";
export type InferredReaderMode = Exclude<ReaderMode, "auto">;
export type CatalogSource = "mock" | "komga";

export type ComicPage = {
  index: number;
  number: number;
  width: number;
  height: number;
  src: string;
  alt: string;
};

export type Library = {
  id: string;
  name: string;
  seriesCount: number;
  bookCount: number;
  description: string;
};

export type Series = {
  id: string;
  libraryId: string;
  title: string;
  subtitle: string;
  status: "Reading" | "Queued" | "Complete";
  tags: string[];
  coverSrc: string;
  bookIds: string[];
  bookCount: number;
  completedBookCount: number;
  progress: number;
  primaryBookId?: string;
  updatedAt: string;
  readingDirection?: ReadingDirection;
};

export type Book = {
  id: string;
  seriesId: string;
  title: string;
  number: string;
  updatedAt: string;
  progress: number;
  readProgressPage?: number;
  pageCount?: number;
  pages: ComicPage[];
  tags: string[];
  readingDirection?: ReadingDirection;
};

export type Catalog = {
  libraries: Library[];
  series: Series[];
  books: Book[];
};

export type CatalogOverview = Omit<Catalog, "books">;

export type CatalogSnapshot = {
  catalog: CatalogOverview;
  source: CatalogSource;
  warning?: string;
};

export type SeriesBooksSnapshot = {
  seriesId: string;
  books: Book[];
  source: CatalogSource;
  warning?: string;
};
