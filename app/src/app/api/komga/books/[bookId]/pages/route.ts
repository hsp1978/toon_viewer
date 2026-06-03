import { getKomgaBookPages } from "@/lib/komga-client";

export async function GET(
  _request: Request,
  context: { params: Promise<{ bookId: string }> },
) {
  const { bookId } = await context.params;

  try {
    const pages = await getKomgaBookPages(bookId);
    return Response.json({ pages });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "Unable to fetch Komga page metadata" },
      { status: 502 },
    );
  }
}
