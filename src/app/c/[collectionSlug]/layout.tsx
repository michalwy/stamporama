import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug, getCollectionsByOwner } from "@/lib/collections";
import { QueryProvider } from "@/app/query-provider";
import { getAppVersionLabel } from "@/lib/version";
import { CollectionSidebar } from "./collection-sidebar";

interface CollectionLayoutProps {
  children: React.ReactNode;
  params: Promise<{ collectionSlug: string }>;
}

export default async function CollectionLayout({
  children,
  params,
}: CollectionLayoutProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const [collection, collections] = await Promise.all([
    getCollectionBySlug(session.user.id, collectionSlug),
    getCollectionsByOwner(session.user.id),
  ]);
  if (!collection) notFound();

  return (
    <div
      style={{
        display: "flex",
        minHeight: "100vh",
        background: "var(--color-bg-page)",
      }}
    >
      <CollectionSidebar
        collectionSlug={collectionSlug}
        collectionName={collection.name}
        collections={collections.map((c) => ({ slug: c.slug, name: c.name }))}
        appVersion={getAppVersionLabel()}
      />
      <main style={{ flex: 1, minWidth: 0 }}>
        <QueryProvider>{children}</QueryProvider>
      </main>
    </div>
  );
}
