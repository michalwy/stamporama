import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { signInPath } from "@/lib/sign-in-redirect";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { listContacts } from "@/lib/contacts";
import { SeriesFromSinglesPanel } from "./series-from-singles-panel";

// Series from singles (#1210; #754's design) — a nav entry of its own under Offers, beside the lot
// builder, on #502's reasoning. It answers one question per platform: which series the singles
// already listed there, together with the copies not offered there yet, could now complete. Acting
// on a listed series is #1211's.

export const metadata = { title: "Series from singles" };

interface SeriesFromSinglesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function SeriesFromSinglesPage({ params }: SeriesFromSinglesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const contacts = await listContacts(session.user.id, collection.id);
  const platforms = contacts.filter((c) => c.platform).map((c) => ({ id: c.id, name: c.name }));

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: "0.75rem", margin: "0 0 1.5rem" }}>
        <h2
          style={{
            margin: 0,
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          Series from singles
        </h2>
        <Link
          href={`/c/${collectionSlug}/offers`}
          style={{ fontSize: "0.8125rem", color: "var(--color-accent)", textDecoration: "none" }}
        >
          ← Back to offers
        </Link>
      </div>
      <SeriesFromSinglesPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        platforms={platforms}
      />
    </div>
  );
}
