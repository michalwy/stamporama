import "server-only";
import { prisma } from "./db";
import { makeTitleCopyMapper, TITLE_COPY_SELECT, TITLE_COPY_STAMP_SELECT } from "./title-copy";
import { loadChecklistSlots } from "./offer-photo-checklists";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { soldItemIds } from "./sales";
import {
  specificationCopyOrder,
  specificationRow,
  type OfferSpecificationRow,
  type SpecificationSet,
} from "./offer-specification-rules";

// An offer's **specification** for buyers (#1758) — the read. What it lists, in what order and why
// is in `offer-specification-rules.ts`; this gathers the rows and names the offer.

/** Everything the specification prints, in every form it takes (#1758, #1759, #1760). */
export interface OfferSpecification {
  offerId: string;
  collectionId: string;
  /** The offer's short number (#416) — the header names the offer by it and its title. */
  offerNo: number;
  /** The offer's title, or the label derived from its sets when it was never given one (#209). */
  title: string;
  rows: OfferSpecificationRow[];
}

/** The copy's own scans, front first — the thumbnail is the front, else the back. */
const SIDE_PHOTO_SELECT = {
  where: { role: { in: ["front", "back"] } },
  select: { id: true, role: true },
};

/**
 * The specification of one offer, or null when it is not the owner's.
 *
 * **Written in the offer's language** — its platform's listing language (#293), the one its title
 * and description are generated in — through the listing texts' own normaliser
 * (`makeTitleCopyMapper`), so a name with no translation falls back to the collection's own wording
 * exactly as it does in the title.
 */
export async function readOfferSpecification(
  ownerId: string,
  offerId: string
): Promise<OfferSpecification | null> {
  const offer = await prisma.offer.findFirst({
    where: { id: offerId, collection: { ownerId } },
    select: {
      id: true,
      collectionId: true,
      offerNo: true,
      name: true,
      photoGroupByChecklist: true,
      platform: { select: { titleLanguage: true } },
      sets: {
        select: {
          id: true,
          sortOrder: true,
          saleLines: { select: { id: true }, take: 1 },
          items: {
            select: {
              itemId: true,
              sortOrder: true,
              item: {
                select: {
                  ...TITLE_COPY_SELECT,
                  stampId: true,
                  // The copy order falls back to the catalogue sort key (#306).
                  stamp: {
                    select: { ...TITLE_COPY_STAMP_SELECT, primaryCatalogSortKey: true },
                  },
                  photos: SIDE_PHOTO_SELECT,
                },
              },
            },
          },
        },
      },
    },
  });
  if (!offer) return null;

  const copies = offer.sets.flatMap((set) => set.items);
  const [sold, slots, toCopy, title] = await Promise.all([
    soldItemIds(copies.map((li) => li.itemId)),
    // Read only for an offer that groups its photos by checklist, as the photo planner reads them.
    offer.photoGroupByChecklist
      ? loadChecklistSlots(
          offer.collectionId,
          copies.map((li) => ({ itemId: li.itemId, stampId: li.item.stampId }))
        )
      : Promise.resolve(null),
    makeTitleCopyMapper(ownerId, offer.collectionId, offer.platform.titleLanguage),
    offer.name?.trim() ? Promise.resolve(offer.name.trim()) : derivedTitle(offer.id, offer.collectionId),
  ]);

  const sets: SpecificationSet[] = offer.sets.map((set) => ({
    id: set.id,
    sortOrder: set.sortOrder,
    sold: set.saleLines.length > 0,
    items: set.items.map((li) => ({
      itemId: li.itemId,
      sortOrder: li.sortOrder,
      catalogSortKey: li.item.stamp.primaryCatalogSortKey,
      ...(slots ? { checklists: slots.get(li.itemId) ?? [] } : {}),
    })),
  }));

  const byId = new Map(copies.map((li) => [li.itemId, li.item]));
  const rows = specificationCopyOrder(sets, sold, offer.photoGroupByChecklist).map((itemId) => {
    const item = byId.get(itemId)!;
    const photo =
      item.photos.find((p) => p.role === "front") ?? item.photos.find((p) => p.role === "back");
    return specificationRow(itemId, toCopy(item), photo?.id ?? null);
  });

  return {
    offerId: offer.id,
    collectionId: offer.collectionId,
    offerNo: offer.offerNo,
    title,
    rows,
  };
}

/** The label an untitled offer is shown under everywhere else (#209, #379). */
async function derivedTitle(offerId: string, collectionId: string): Promise<string> {
  const [labeller, sets] = await Promise.all([
    makeOfferLabeller(collectionId),
    prisma.offerSet.findMany({
      where: { offerId },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: {
        title: true,
        items: { select: { itemId: true, sortOrder: true, item: { select: STAMP_LABEL_SELECT } } },
      },
    }),
  ]);
  return labeller.offer(sets);
}
