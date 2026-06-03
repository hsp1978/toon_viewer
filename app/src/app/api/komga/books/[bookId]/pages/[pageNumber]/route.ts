import { fetchKomgaAsset } from "@/lib/komga-client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookId: string; pageNumber: string }> },
) {
  const { bookId, pageNumber } = await context.params;

  try {
    const upstream = await fetchKomgaAsset(
      `/api/v1/books/${encodeURIComponent(bookId)}/pages/${encodeURIComponent(pageNumber)}`,
    );
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      },
    });
  } catch {
    return Response.json({ error: "Unable to fetch Komga page image" }, { status: 502 });
  }
}
