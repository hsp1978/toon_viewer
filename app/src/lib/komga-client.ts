import { books as mockBooks, mockCatalog } from "./mock-komga";
import type {
  Book,
  CatalogOverview,
  CatalogSnapshot,
  ComicPage,
  Library,
  ReadingDirection,
  Series,
  SeriesBooksSnapshot,
} from "./types";

type KomgaConfig = {
  baseUrl?: string;
  apiKey?: string;
  username?: string;
  password?: string;
  forceMock: boolean;
  maxListPages: number;
  bootstrapBookLimit: number;
};

type UnknownRecord = Record<string, unknown>;

const defaultCover = "/mock/orbit-cover.svg";
const mockCatalogOverview: CatalogOverview = {
  libraries: mockCatalog.libraries,
  series: mockCatalog.series,
};

function normalizeCatalogMode(value: string | undefined) {
  const mode = value?.trim().toLowerCase();
  return mode === "mock" || mode === "komga" ? mode : undefined;
}

/**
 * Resolves mock vs. live catalog mode.
 *
 * `CATALOG_MODE` is read at runtime, so it can be corrected with a restart.
 * `NEXT_PUBLIC_CATALOG_MODE` is inlined at build time by Next, which means a
 * build done without the right env file bakes the wrong mode in permanently.
 * It is still honoured for existing setups, but the runtime value always wins
 * so a bad build can be recovered without rebuilding.
 */
export function resolveCatalogMode(): "mock" | "komga" {
  const runtime = normalizeCatalogMode(process.env.CATALOG_MODE);
  if (runtime) return runtime;

  const buildTime = normalizeCatalogMode(process.env.NEXT_PUBLIC_CATALOG_MODE);
  if (buildTime) return buildTime;

  // No explicit mode: infer from whether Komga is actually configured, so a
  // missing env file degrades to an obvious connection error rather than
  // silently serving mock data that looks like a working library.
  return process.env.KOMGA_BASE_URL?.trim() ? "komga" : "mock";
}

export function getKomgaConfig(): KomgaConfig {
  return {
    baseUrl: process.env.KOMGA_BASE_URL,
    apiKey: process.env.KOMGA_API_KEY,
    username: process.env.KOMGA_USERNAME,
    password: process.env.KOMGA_PASSWORD,
    forceMock: resolveCatalogMode() === "mock" || process.env.KOMGA_FORCE_MOCK === "true",
    maxListPages: Number(process.env.KOMGA_MAX_LIST_PAGES ?? 20),
    bootstrapBookLimit: Number(process.env.KOMGA_BOOTSTRAP_BOOK_LIMIT ?? 40),
  };
}

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function getNestedRecord(value: unknown, key: string) {
  if (!isRecord(value)) return undefined;
  const nested = value[key];
  return isRecord(nested) ? nested : undefined;
}

function getString(value: unknown, fallback = "") {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function getNumber(value: unknown, fallback = 0) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function getStringArray(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string" && item.trim().length > 0);
}

function getReadingDirection(value: unknown): ReadingDirection | undefined {
  if (value === "LEFT_TO_RIGHT" || value === "RIGHT_TO_LEFT" || value === "VERTICAL" || value === "WEBTOON") {
    return value;
  }
  return undefined;
}

function getTimestamp(value: string) {
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function getLatestDateString(values: string[]) {
  return values
    .filter(Boolean)
    .sort((a, b) => getTimestamp(b) - getTimestamp(a))[0] ?? "";
}


function getContentArray(value: unknown): UnknownRecord[] {
  if (Array.isArray(value)) return value.filter(isRecord);
  if (!isRecord(value)) return [];

  for (const key of ["content", "data", "items", "results"]) {
    const nested = value[key];
    if (Array.isArray(nested)) {
      return nested.filter(isRecord);
    }
  }

  return [];
}

function buildHeaders(config: KomgaConfig, init?: HeadersInit) {
  const headers = new Headers(init);
  headers.set("Accept", headers.get("Accept") ?? "application/json");

  if (config.apiKey) {
    headers.set("X-API-Key", config.apiKey);
  }

  if (config.username && config.password && !headers.has("Authorization")) {
    const encoded = Buffer.from(`${config.username}:${config.password}`).toString("base64");
    headers.set("Authorization", `Basic ${encoded}`);
  }

  return headers;
}

function komgaUrl(path: string, config: KomgaConfig) {
  if (!config.baseUrl) {
    throw new Error("KOMGA_BASE_URL is not configured");
  }
  return new URL(path, config.baseUrl);
}

async function komgaFetch(path: string, init: RequestInit = {}, config = getKomgaConfig()) {
  const response = await fetch(komgaUrl(path, config), {
    ...init,
    headers: buildHeaders(config, init.headers),
    cache: "no-store",
  });

  if (!response.ok) {
    throw new Error(`${path} returned ${response.status}`);
  }

  return response;
}

async function getJson(path: string, config: KomgaConfig) {
  const response = await komgaFetch(path, {}, config);
  return response.json() as Promise<unknown>;
}

async function postJson(path: string, body: unknown, config: KomgaConfig) {
  const response = await komgaFetch(
    path,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    config,
  );
  return response.json() as Promise<unknown>;
}

async function patchJson(path: string, body: unknown, config: KomgaConfig) {
  return komgaFetch(
    path,
    {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    },
    config,
  );
}

async function getPagedRecords(path: string, config: KomgaConfig, method: "GET" | "POST" = "GET") {
  const records: UnknownRecord[] = [];
  const pageSize = 200;

  for (let page = 0; page < config.maxListPages; page += 1) {
    const separator = path.includes("?") ? "&" : "?";
    const pagePath = `${path}${separator}page=${page}&size=${pageSize}`;
    const payload = method === "POST" ? await postJson(pagePath, {}, config) : await getJson(pagePath, config);
    const pageRecords = getContentArray(payload);
    records.push(...pageRecords);

    if (isRecord(payload) && payload.last === true) break;
    if (pageRecords.length < pageSize) break;
  }

  return records;
}

async function getSeriesRecords(config: KomgaConfig) {
  try {
    return await getPagedRecords("/api/v1/series/list", config, "POST");
  } catch {
    return getPagedRecords("/api/v1/series", config, "GET");
  }
}

async function getBookRecords(config: KomgaConfig) {
  try {
    return await getPagedRecords("/api/v1/books/list", config, "POST");
  } catch {
    return getPagedRecords("/api/v1/books", config, "GET");
  }
}

async function getBooksForSeriesRecords(seriesId: string, config: KomgaConfig) {
  try {
    return await getPagedRecords(`/api/v1/series/${encodeURIComponent(seriesId)}/books`, config, "GET");
  } catch {
    const records = await getBookRecords(config);
    return records.filter((record) => getString(record.seriesId) === seriesId);
  }
}

async function fetchBookPages(bookId: string, config: KomgaConfig): Promise<ComicPage[]> {
  const payload = await getJson(`/api/v1/books/${bookId}/pages`, config);
  return getContentArray(payload).map((page, index) => {
    const number = getNumber(page.number, index);
    const width = getNumber(page.width, 1200);
    const height = getNumber(page.height, 1800);
    return {
      index,
      number,
      width,
      height,
      src: `/api/komga/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(String(number))}`,
      alt: `Book ${bookId} page ${number + 1}`,
    };
  });
}

function normalizeLibrary(record: UnknownRecord): Library {
  const id = getString(record.id, crypto.randomUUID());
  const name = getString(record.name, "Library");
  return {
    id,
    name,
    seriesCount: getNumber(record.seriesCount, 0),
    bookCount: getNumber(record.bookCount, 0),
    description: getString(record.root, "Komga library"),
  };
}

function normalizeSeries(record: UnknownRecord, books: Book[], includeBookIds = false): Series {
  const metadata = getNestedRecord(record, "metadata") ?? {};
  const id = getString(record.id, crypto.randomUUID());
  const libraryId = getString(record.libraryId, getString(record.library?.toString(), "komga"));
  const title = getString(metadata.title, getString(record.name, getString(record.title, "Untitled series")));
  const tags = [
    ...getStringArray(metadata.tags),
    ...getStringArray(metadata.genres),
    ...getStringArray(record.tags),
  ];
  const seriesBooks = books.filter((book) => book.seriesId === id);
  const bookIds = seriesBooks.map((book) => book.id);
  const completedBookCount = seriesBooks.filter((book) => book.progress >= 100).length;
  const progress =
    seriesBooks.length > 0
      ? Math.min(100, Math.max(0, Math.round(seriesBooks.reduce((sum, book) => sum + book.progress, 0) / seriesBooks.length)))
      : 0;
  const complete = bookIds.length > 0 && completedBookCount === bookIds.length;
  const reading = seriesBooks.some((book) => book.progress > 0 && book.progress < 100);
  const primaryBook =
    seriesBooks.find((book) => book.progress > 0 && book.progress < 100) ??
    seriesBooks.find((book) => book.progress < 100) ??
    seriesBooks[0];
  const bookCount = getNumber(record.booksCount, seriesBooks.length);
  const updatedAt = getLatestDateString([
    ...seriesBooks.map((book) => book.updatedAt),
    getString(record.lastModified),
    getString(record.fileLastModified),
    getString(record.created),
    getString(record.updatedDate),
    getString(record.createdDate),
  ]);

  return {
    id,
    libraryId,
    title,
    subtitle: getString(metadata.summary, `${bookCount}개 회차`),
    status: complete ? "Complete" : reading ? "Reading" : "Queued",
    tags,
    coverSrc: `/api/komga/series/${encodeURIComponent(id)}/thumbnail`,
    bookIds: includeBookIds ? bookIds : [],
    bookCount,
    completedBookCount,
    progress,
    primaryBookId: primaryBook?.id,
    updatedAt,
    readingDirection: getReadingDirection(metadata.readingDirection ?? record.readingDirection),
  };
}

function normalizeBook(record: UnknownRecord, pages: ComicPage[]): Book {
  const metadata = getNestedRecord(record, "metadata") ?? {};
  const readProgress = getNestedRecord(record, "readProgress");
  const media = getNestedRecord(record, "media") ?? {};
  const id = getString(record.id, crypto.randomUUID());
  const seriesId = getString(record.seriesId, "");
  const pageCount = pages.length || getNumber(media.pagesCount, getNumber(record.pagesCount, 0));
  const hasReadProgress = readProgress !== undefined;
  const progressPage = hasReadProgress ? Math.max(0, Math.floor(getNumber(readProgress.page, 0))) : 0;
  const completed = readProgress?.completed === true;
  const progress = completed
    ? 100
    : hasReadProgress && pageCount > 0
      ? Math.min(99, Math.round(((progressPage + 1) / pageCount) * 100))
      : 0;

  return {
    id,
    seriesId,
    title: getString(metadata.title, getString(record.name, getString(record.title, "Untitled book"))),
    number: getString(metadata.number, getString(record.number, "")),
    updatedAt: getLatestDateString([
      getString(record.lastModified),
      getString(record.fileLastModified),
      getString(record.updatedDate),
      getString(record.createdDate),
      getString(record.created),
    ]),
    progress,
    readProgressPage: hasReadProgress ? progressPage : undefined,
    pageCount,
    pages,
    tags: [...getStringArray(metadata.tags), ...getStringArray(metadata.genres), ...getStringArray(record.tags)],
    readingDirection: getReadingDirection(metadata.readingDirection ?? record.readingDirection),
  };
}

function attachCounts(libraries: Library[], series: Series[], books: Book[]) {
  return libraries.map((library) => {
    const librarySeries = series.filter((item) => item.libraryId === library.id);
    const libraryBookCount = librarySeries.reduce((count, item) => count + item.bookCount, 0);
    return {
      ...library,
      seriesCount: library.seriesCount || librarySeries.length,
      bookCount: library.bookCount || libraryBookCount || books.length,
    };
  });
}

async function getKomgaCatalogOverview(config: KomgaConfig): Promise<CatalogOverview> {
  const libraryRecords = await getJson("/api/v1/libraries", config).then(getContentArray);
  const rawBooks = await getBookRecords(config);
  const books = rawBooks.map((record) => normalizeBook(record, []));
  // Komga keeps a deleted series in its trash until the trash is emptied, so
  // a series whose files are gone would otherwise linger in the catalog.
  const seriesRecords = (await getSeriesRecords(config)).filter((record) => record.deleted !== true);
  const series = seriesRecords.map((record) => normalizeSeries(record, books));
  const libraries = attachCounts(libraryRecords.map(normalizeLibrary), series, books);

  return { libraries, series };
}

async function getKomgaSeriesBooks(seriesId: string, config: KomgaConfig) {
  const rawBooks = await getBooksForSeriesRecords(seriesId, config);
  const bootstrapBookIds = new Set(
    rawBooks
      .slice(0, config.bootstrapBookLimit)
      .map((record) => getString(record.id))
      .filter(Boolean),
  );

  return Promise.all(
    rawBooks.map(async (record) => {
      const id = getString(record.id);
      const pages = id && bootstrapBookIds.has(id) ? await fetchBookPages(id, config).catch(() => []) : [];
      return normalizeBook(record, pages);
    }),
  );
}

export async function getKomgaBookPages(bookId: string) {
  const config = getKomgaConfig();
  if (config.forceMock || !config.baseUrl) {
    return mockBooks.find((book) => book.id === bookId)?.pages ?? [];
  }

  return fetchBookPages(bookId, config);
}

export async function getSeriesBooksSnapshot(seriesId: string): Promise<SeriesBooksSnapshot> {
  const config = getKomgaConfig();
  if (config.forceMock || !config.baseUrl) {
    return {
      seriesId,
      books: mockBooks.filter((book) => book.seriesId === seriesId),
      source: "mock",
    };
  }

  return {
    seriesId,
    books: await getKomgaSeriesBooks(seriesId, config),
    source: "komga",
  };
}

export async function updateKomgaReadProgress(bookId: string, page: number, completed: boolean) {
  const config = getKomgaConfig();
  if (config.forceMock || !config.baseUrl) {
    return { ok: true, mode: "mock" as const };
  }

  await patchJson(
    `/api/v1/books/${encodeURIComponent(bookId)}/read-progress`,
    { page, completed },
    config,
  );

  return { ok: true, mode: "komga" as const };
}

export async function deleteKomgaSeries(seriesId: string) {
  const config = getKomgaConfig();
  if (config.forceMock || !config.baseUrl) {
    return { ok: true, mode: "mock" as const };
  }

  await komgaFetch(
    `/api/v1/series/${encodeURIComponent(seriesId)}/file`,
    { method: "DELETE" },
    config,
  );

  return { ok: true, mode: "komga" as const };
}

export async function getCatalogSnapshot(): Promise<CatalogSnapshot> {
  const config = getKomgaConfig();
  if (config.forceMock || !config.baseUrl) {
    return { catalog: mockCatalogOverview, source: "mock" };
  }

  try {
    return { catalog: await getKomgaCatalogOverview(config), source: "komga" };
  } catch (error) {
    return {
      catalog: mockCatalogOverview,
      source: "mock",
      warning: error instanceof Error ? error.message : "Failed to read Komga catalog",
    };
  }
}

export async function checkKomgaConnection() {
  const config = getKomgaConfig();
  if (config.forceMock || !config.baseUrl) {
    return { ok: true, mode: "mock" as const };
  }

  try {
    const response = await komgaFetch("/api/v1/libraries", {}, config);

    // Reaching /libraries only proves the credentials work. A deploy can still
    // be pointed at an empty or wrong Komga, so confirm real content is
    // visible — that is what makes this usable as a deploy gate.
    const libraries = getContentArray(await response.clone().json().catch(() => []));
    const seriesPage = await getJson("/api/v1/series?size=1", config);
    const totalSeries = isRecord(seriesPage) ? getNumber(seriesPage.totalElements, 0) : 0;

    return {
      ok: response.ok && totalSeries > 0,
      mode: "komga" as const,
      status: response.status,
      libraries: libraries.length,
      series: totalSeries,
      ...(totalSeries === 0 ? { warning: "Komga is reachable but exposes no series" } : {}),
    };
  } catch (error) {
    return {
      ok: false,
      mode: "komga" as const,
      error: error instanceof Error ? error.message : "Unknown connection error",
    };
  }
}

export async function fetchKomgaAsset(path: string) {
  const config = getKomgaConfig();
  return komgaFetch(
    path,
    {
      headers: { Accept: "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8" },
    },
    config,
  );
}

export function fallbackCoverSrc() {
  return defaultCover;
}
