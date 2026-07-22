import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { SalesListPanel } from "./sales-list-panel";

export const metadata = { title: "Sales" };

interface SalesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function SalesPage({ params }: SalesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // Compute "today" at request time so the new-sale form defaults the date without SSR clock use.
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
        Sales
      </h2>
      <SalesListPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        today={today}
      />
    </div>
  );
}
