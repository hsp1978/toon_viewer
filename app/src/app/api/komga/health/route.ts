import { checkKomgaConnection } from "@/lib/komga-client";

export async function GET() {
  const result = await checkKomgaConnection();
  return Response.json(result);
}
