import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCatalogTree } from "@/lib/catalog";
import { TradesListPanel } from "./trades-list-panel";

export const metadata = { title: "Trades" };

interface TradesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function TradesPage({ params }: TradesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // The catalog **vendors** a trade can name as the one both sides speak in (#638) — Michel,
  // StampWorld, Fischer. Not their individual books: *Michel Deutschland* prices nothing Polish, and
  // a trade routinely spans several areas. Read here rather than through a query hook, since the
  // list is a handful of rows that changes about once a year and the dialog needs it on open.
  const catalogVendors = (await getCatalogTree(session.user.id, collection.id)).map((v) => ({
    id: v.id,
    name: v.name,
    abbreviation: v.abbreviation,
  }));

  return (
    <div
      style={{
        padding: "2rem",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Trades
      </h2>
      <TradesListPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        catalogVendors={catalogVendors}
      />
    </div>
  );
}
