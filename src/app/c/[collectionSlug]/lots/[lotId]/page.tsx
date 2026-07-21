import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getIssueHeadersByIds, type IssueHeader } from "@/lib/issues";
import { getSaleLotDetail } from "@/lib/sale-lots";
import { LotDetailPanel } from "./lot-detail-panel";

interface LotDetailPageProps {
  params: Promise<{ collectionSlug: string; lotId: string }>;
}

export async function generateMetadata({ params }: LotDetailPageProps): Promise<Metadata> {
  const { lotId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const lot = await getSaleLotDetail(session.user.id, lotId);
  return lot ? { title: `Lot — ${lot.label}` } : {};
}

export default async function LotDetailPage({ params }: LotDetailPageProps) {
  const { collectionSlug, lotId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const lot = await getSaleLotDetail(session.user.id, lotId);
  if (!lot || lot.collectionId !== collection.id) notFound();

  const [areas, locations] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
  ]);

  // Issue headers for the grouped-by-issue copy view, so its group headers read like the
  // purchase-order lot (area chip, catalog chips, stamp-count badge).
  const issueIds = [
    ...new Set(lot.items.map((it) => it.issueId).filter((id): id is string => id != null)),
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
        href={`/c/${collectionSlug}/lots`}
        style={{
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
          textDecoration: "none",
          marginBottom: "0.75rem",
        }}
      >
        ← Back to lots
      </Link>
      <LotDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        lot={lot}
        areas={areas}
        locations={locations}
        issueHeaderById={issueHeaderById}
      />
    </div>
  );
}
