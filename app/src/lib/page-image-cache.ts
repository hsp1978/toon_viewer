import { access, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Lighter copies of Komga page images for the reader, kept on disk.
 *
 * The library stores pages as quality-95 JPEGs with no chroma subsampling,
 * 1–2MB each, which is slow over mobile data. Resolution is left alone (pages
 * are ~720px wide, already below a phone's physical width); only the encoding
 * changes, to mozjpeg q85 with 4:4:4 chroma so coloured lettering stays crisp.
 * On sample pages this cut 43–51% at 37–42dB PSNR.
 *
 * Encoding takes ~0.5s a page, longer than sending the original over a fast
 * link, so a request never waits for it: a page that has not been converted
 * yet is served as the original while conversion runs in the background. The
 * reader warms the open episode and the next one (warmBookPages), so reading
 * in order mostly gets converted pages.
 */

const JPEG_OPTIONS = { quality: 85, mozjpeg: true, chromaSubsampling: "4:4:4" } as const;
// Bump when the encoding changes so old cache entries are not served.
const CACHE_VERSION = "q85-444";
// The production host is small; bound simultaneous downloads + encodes.
const MAX_CONCURRENT_ENCODES = 2;
const CONVERTIBLE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const SAFE_ID = /^[A-Za-z0-9_-]{1,64}$/;
const SAFE_PAGE = /^\d{1,6}$/;

type Sharp = typeof import("sharp");
let sharpPromise: Promise<Sharp | null> | undefined;

function loadSharp() {
  // Loaded lazily: sharp ships with Next as an optional dependency, and a host
  // without it should still serve original pages rather than fail to boot.
  sharpPromise ??= import("sharp")
    .then((module): Sharp => {
      const sharp = module.default;
      // Pages are converted once and then read from disk, so libvips' own
      // operation cache would only hold memory on a small host.
      sharp.cache(false);
      return sharp;
    })
    .catch(() => null);
  return sharpPromise;
}

function cacheRoot() {
  return process.env.PAGE_CACHE_DIR?.trim() || path.join(process.cwd(), ".page-cache");
}

/** Cache paths for a page, or undefined when the ids are not plain tokens (they end up in a path). */
function pageFiles(bookId: string, pageNumber: string) {
  if (!SAFE_ID.test(bookId) || !SAFE_PAGE.test(pageNumber)) return undefined;
  const base = path.join(cacheRoot(), CACHE_VERSION, bookId, pageNumber);
  // `.keep` marks a page whose original is already the better file (not
  // convertible, or re-encoding made it larger), so it is not retried.
  return { converted: `${base}.jpg`, keepOriginal: `${base}.keep` };
}

let activeEncodes = 0;
const waiting: Array<() => void> = [];

async function withEncodeSlot<T>(task: () => Promise<T>) {
  if (activeEncodes >= MAX_CONCURRENT_ENCODES) {
    await new Promise<void>((resolve) => waiting.push(resolve));
  }
  activeEncodes += 1;
  try {
    return await task();
  } finally {
    activeEncodes -= 1;
    waiting.shift()?.();
  }
}

/** The converted page if it is already on disk; never converts. */
export async function readConvertedPage(bookId: string, pageNumber: string) {
  const files = pageFiles(bookId, pageNumber);
  if (!files) return null;
  const body = await readFile(files.converted).catch(() => null);
  return body ? new Uint8Array(body) : null;
}

const inFlight = new Map<string, Promise<void>>();

/** Converts a page in the background if it has not been yet. Never throws. */
export function convertPageInBackground(
  bookId: string,
  pageNumber: string,
  fetchOriginal: () => Promise<Response>,
) {
  const files = pageFiles(bookId, pageNumber);
  if (!files || inFlight.has(files.converted)) return;

  const job = (async () => {
    const done = await Promise.any([access(files.converted), access(files.keepOriginal)]).then(
      () => true,
      () => false,
    );
    if (done) return;

    const sharp = await loadSharp();
    if (!sharp) return;

    // The download sits inside the slot too, so a queue of warm-ups never
    // holds more than a couple of originals in memory at once.
    await withEncodeSlot(async () => {
      const upstream = await fetchOriginal();
      const sourceType = upstream.headers.get("Content-Type")?.split(";")[0].trim() ?? "";
      const original = Buffer.from(await upstream.arrayBuffer());
      await mkdir(path.dirname(files.converted), { recursive: true });

      const encoded = CONVERTIBLE_TYPES.has(sourceType)
        ? await sharp(original).jpeg(JPEG_OPTIONS).toBuffer()
        : undefined;
      if (!encoded || encoded.length >= original.length) {
        await writeFile(files.keepOriginal, "");
        return;
      }

      const temp = `${files.converted}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temp, encoded);
      await rename(temp, files.converted);
    });
  })()
    .catch(() => undefined)
    .finally(() => inFlight.delete(files.converted));

  inFlight.set(files.converted, job);
}

/** Queues a book's pages for conversion in reading order, without waiting. */
export function warmBookPages(
  bookId: string,
  pageNumbers: string[],
  fetchOriginal: (pageNumber: string) => Promise<Response>,
) {
  for (const pageNumber of pageNumbers) {
    convertPageInBackground(bookId, pageNumber, () => fetchOriginal(pageNumber));
  }
}
