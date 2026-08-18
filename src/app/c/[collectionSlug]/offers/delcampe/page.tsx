import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { DelcampeListingsPanel } from "./delcampe-listings-panel";

// *On Delcampe* (#611) — a sub-route of Offers, exactly as the bulk listing workspace and the
// Allegro worklist are: reconciling what is up on the marketplace is a step in the offer lifecycle
// rather than a separate area of the app. The static `delcampe` segment takes precedence over
// `[offerId]`, so no offer can be shadowed by it.

export const metadata = { title: "On Delcampe" };

interface DelcampeListingsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function DelcampeListingsPage({ params }: DelcampeListingsPageProps) {
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
          On Delcampe
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
      <DelcampeListingsPanel collectionId={collection.id} collectionSlug={collectionSlug} />
    </div>
  );
}
