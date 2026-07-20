import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getLocations } from "@/lib/locations";
import { LocationsPanel } from "./locations-panel";

export const metadata = { title: "Locations" };

interface LocationsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function LocationsPage({ params }: LocationsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const locations = await getLocations(session.user.id, collection.id);

  return (
    <div style={{ padding: "2rem", maxWidth: "56rem" }}>
      <h2
        style={{
          margin: "0 0 0.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Locations
      </h2>
      <p
        style={{
          margin: "0 0 1.5rem",
          fontSize: "0.9375rem",
          color: "var(--color-text-muted)",
          maxWidth: "42rem",
          lineHeight: 1.6,
        }}
      >
        Where your copies physically live — cabinets, stockbooks, albums, boxes. Nest
        them however your storage is organized; mark the ones that actually hold copies
        as assignable, then file inventory copies into them.
      </p>
      <LocationsPanel collectionId={collection.id} initialLocations={locations} />
    </div>
  );
}
