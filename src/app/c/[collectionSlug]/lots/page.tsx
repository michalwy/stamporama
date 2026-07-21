import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { LotsListPanel } from "./lots-list-panel";

export const metadata = { title: "Lots" };

interface LotsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function LotsPage({ params }: LotsPageProps) {
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
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Lots
      </h2>
      <LotsListPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
      />
    </div>
  );
}
