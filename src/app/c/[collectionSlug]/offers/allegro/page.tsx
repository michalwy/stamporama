import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { AllegroWorklistPanel } from "./allegro-worklist-panel";

// The Allegro sold-listing worklist (#467) — a sub-route of Offers, exactly as the bulk listing
// workspace is (#322): recording what has sold is a step in the offer lifecycle rather than a
// separate area of the app, so the sidebar's Offers entry stays current while you are here. The
// static `allegro` segment takes precedence over `[offerId]`, so no offer can be shadowed by it.

export const metadata = { title: "Sold on Allegro" };

interface AllegroWorklistPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function AllegroWorklistPage({ params }: AllegroWorklistPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // Computed at request time, like the offers list: the sell flow's new-sale step defaults its date
  // from it, and an SSR clock read inside the dialog would disagree with the collector's own day.
  const today = new Date().toISOString().slice(0, 10);

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
          Sold on Allegro
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
      <AllegroWorklistPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        today={today}
      />
    </div>
  );
}
