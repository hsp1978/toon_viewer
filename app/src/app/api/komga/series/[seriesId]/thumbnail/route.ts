import { fallbackCoverSrc, fetchKomgaAsset } from "@/lib/komga-client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  const { seriesId } = await context.params;

  try {
    const upstream = await fetchKomgaAsset(`/api/v1/series/${encodeURIComponent(seriesId)}/thumbnail`);
    return new Response(upstream.body, {
      status: upstream.status,
      headers: {
        "Cache-Control": "private, max-age=3600",
        "Content-Type": upstream.headers.get("Content-Type") ?? "image/jpeg",
      },
    });
  } catch {
    return Response.redirect(new URL(fallbackCoverSrc(), _request.url));
  }
}
