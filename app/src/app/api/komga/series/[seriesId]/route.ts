import { authorizeAdmin } from "@/lib/admin-auth";
import { deleteKomgaSeries, setKomgaSeriesEnded } from "@/lib/komga-client";

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

export async function PATCH(
  request: Request,
  context: { params: Promise<{ seriesId: string }> },
) {
  // Writes series metadata back to Komga, so it sits behind the same token as
  // delete rather than being open like the read routes.
  const auth = authorizeAdmin(request);
  if (!auth.ok) {
    return Response.json({ error: auth.error }, { status: auth.status });
  }

  const body = (await request.json().catch(() => null)) as { ended?: unknown } | null;
  if (typeof body?.ended !== "boolean") {
    return Response.json({ error: "Body must be { ended: boolean }." }, { status: 400 });
  }

  const { seriesId } = await context.params;

  try {
    const result = await setKomgaSeriesEnded(seriesId, body.ended);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update Komga series" },
      { status: 502 },
    );
  }
}
