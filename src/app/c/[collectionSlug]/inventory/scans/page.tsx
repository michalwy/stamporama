import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getScanCounts } from "@/lib/scan-sheets";
import { ScansPanel } from "./scans-panel";

export const metadata: Metadata = { title: "Card scans" };

interface ScansPageProps {
  params: Promise<{ collectionSlug: string }>;
}

/**
 * Cataloguing from scans, with nothing bought (#725).
 *
 * Its own address rather than a dialog on the Copies list: digitising a collection runs over days
 * and dozens of cards, and the section it opens on remembers where the pass stopped — which is a
 * thing to come back to, and a thing to come back to needs a URL.
 *
 * Under `inventory/` beside `inventory/[itemId]`, the same shape `stamps/variant-prices` has beside
 * `stamps/[stampId]`: what it produces is copies, so it belongs where the copies are.
 */
export default async function ScansPage({ params }: ScansPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [conditions, certificateStatuses, areas, locations, counts] = await Promise.all([
    getStampConditions(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
    // The header's three figures, so the section can say what is inside while still collapsed —
    // the order screen gets the same three from `getPurchaseDetail`.
    getScanCounts(session.user.id, { collectionId: collection.id }),
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
      <header style={{ marginBottom: "1.25rem" }}>
        <h1
          style={{
            margin: 0,
            fontSize: "1.5rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Card scans
        </h1>
        <p
          style={{
            margin: "0.375rem 0 0",
            fontSize: "0.8125rem",
            color: "var(--color-text-secondary)",
            maxWidth: "48rem",
          }}
        >
          Scan a whole stockbook card, cut it into pieces, and identify each one into the
          collection. For stamps already owned — nothing here is filed against a purchase, so the
          copies carry no cost. Cards that came in a parcel are on that order&rsquo;s own screen.
        </p>
      </header>

      <ScansPanel
        collectionId={collection.id}
        areas={areas}
        // What this collection scans at (#598) — the scale the ruler and the perforation gauge in
        // the tile viewer convert with.
        scanDpi={collection.scanDpi}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
        locations={locations}
        unidentifiedTileCount={counts.unidentifiedTileCount}
        parkedTileCount={counts.parkedTileCount}
        scanSheetCount={counts.scanSheetCount}
      />
    </div>
  );
}
