import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { OverviewPanel } from "./overview-panel";

export const metadata = { title: "Overview" };

interface CollectionPageProps {
  params: Promise<{ collectionSlug: string }>;
}

// The collection's Overview (#649; decided in #397): a financial and progress picture, replacing
// the placeholder this route shipped as. The figures are client queries — the shell renders at
// once and each section loads on its own.
export default async function CollectionPage({ params }: CollectionPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    <div style={{ padding: "2rem", minHeight: "100vh" }}>
      <h2
        style={{
          margin: "0 0 1.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Overview
      </h2>
      <OverviewPanel collectionId={collection.id} collectionSlug={collectionSlug} />
    </div>
  );
}
