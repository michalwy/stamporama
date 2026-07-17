import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getCatalogNames } from "@/lib/catalog";
import { AreasPanel } from "./areas-panel";

interface AreasPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function AreasPage({ params }: AreasPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [areas, catalogNames] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getCatalogNames(session.user.id, collection.id),
  ]);

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
        Collection Areas
      </h2>
      <AreasPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        initialAreas={areas}
        catalogNames={catalogNames}
      />
    </div>
  );
}
