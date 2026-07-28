import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { AuctionSalesPanel } from "./auction-sales-panel";

export const metadata = { title: "Auction sales" };

interface AuctionSalesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

/** The settlement view: one row per parcel, with what it will cost. A static segment ahead of
 * `[saleId]`, like the offers routes. */
export default async function AuctionSalesPage({ params }: AuctionSalesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

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
        Auction sales
      </h2>
      <AuctionSalesPanel collectionId={collection.id} collectionSlug={collectionSlug} />
    </div>
  );
}
