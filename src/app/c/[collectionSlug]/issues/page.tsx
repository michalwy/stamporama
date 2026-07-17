import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { listAllIssues } from "@/lib/issues";
import { IssuesListPanel } from "./issues-list-panel";

interface IssuesPageProps {
  params: Promise<{ collectionSlug: string }>;
  searchParams: Promise<{ areaId?: string }>;
}

export default async function IssuesPage({ params, searchParams }: IssuesPageProps) {
  const { collectionSlug } = await params;
  const { areaId: filterAreaId } = await searchParams;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const areas = await getCollectionAreas(session.user.id, collection.id);

  // Resolve descendant area IDs for the filter (include selected area + all its descendants)
  function collectDescendantIds(rootId: string): string[] {
    const ids: string[] = [rootId];
    for (const a of areas) {
      if (a.parentId === rootId) ids.push(...collectDescendantIds(a.id));
    }
    return ids;
  }

  const filterAreaIds = filterAreaId ? collectDescendantIds(filterAreaId) : undefined;

  const issues = await listAllIssues(session.user.id, collection.id, filterAreaIds);

  return (
    <div style={{ padding: "2rem" }}>
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
        initialIssues={issues}
        filterAreaId={filterAreaId ?? null}
      />
    </div>
  );
}
