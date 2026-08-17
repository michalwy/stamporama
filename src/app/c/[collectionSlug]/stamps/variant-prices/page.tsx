import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { VariantPricesPanel } from "./variant-prices-panel";

// The variant-pricing worklist (#618) — a sub-route of Stamps, since what it lists is stamps, and a
// screen of its own rather than a filter on that list because it answers a question the list cannot:
// which *trees* are not fully priced. The static `variant-prices` segment takes precedence over
// `[stampId]`, which is a cuid, so no stamp can be shadowed by it.

export const metadata = { title: "Variant prices" };

interface VariantPricesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function VariantPricesPage({ params }: VariantPricesPageProps) {
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
          Variant prices
        </h2>
        <Link
          href={`/c/${collectionSlug}/stamps`}
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-accent)",
            textDecoration: "none",
          }}
        >
          ← Back to stamps
        </Link>
      </div>
      <VariantPricesPanel collectionId={collection.id} />
    </div>
  );
}
