import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { listIssuesForArea } from "@/lib/issues";
import { IssuesPanel } from "./issues-panel";

interface AreaDetailPageProps {
  params: Promise<{ collectionSlug: string; areaId: string }>;
}

export default async function AreaDetailPage({ params }: AreaDetailPageProps) {
  const { collectionSlug, areaId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [areas, issues] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    listIssuesForArea(session.user.id, collection.id, areaId),
  ]);

  const area = areas.find((a) => a.id === areaId);
  if (!area) notFound();

  return (
    <div style={{ padding: "2rem", maxWidth: "64rem" }}>
      <div style={{ marginBottom: "2rem" }}>
        <a
          href={`/c/${collectionSlug}/areas`}
          style={{
            fontSize: "0.8125rem",
            color: "var(--color-text-muted)",
            textDecoration: "none",
          }}
        >
          ← Areas
        </a>
        <h2
          style={{
            margin: "0.5rem 0 0",
            fontSize: "1.25rem",
            fontWeight: 600,
            color: "var(--color-text-primary)",
          }}
        >
          {area.name}
        </h2>
      </div>
      <IssuesPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        area={area}
        initialIssues={issues}
      />
    </div>
  );
}
