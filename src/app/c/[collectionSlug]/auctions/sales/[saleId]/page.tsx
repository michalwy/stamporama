import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getAuctionSaleIssueIds } from "@/lib/auction-lines";
import { getIssueHeadersByIds, type IssueHeader } from "@/lib/issues";
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

  // The composition editor picks stamps by area and prefix-formats catalog numbers from the area's
  // vendor map (#353), the same context every stamp-picking screen loads.
  const [areas, issueIds] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getAuctionSaleIssueIds(saleId),
  ]);
  // Issue headers for the composition's issue groups — the same lookup the offer detail does, so
  // the group headers carry their catalog chips and stamp count here too (#353).
  const issueHeaders = await getIssueHeadersByIds(session.user.id, collection.id, issueIds);
  const issueHeaderById: Record<string, IssueHeader> = {};
  for (const h of issueHeaders) issueHeaderById[h.id] = h;

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <AuctionSaleDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        saleId={saleId}
        areas={areas}
        issueHeaderById={issueHeaderById}
      />
    </div>
  );
}
