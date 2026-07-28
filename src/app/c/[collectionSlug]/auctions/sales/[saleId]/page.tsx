import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { AuctionSaleDetailPanel } from "./auction-sale-detail-panel";

export const metadata = { title: "Auction sale" };

interface AuctionSaleDetailPageProps {
  params: Promise<{ collectionSlug: string; saleId: string }>;
}

/** One settlement: its own terms, its parcel total, and its lots. */
export default async function AuctionSaleDetailPage({ params }: AuctionSaleDetailPageProps) {
  const { collectionSlug, saleId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AuctionSaleDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        saleId={saleId}
      />
    </div>
  );
}
