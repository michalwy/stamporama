import { notFound, redirect } from "next/navigation";
import Link from "next/link";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getAlbums } from "@/lib/albums";
import { getSpanningChecklistOverview } from "@/lib/spanning-checklists";
import { ChecklistsPanel } from "./checklists-panel";
import { readIncludeSpecialised } from "@/lib/specialised-checklists-preference";

export const metadata = { title: "Checklists" };

interface ChecklistsPageProps {
  params: Promise<{ collectionSlug: string }>;
}

/**
 * Checklists that span issues (#1416) — the home ADR-0031 left open.
 *
 * A checklist is a collecting goal (#531), and most goals follow one issue: those are edited on the
 * issue, where the screen already answers *which issue* (ADR-0020 §7). A set collected across
 * publications — a thematic set, a definitive run printed over several issues — has no issue to be
 * edited on, so it is edited here. This screen lists only those; an issue's own checklists stay on
 * the issue, and listing them here too would be a second editor for them.
 */
export default async function ChecklistsPage({ params }: ChecklistsPageProps) {
  const { collectionSlug } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const [checklists, areas, albums] = await Promise.all([
    getSpanningChecklistOverview(
      session.user.id,
      collection.id,
      await readIncludeSpecialised(collection.id)
    ),
    getCollectionAreas(session.user.id, collection.id),
    getAlbums(session.user.id, collection.id),
  ]);

  return (
    <div style={{ padding: "2rem", maxWidth: "64rem" }}>
      <h2
        style={{
          margin: "0 0 0.5rem",
          fontSize: "1.25rem",
          fontWeight: 600,
          color: "var(--color-text-primary)",
        }}
      >
        Checklists
      </h2>
      <p
        style={{
          margin: "0 0 1.5rem",
          fontSize: "0.9375rem",
          color: "var(--color-text-muted)",
          maxWidth: "42rem",
          lineHeight: 1.6,
        }}
      >
        Sets you collect across several issues — a thematic set, a definitive series printed over
        many years. Each counts as one goal: its completeness and catalogue value are read as an
        issue&apos;s checklist is. Add stamps by ticking them on the{" "}
        <Link href={`/c/${collectionSlug}/issues`} style={{ color: "var(--color-accent)" }}>
          Issues
        </Link>{" "}
        list and choosing <strong>Add to checklist…</strong>. A checklist of one issue is kept on
        that issue.
      </p>
      <ChecklistsPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        initialChecklists={checklists}
        areas={areas}
        albums={albums}
      />
    </div>
  );
}
