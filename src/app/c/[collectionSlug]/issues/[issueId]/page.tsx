import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getIssueListItem, listIssueMembers } from "@/lib/issues";
import { getIssueCompleteness } from "@/lib/issue-completeness";
import { IssueDetailPanel } from "./issue-detail-panel";

interface IssueDetailPageProps {
  params: Promise<{ collectionSlug: string; issueId: string }>;
}

export async function generateMetadata({ params }: IssueDetailPageProps): Promise<Metadata> {
  const { collectionSlug, issueId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) return {};
  const issue = await getIssueListItem(session.user.id, collection.id, issueId);
  if (!issue) return {};
  return { title: `Issue — ${[issue.year, issue.name].filter(Boolean).join(", ")}` };
}

/**
 * One issue, whole (#519): its declared catalog range, how complete it is against the copies
 * actually held, what the required stamps are worth, the full stamp tree with room to read it, and
 * the copies and offers behind it. The list's expandable row (#54) stays as it is — this is the
 * screen for when the row is not enough.
 */
export default async function IssueDetailPage({ params }: IssueDetailPageProps) {
  const { collectionSlug, issueId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const issue = await getIssueListItem(session.user.id, collection.id, issueId);
  if (!issue) notFound();

  const [areas, members, completeness] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    listIssueMembers(session.user.id, collection.id, issueId),
    getIssueCompleteness(session.user.id, collection.id, issueId),
  ]);

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <IssueDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        issue={issue}
        members={members}
        completeness={completeness}
        areas={areas}
      />
    </div>
  );
}
