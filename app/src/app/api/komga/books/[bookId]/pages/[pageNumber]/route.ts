import { fetchKomgaAsset } from "@/lib/komga-client";
import { convertPageInBackground, readConvertedPage } from "@/lib/page-image-cache";

const CACHE_CONTROL = "private, max-age=3600";

export async function GET(
  request: Request,
  context: { params: Promise<{ bookId: string; pageNumber: string }> },
) {
  const { bookId, pageNumber } = await context.params;
  const komgaPath = `/api/v1/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageNumber)}`;
  // The reader's "원본 화질" option asks for the untouched file.
  const wantsOriginal = new URL(request.url).searchParams.get("quality") === "original";

  if (!wantsOriginal) {
    const converted = await readConvertedPage(bookId, pageNumber);
    if (converted) {
      return new Response(converted as BodyInit, {
        headers: { "Cache-Control": CACHE_CONTROL, "Content-Type": "image/jpeg" },
      });
    }
    // Not converted yet: send the original now rather than wait on the encoder.
    convertPageInBackground(bookId, pageNumber, () => fetchKomgaAsset(komgaPath));
  }

  try {
    const upstream = await fetchKomgaAsset(komgaPath);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Cache-Control": CACHE_CONTROL,
        "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      },
    });
  } catch {
    return Response.json({ error: "Unable to fetch Komga page image" }, { status: 502 });
  }
}
