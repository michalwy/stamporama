import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getIssueHeadersByIds, type IssueHeader } from "@/lib/issues";
import { getPurchaseDetail, getPurchaseIssueIds } from "@/lib/lots";
import { PurchaseDetailPanel } from "./purchase-detail-panel";

interface PurchaseDetailPageProps {
  params: Promise<{ collectionSlug: string; purchaseId: string }>;
}

export async function generateMetadata({
  params,
}: PurchaseDetailPageProps): Promise<Metadata> {
  const { purchaseId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};

  const purchase = await getPurchaseDetail(session.user.id, purchaseId);
  if (!purchase) return {};

  return { title: `Purchase — ${purchase.contactName ?? purchase.purchasedAt}` };
}

export default async function PurchaseDetailPage({ params }: PurchaseDetailPageProps) {
  const { collectionSlug, purchaseId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const purchase = await getPurchaseDetail(session.user.id, purchaseId);
  if (!purchase || purchase.collectionId !== collection.id) notFound();

  const [conditions, certificateStatuses, areas, locations] = await Promise.all([
    getStampConditions(session.user.id, collection.id),
    getCertificateStatuses(session.user.id, collection.id),
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
  ]);

  // Copies now stream into each lot card via paginated client queries (#172), so the page no
  // longer preloads them. Issue headers for the grouped-by-issue view are still loaded here
  // (from the purchase's distinct issue ids) so the group headers read like the issues list.
  const issueIds = await getPurchaseIssueIds(purchase.id);
  const issueHeaders = await getIssueHeadersByIds(session.user.id, collection.id, issueIds);
  const issueHeaderById: Record<string, IssueHeader> = {};
  for (const h of issueHeaders) issueHeaderById[h.id] = h;

  return (
    <div
      style={{
        padding: "2rem",
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
      }}
    >
      <Link
        href={`/c/${collectionSlug}/purchases`}
        style={{
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
          textDecoration: "none",
          marginBottom: "0.75rem",
        }}
      >
        ← Back to purchases
      </Link>
      <PurchaseDetailPanel
        collectionId={collection.id}
        purchase={purchase}
        issueHeaderById={issueHeaderById}
        areas={areas}
        locations={locations}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
      />
    </div>
  );
}
