import { getSeriesBooksSnapshot } from "@/lib/komga-client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  const { seriesId } = await context.params;

  try {
    const snapshot = await getSeriesBooksSnapshot(seriesId);
    return Response.json(snapshot);
  } catch (error) {
    return Response.json(
      {
        error: error instanceof Error ? error.message : "Unable to fetch Komga series books",
        books: [],
      },
      { status: 502 },
    );
  }
}
