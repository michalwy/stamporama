import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getLocations } from "@/lib/locations";
import { buildLocationPath } from "@/lib/location-path";
import { Screen } from "@/app/screen";
import { LocationHistoryPanel } from "./location-history-panel";

interface LocationHistoryPageProps {
  params: Promise<{ collectionSlug: string; locationId: string }>;
}

export const metadata: Metadata = { title: "Location history" };

/**
 * A location's history (#2277): every copy that came into it and every copy that left it, newest
 * first, narrowed by ref and by day. A location that groups others shows the moves of everything
 * under it. Opened from the location's row on the Locations screen and from any place named in a
 * copy's own history.
 */
export default async function LocationHistoryPage({ params }: LocationHistoryPageProps) {
  const { collectionSlug, locationId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const locations = await getLocations(session.user.id, collection.id);
  const location = locations.find((l) => l.id === locationId);
  if (!location) notFound();

  return (
    <Screen>
      <h2
        style={{
          margin: "0 0 0.25rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
          display: "flex",
          alignItems: "baseline",
          gap: "0.75rem",
          flexWrap: "wrap",
        }}
      >
        {buildLocationPath(locations, location.id) ?? location.name}
        <span
          style={{
            fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            fontSize: "0.9375rem",
            color: "var(--color-text-secondary)",
          }}
        >
          {location.fullCode}
        </span>
      </h2>
      <p style={{ margin: "0 0 1rem", fontSize: "0.9375rem", color: "var(--color-text-muted)" }}>
        {location.assignable
          ? "What came into this location and what left it."
          : "What came into the locations under this one and what left them."}
      </p>
      <LocationHistoryPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        locationId={location.id}
      />
    </Screen>
  );
}
