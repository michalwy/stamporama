import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getStampConditions } from "@/lib/conditions";
import { getStampFormats } from "@/lib/stamp-formats";
import { listContacts } from "@/lib/contacts";
import { LotBuilderPanel } from "./lot-builder-panel";

// The bulk-lot builder (#760) — a nav entry of its own under Offers, beside the bulk listing
// workspace, on #502's reasoning: views of one subject, the list leading. The static `lot-builder`
// segment takes precedence over `[offerId]`, so no offer can be shadowed by it.
//
// The dictionaries are read here rather than fetched, exactly as the Copies list reads its own: the
// criteria panel cannot draw a single control without them, and the screen would otherwise open on
// four empty selects.

export const metadata = { title: "Lot builder" };

interface LotBuilderPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function LotBuilderPage({ params }: LotBuilderPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // Locations join the dictionaries for the same reason the rest of them are here: the proposal
  // draws each picked copy with the app's own copy row, which names where the copy is filed.
  const [areas, locations, conditions, formats, contacts] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
    getStampConditions(session.user.id, collection.id),
    getStampFormats(session.user.id, collection.id),
    listContacts(session.user.id, collection.id),
  ]);

  // Every platform, not only the ones already carrying an offer (which is what
  // `offers/platforms` answers): a lot is a plausible *first* listing on a marketplace.
  const platforms = contacts
    .filter((c) => c.platform)
    .map((c) => ({ id: c.id, name: c.name, platformCurrency: c.platformCurrency }));

  return (
    <div
      style={{
        padding: "2rem",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: "0.75rem",
          margin: "0 0 1.5rem",
        }}
      >
        <h2
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Lot builder
        </h2>
        <Link
          href={`/c/${collectionSlug}/offers`}
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-accent)",
            textDecoration: "none",
          }}
        >
          ← Back to offers
        </Link>
      </div>
      <LotBuilderPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        areas={areas}
        locations={locations}
        conditions={conditions}
        formats={formats}
        platforms={platforms}
        baseCurrency={collection.baseCurrency}
      />
    </div>
  );
}
