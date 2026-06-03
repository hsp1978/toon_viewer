import { updateKomgaReadProgress } from "@/lib/komga-client";

export async function POST(
  request: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await context.params;
  const payload = (await request.json().catch(() => ({}))) as { page?: unknown; completed?: unknown };
  const page = Number(payload.page);

  if (!Number.isFinite(page) || page < 0) {
    return Response.json({ error: "Invalid page" }, { status: 400 });
  }

  try {
    const result = await updateKomgaReadProgress(bookId, page, payload.completed === true);
    return Response.json(result);
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to update Komga read progress" },
      { status: 502 },
    );
  }
}
