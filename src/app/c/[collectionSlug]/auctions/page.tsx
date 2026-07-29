import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { AuctionLotsPanel } from "./auction-lots-panel";

export const metadata = { title: "Auction lots" };

interface AuctionsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

/** The watchlist: every lot across every sale, which is where the daily job is done (ADR-0021 §9).
 * Its own nav entry since #376, beside — not above — the settlement screen at `sales/`. */
export default async function AuctionsPage({ params }: AuctionsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // The composition editor (#353) picks stamps by area and formats their catalog numbers from each
  // area's vendor map, exactly as the inventory screens do.
  const areas = await getCollectionAreas(session.user.id, collection.id);

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
        Auction lots
      </h2>
      <AuctionLotsPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        areas={areas}
      />
    </div>
  );
}
