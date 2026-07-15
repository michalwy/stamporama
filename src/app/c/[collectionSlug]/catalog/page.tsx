import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCatalogTree } from "@/lib/catalog";
import { CatalogPanel } from "./catalog-panel";

interface CatalogPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function CatalogPage({ params }: CatalogPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const tree = await getCatalogTree(session.user.id, collection.id);

  return (
    <div style={{ padding: "2rem", maxWidth: "56rem" }}>
      <h2
        style={{
          margin: "0 0 2rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Catalog
      </h2>
      <CatalogPanel collectionId={collection.id} initialTree={tree} />
    </div>
  );
}
