import "server-only";
import { prisma } from "./db";
import { quickJumpLabel, type QuickJumpTarget } from "./quick-jump";

// The server half of the quick-jump box (#431): turning `{ entity, no }` into the address of the
// thing it names, or into "there is no such row here".
//
// It has to be server-side, and not because of the lookup: a short number is per collection and
// says nothing about who owns that collection, so the *only* thing standing between `p 1` and
// somebody else's purchase is this check. The box is a text field on a page — everything it sends
// is the collector's typing, and none of it is authorization.
//
// Where each entity lands is a product decision, not a technicality, so it is stated once here:
//
//   • copy, issue → the list screen, filtered to that number. Neither has a screen of its own, and
//     the filtered list is the one place it already reads correctly — including the surrounding
//     rows, which is often why one is looking.
//   • offer → `/o/<slug>/<no>`, the short redirect that already exists (#416). Deliberately not the
//     canonical URL: this is the same address a marketplace note carries, so a jump and a followed
//     link are the same journey.
//   • purchase, sale → their own detail screens.
//   • trade → the trade list, filtered to that number, for the reason a copy and an issue land
//     there: it has no screen of its own yet (#637 builds one), and the filtered list already
//     reads correctly.
//   • auction lot → its **sale's** screen with the lot highlighted, which is exactly what clicking
//     the lot on the watchlist does (#374). A lot is read in the company of its parcel.

export interface QuickJumpResult {
  /** Where to go. */
  href: string;
}

/** Resolve a parsed quick-jump target to an address inside `collectionSlug`, or null when the
 * collection holds no such row. Ownership is asserted here; callers pass the session's own user. */
export async function resolveQuickJump(
  ownerId: string,
  collectionId: string,
  target: QuickJumpTarget
): Promise<QuickJumpResult | null> {
  // The slug is read here rather than taken from the caller: the address this returns is one the
  // browser is about to follow, and the only slug that can be right is the one belonging to the
  // collection just authorized.
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, slug: true },
  });
  if (!collection || collection.ownerId !== ownerId) return null;

  const collectionSlug = collection.slug;
  const base = `/c/${collectionSlug}`;
  const { no } = target;

  switch (target.entity) {
    case "item": {
      const item = await prisma.item.findUnique({
        where: { collectionId_itemNo: { collectionId, itemNo: no } },
        select: { id: true },
      });
      if (!item) return null;
      // The copy search already matches the number (#268), and `#123` is how it reads on the row.
      return { href: `${base}/inventory?search=${encodeURIComponent(`#${no}`)}` };
    }

    case "offer": {
      const offer = await prisma.offer.findUnique({
        where: { collectionId_offerNo: { collectionId, offerNo: no } },
        select: { id: true },
      });
      if (!offer) return null;
      return { href: `/o/${collectionSlug}/${no}` };
    }

    case "purchase": {
      const purchase = await prisma.purchase.findUnique({
        where: { collectionId_purchaseNo: { collectionId, purchaseNo: no } },
        select: { id: true },
      });
      if (!purchase) return null;
      return { href: `${base}/purchases/${purchase.id}` };
    }

    case "sale": {
      const sale = await prisma.sale.findUnique({
        where: { collectionId_saleNo: { collectionId, saleNo: no } },
        select: { id: true },
      });
      if (!sale) return null;
      return { href: `${base}/sales/${sale.id}` };
    }

    case "issue": {
      const issue = await prisma.issue.findUnique({
        where: { collectionId_issueNo: { collectionId, issueNo: no } },
        select: { id: true },
      });
      if (!issue) return null;
      return { href: `${base}/issues?search=${encodeURIComponent(`#${no}`)}` };
    }

    case "trade": {
      const trade = await prisma.trade.findUnique({
        where: { collectionId_tradeNo: { collectionId, tradeNo: no } },
        select: { id: true },
      });
      if (!trade) return null;
      // The list filtered to that number, as a copy and an issue are: a trade has no screen of its
      // own until #637, and the filtered list is the one place the number already reads correctly.
      return { href: `${base}/trades?search=${encodeURIComponent(`#${no}`)}` };
    }

    case "auctionLot": {
      // A lot carries no `collectionId` — it reaches its collection through its sale — so the scope
      // is the join, and `findFirst` rather than `findUnique` for the same reason (the number is
      // unique per collection by allocation, not by an index that could span the two tables).
      const lot = await prisma.auctionLot.findFirst({
        where: { auctionLotNo: no, auctionSale: { collectionId } },
        select: { id: true, auctionSaleId: true },
      });
      if (!lot) return null;
      return { href: `${base}/auctions/sales/${lot.auctionSaleId}?lot=${lot.id}` };
    }
  }
}

/** What to tell the collector when a jump finds nothing — named for the entity they asked for, not
 * for the field, because "no offer #12 in this collection" is the whole answer. */
export function quickJumpMissMessage(target: QuickJumpTarget): string {
  return `No ${quickJumpLabel(target.entity)} #${target.no} in this collection.`;
}
