import { fetchKomgaAsset, getKomgaBookPages, getNextKomgaBookId } from "@/lib/komga-client";
import { warmBookPages } from "@/lib/page-image-cache";
import type { ComicPage } from "@/lib/types";

function warmKomgaPages(bookId: string, pages: ComicPage[]) {
  // Mock pages are static files, not Komga pages.
  const pageNumbers = pages.filter((page) => page.src.startsWith("/api/komga/books/")).map((page) => String(page.number));
  warmBookPages(bookId, pageNumbers, (pageNumber) =>
    fetchKomgaAsset(`/api/v1/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageNumber)}`),
  );
}

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await context.params;

  try {
    const pages = await getKomgaBookPages(bookId);

    // Opening an episode converts it and the next one in the background, so
    // reading in order is served the lighter pages (src/lib/page-image-cache.ts).
    warmKomgaPages(bookId, pages);
    void getNextKomgaBookId(bookId)
      .then(async (nextBookId) => {
        if (nextBookId) warmKomgaPages(nextBookId, await getKomgaBookPages(nextBookId));
      })
      .catch(() => undefined);

    return Response.json({ pages });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to fetch Komga page metadata" },
      { status: 502 },
    );
  }
}
