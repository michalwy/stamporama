import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getCatalogTree } from "@/lib/catalog";
import { getTrade } from "@/lib/trades";
import { TradeDetailPanel } from "./trade-detail-panel";

interface TradeDetailPageProps {
  params: Promise<{ collectionSlug: string; tradeId: string }>;
}

export async function generateMetadata({ params }: TradeDetailPageProps): Promise<Metadata> {
  const { tradeId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const trade = await getTrade(session.user.id, tradeId);
  if (!trade) return {};
  return { title: `Trade #${trade.tradeNo} — ${trade.partnerName}` };
}

/** One exchange: its terms, its sections, and the two sides of each (#637). */
export default async function TradeDetailPage({ params }: TradeDetailPageProps) {
  const { collectionSlug, tradeId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const trade = await getTrade(session.user.id, tradeId);
  if (!trade || trade.collectionId !== collection.id) notFound();

  // The context every stamp- and copy-picking screen loads: areas for the picker tree and for
  // prefix-formatting catalog numbers (#357), locations for the copy rows, and the catalog vendors
  // the header dialog offers as the agreed catalog.
  const [areas, locations, catalogVendors] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
    getCatalogTree(session.user.id, collection.id),
  ]);

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <TradeDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        tradeId={tradeId}
        baseCurrency={collection.baseCurrency}
        areas={areas}
        locations={locations}
        catalogVendors={catalogVendors.map((v) => ({
          id: v.id,
          name: v.name,
          abbreviation: v.abbreviation,
        }))}
      />
    </div>
  );
}
