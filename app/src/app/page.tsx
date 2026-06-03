import { CatalogShell } from "@/components/catalog-shell";
import { getCatalogSnapshot } from "@/lib/komga-client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getCatalogSnapshot();
  return <CatalogShell catalog={snapshot.catalog} source={snapshot.source} warning={snapshot.warning} />;
}
