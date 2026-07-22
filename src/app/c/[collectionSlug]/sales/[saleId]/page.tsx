import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getSaleDetail, getSaleIssueIds } from "@/lib/sales";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getIssueHeadersByIds, type IssueHeader } from "@/lib/issues";
import { SaleDetailPanel } from "./sale-detail-panel";

interface SaleDetailPageProps {
  params: Promise<{ collectionSlug: string; saleId: string }>;
}

export async function generateMetadata({ params }: SaleDetailPageProps): Promise<Metadata> {
  const { saleId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const sale = await getSaleDetail(session.user.id, saleId);
  if (!sale) return {};
  return { title: `Sale — ${sale.platformName}` };
}

export default async function SaleDetailPage({ params }: SaleDetailPageProps) {
  const { collectionSlug, saleId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const sale = await getSaleDetail(session.user.id, saleId);
  if (!sale || sale.collectionId !== collection.id) notFound();

  // Supporting data for the sold-unit copy rows (packing view). Copies themselves stream in per
  // unit via client queries, so the page only preloads the small, shared lookups.
  const [areas, locations, issueIds] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
    getSaleIssueIds(saleId),
  ]);
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
        href={`/c/${collectionSlug}/sales`}
        style={{
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
          textDecoration: "none",
          marginBottom: "0.75rem",
        }}
      >
        ← Back to sales
      </Link>
      <SaleDetailPanel
        collectionId={collection.id}
        sale={sale}
        areas={areas}
        locations={locations}
        issueHeaderById={issueHeaderById}
      />
    </div>
  );
}
