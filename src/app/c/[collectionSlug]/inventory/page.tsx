import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getCollectionAreas } from "@/lib/areas";
import { InventoryListPanel } from "./inventory-list-panel";

interface InventoryPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function InventoryPage({ params }: InventoryPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [conditions, certificateStatuses, areas] = await Promise.all([
    getStampConditions(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getCollectionAreas(session.user.id, collection.id),
  ]);

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
        Inventory
      </h2>
      <InventoryListPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        areas={areas}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
        baseCurrency={collection.baseCurrency}
      />
    </div>
  );
}
