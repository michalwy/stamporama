import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { IssuesListPanel } from "./issues-list-panel";

interface IssuesPageProps {
  params: Promise<{ collectionSlug: string }>;
}

export default async function IssuesPage({ params }: IssuesPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const areas = await getCollectionAreas(session.user.id, collection.id);

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
        Issues
      </h2>
      <IssuesListPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        areas={areas}
        baseCurrency={collection.baseCurrency}
      />
    </div>
  );
}
