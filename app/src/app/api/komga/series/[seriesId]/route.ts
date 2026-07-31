import { authorizeAdmin } from "@/lib/admin-auth";
import { deleteKomgaSeries } from "@/lib/komga-client";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  // This removes the series files from disk and cannot be undone, so it is
  // gated even though the read routes are open.
  const auth = authorizeAdmin(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

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
