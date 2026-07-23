import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { OffersListPanel } from "./offers-list-panel";

export const metadata = { title: "Offers" };

interface OffersPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function OffersPage({ params }: OffersPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // Loaded here (like the Inventory page) so the quick-offer flow's add-copy step (#241) has the
  // taxonomy it needs without a client round-trip.
  const [conditions, certificateStatuses, areas, locations] = await Promise.all([
    getStampConditions(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
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
        Offers
      </h2>
      <OffersListPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        areas={areas}
        locations={locations}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
      />
    </div>
  );
}
