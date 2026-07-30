import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { QueryProvider } from "@/app/query-provider";
import { getAppVersionLabel } from "@/lib/version";
import { CollectionSidebar } from "./collection-sidebar";

interface CollectionLayoutProps {
  children: React.ReactNode;
  params: Promise<{ collectionSlug: string }>;
}

// Scope browser tab titles to the current collection: child views set their own
// short title (e.g. "Purchases") and it renders as "Purchases — <Collection>" (#140).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ collectionSlug: string }>;
}): Promise<Metadata> {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) return {};

  return {
    title: {
      default: `${collection.name} — Stamporama`,
      template: `%s — ${collection.name} — Stamporama`,
    },
  };
}

export default async function CollectionLayout({
  children,
  params,
}: CollectionLayoutProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  // The sidebar names one collection and links to the collections page for the rest, so this layout
  // no longer loads the owner's other collections on every screen.
  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  return (
    // The provider wraps the **whole** shell rather than only the page: the sidebar's notification
    // centre (#367) is a query too, and one client is also one cache — a screen and the badge above
    // it read the same collection.
    <QueryProvider>
      <div
        style={{
          display: "flex",
          minHeight: "100vh",
          background: "var(--color-bg-page)",
        }}
      >
        <CollectionSidebar
          collectionSlug={collectionSlug}
          collectionId={collection.id}
          collectionName={collection.name}
          appVersion={getAppVersionLabel()}
        />
        <main style={{ flex: 1, minWidth: 0 }}>{children}</main>
      </div>
    </QueryProvider>
  );
}
