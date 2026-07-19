import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getStampConditions } from "@/lib/conditions";
import { getCertificateStatuses } from "@/lib/certificate-statuses";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { listLotCopies, type ItemListItem } from "@/lib/items";
import { getIssueHeadersByIds, type IssueHeader } from "@/lib/issues";
import { getPurchaseDetail } from "@/lib/lots";
import { PurchaseDetailPanel } from "./purchase-detail-panel";

interface PurchaseDetailPageProps {
  params: Promise<{ collectionSlug: string; purchaseId: string }>;
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

  // Copies identified into each lot, keyed by lot id, for the intake screen. Enriched with
  // the same shape/valuation as the Copies screen so lot rows render identically (#121).
  const itemsByLot: Record<string, ItemListItem[]> = {};
  await Promise.all(
    purchase.lots.map(async (lot) => {
      itemsByLot[lot.id] = await listLotCopies(session.user.id, collection.id, lot.id);
    })
  );

  // Issue headers for the grouped-by-issue lot view, so its issue rows read like the
  // issues list (#121).
  const issueIds = [
    ...new Set(
      Object.values(itemsByLot)
        .flat()
        .map((it) => it.issueId)
        .filter((id): id is string => id != null)
    ),
  ];
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
        itemsByLot={itemsByLot}
        issueHeaderById={issueHeaderById}
        areas={areas}
        locations={locations}
        conditions={conditions}
        certificateStatuses={certificateStatuses}
      />
    </div>
  );
}
