import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import Link from "next/link";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getOfferDetail, getOfferIssueIds } from "@/lib/offers";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getIssueHeadersByIds, type IssueHeader } from "@/lib/issues";
import { OfferDetailPanel } from "./offer-detail-panel";

interface OfferDetailPageProps {
  params: Promise<{ collectionSlug: string; offerId: string }>;
}

export async function generateMetadata({ params }: OfferDetailPageProps): Promise<Metadata> {
  const { offerId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const offer = await getOfferDetail(session.user.id, offerId);
  if (!offer) return {};
  return { title: `Offer — ${offer.platformName}` };
}

export default async function OfferDetailPage({ params }: OfferDetailPageProps) {
  const { collectionSlug, offerId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect("/sign-in");

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  const offer = await getOfferDetail(session.user.id, offerId);
  if (!offer || offer.collectionId !== collection.id) notFound();

  // Supporting lookups for the copy rows in the sets view (the copies themselves stream in via a
  // client query). Mirrors the sale detail page.
  const [areas, locations, issueIds] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
    getOfferIssueIds(offerId),
  ]);
  const issueHeaders = await getIssueHeadersByIds(session.user.id, collection.id, issueIds);
  const issueHeaderById: Record<string, IssueHeader> = {};
  for (const h of issueHeaders) issueHeaderById[h.id] = h;

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      <Link
        href={`/c/${collectionSlug}/offers`}
        style={{
          fontSize: "0.8125rem",
          color: "var(--color-text-secondary)",
          textDecoration: "none",
          marginBottom: "1rem",
        }}
      >
        ← Offers
      </Link>
      <OfferDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        offerId={offerId}
        areas={areas}
        locations={locations}
        issueHeaderById={issueHeaderById}
      />
    </div>
  );
}
