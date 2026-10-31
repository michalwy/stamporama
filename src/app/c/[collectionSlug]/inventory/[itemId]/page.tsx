import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { signInPath } from "@/lib/sign-in-redirect";
import { headers } from "next/headers";
import { auth } from "@/lib/auth";
import { getCollectionBySlug } from "@/lib/collections";
import { getCollectionAreas } from "@/lib/areas";
import { getLocations } from "@/lib/locations";
import { getItemListItem, listItemsPaginated } from "@/lib/items";
import { getItemSaleRecord } from "@/lib/sales";
import { getCopyLocationMoves } from "@/lib/location-moves";
import { loadStampFamilies } from "@/lib/stamp-family";
import { otherCopiesStampIds } from "@/lib/other-copies-rules";
import { formatItemNo } from "@/lib/item-number";
import { RecordRecentVisit } from "@/app/c/[collectionSlug]/shared/record-recent-visit";
import { CopyDetailPanel } from "./copy-detail-panel";
import { Screen } from "@/app/screen";

interface CopyDetailPageProps {
  params: Promise<{ collectionSlug: string; itemId: string }>;
}

export async function generateMetadata({ params }: CopyDetailPageProps): Promise<Metadata> {
  const { itemId } = await params;
  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) return {};
  try {
    const item = await getItemListItem(session.user.id, itemId);
    return { title: `Copy ${formatItemNo(item.itemNo)} — ${item.stampName ?? "stamp"}` };
  } catch {
    return {};
  }
}

/**
 * One physical copy, whole (#517): what it is, where it is, what it cost, what it is worth, the
 * photos of it, the offers it sits on and the sale it left on. The popups it consolidates (#110,
 * #114, #276) stay where they are — this page is the deeper view, not their replacement.
 */
export default async function CopyDetailPage({ params }: CopyDetailPageProps) {
  const { collectionSlug, itemId } = await params;

  const session = await auth.api.getSession({ headers: await headers() });
  if (!session) redirect(await signInPath());

  const collection = await getCollectionBySlug(session.user.id, collectionSlug);
  if (!collection) notFound();

  // Read through the collection-scoped list rather than `getItemListItem`, so a copy belonging to
  // another of this owner's collections is a 404 here rather than a page about someone else's slug.
  const { items } = await listItemsPaginated(session.user.id, collection.id, {
    ids: [itemId],
    pageSize: 1,
  });
  const item = items[0];
  if (!item) notFound();

  const otherCopiesStamps = otherCopiesStampIds(item);
  const [areas, locations, sale, families, locationMoves] = await Promise.all([
    getCollectionAreas(session.user.id, collection.id),
    getLocations(session.user.id, collection.id),
    getItemSaleRecord(session.user.id, itemId),
    // The families whose other copies the copy's page lists (#2090, #2282): the umbrella and its
    // variants, for each stamp the copy is of.
    loadStampFamilies(collection.id, otherCopiesStamps),
    // Where it has been (#2277) — read with the page, so a save's refresh re-reads it too.
    getCopyLocationMoves(session.user.id, collection.id, itemId),
  ]);

  return (
    <Screen height="column">
      <RecordRecentVisit
        collectionId={collection.id}
        kind="item"
        id={item.id}
        href={`/c/${collectionSlug}/inventory/${item.id}`}
        label={`Copy ${formatItemNo(item.itemNo)}`}
        sublabel={item.stampName ?? undefined}
      />
      <CopyDetailPanel
        collectionId={collection.id}
        collectionSlug={collectionSlug}
        baseCurrency={collection.baseCurrency}
        item={item}
        areas={areas}
        locations={locations}
        sale={sale}
        otherCopies={otherCopiesStamps.map((stampId) => ({
          stamp: item.multiStamp
            ? (item.carriedStamps.find((s) => s.stampId === stampId) ?? null)
            : null,
          familyStampIds: families.get(stampId) ?? [stampId],
        }))}
        locationMoves={locationMoves}
      />
    </Screen>
  );
}
