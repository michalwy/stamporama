import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { PurchasesListPanel } from "./purchases-list-panel";

interface PurchasesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function PurchasesPage({ params }: PurchasesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // Compute "today" here (request time) so the new-purchase form defaults the date
  // without touching the clock during client render.
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
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Purchases
      </h2>
      <PurchasesListPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        today={today}
      />
    </div>
  );
}
