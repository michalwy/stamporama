import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getOfferDetail, getOfferIssueIds } from "@/lib/offers";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getIssueHeadersByIds, type IssueHeader } from "@/lib/issues";
import { RecordRecentVisit } from "@/app/c/[collectionSlug]/shared/record-recent-visit";
import { OfferDetailPanel } from "./offer-detail-panel";
import { OfferListNav } from "./offer-list-nav";
import { parseOfferListContext } from "../list-context";

interface OfferDetailPageProps {
  params: Promise<{ collectionSlug: string; offerId: string }>;
  /** The filter context the offer was opened from, when it was opened from the list (#429). */
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export async function generateMetadata({ params }: OfferDetailPageProps): Promise<Metadata> {
  const { offerId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  const offer = await getOfferDetail(session.user.id, offerId);
  if (!offer) return {};
  return { title: `Offer — ${offer.platformName}` };
}

export default async function OfferDetailPage({ params, searchParams }: OfferDetailPageProps) {
  const { collectionSlug, offerId } = await params;
  // The filtered list this offer was opened from (#429) — the back link goes back to it as it was,
  // and the walk through it is offered beside that link.
  const listContext = parseOfferListContext(await searchParams);

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

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
  // "Today" at request time, for the quick-sell flow's new-sale step (#390) — mirrors the list page.
  const today = new Date().toISOString().slice(0, 10);

  const issueHeaders = await getIssueHeadersByIds(session.user.id, collection.id, issueIds);
  const issueHeaderById: Record<string, IssueHeader> = {};
  for (const h of issueHeaders) issueHeaderById[h.id] = h;

  return (
    <div style={{ padding: "2rem", minHeight: "100vh", display: "flex", flexDirection: "column" }}>
      {/* The walk through the filtered list (#429), at the right edge: the step controls are pressed
          repeatedly, so they stay put. There is no link back to the list (#1595) — the sidebar and
          the browser's back do that — so an offer opened from anywhere else has no row here at all. */}
      {listContext && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: "1rem" }}>
          <OfferListNav
            collectionId={collection.id}
            collectionSlug={collectionSlug}
            offerId={offerId}
            context={listContext}
          />
        </div>
      )}
      <RecordRecentVisit
        collectionId={collection.id}
        kind="offer"
        id={offer.id}
        // The canonical screen, not the `/o/<slug>/<no>` short address the quick jump uses: that
        // one exists so a marketplace note and a jump are one journey, and coming back to a screen
        // one was just on is neither.
        href={`/c/${collectionSlug}/offers/${offer.id}`}
        label={offer.name ?? offer.label}
        sublabel={offer.platformName}
      />
      <OfferDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        offerId={offerId}
        today={today}
        areas={areas}
        locations={locations}
        issueHeaderById={issueHeaderById}
      />
    </div>
  );
}
