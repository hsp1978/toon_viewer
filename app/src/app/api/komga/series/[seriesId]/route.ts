import { deleteKomgaSeries } from "@/lib/komga-client";

export async function DELETE(
  _request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  const { seriesId } = await context.params;

  try {
    const result = await deleteKomgaSeries(seriesId);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to delete Komga series" },
      { status: 502 },
    );
  }
}
