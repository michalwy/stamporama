import "server-only";
import { prisma } from "./db";
import { listSaleLineSetOptions, swapSaleLineSet } from "./sales";
import { makeOfferLabeller, STAMP_LABEL_SELECT, type StampLabelRow } from "./offer-labels";
import { sortPhotos } from "./photos";
import {
  canChooseSaleSet,
  describeSaleChoiceClosed,
  saleChoiceOptionLabel,
} from "./sale-share-rules";
import type { SaleShareAccess } from "./sale-share";

// **Which of these copies would you like?** (#699; ADR-0013 §7) — the question the buyer's link
// asks, and the answer on its way back.
//
// It sits **above** `sales.ts` and reads {@link listSaleLineSetOptions} rather than deriving the
// candidate sets a second time: what the buyer is offered has to be exactly what the seller's own
// *Choose set* dialog offers, or the two ends of one link would be looking at different listings.
// The pick itself is `swapSaleLineSet`, for the sharper version of the same reason — it **is** the
// swap, price and all, and two ways to make that write would be two places for it to differ.
//
// Three properties hold this module together.
//
// **The payload is what is printed, and only what is printed** (`trade-share.ts`'s rule). A
// candidate is a copy the collection knows a great deal about — its number, where it is filed, what
// it cost, what the listing was titled — and none of that is the buyer's business; the surest way to
// keep it out of the page is for it never to be in the payload. What travels per option is an opaque
// set id, the scans, and *Copy 2*.
//
// **Every read and write takes the token's own `SaleShareAccess`.** The sale id comes from the
// token's row, never from the request, so the worst a tampered body can name is a line that is not
// on this order — refused here before anything is written.
//
// **The buyer only ever touches lines that are theirs to touch**: one nobody has chosen a set for,
// or one they chose themselves and may still change. A line the seller settled has left the page and
// is refused by the same rule that keeps it off it.

// ── The page ────────────────────────────────────────────────────────────────────────────────────

/** One copy the buyer may choose, reduced to what a picture and a radio need. */
export interface SaleShareOptionView {
  /** The offer set behind it. Opaque — it authorises nothing on its own; the write checks it against
   *  this line's own candidates. */
  offerSetId: string;
  /** Addressed through the token's own photo route, which serves this order's candidates and not one
   *  image further. */
  photoIds: string[];
  label: string;
  /** The buyer's own standing answer. Absent from every option while nobody has chosen: the set the
   *  line happens to name then was **picked, not chosen** (#697), and marking it would present an
   *  automatic pick as a decision the buyer had somehow already taken part in. */
  chosen: boolean;
}

/** One line still open to the buyer — what they bought, and what it could be. */
export interface SaleShareLineView {
  lineId: string;
  /** What the line is about, as a buyer would read it: the catalogue numbers with their vendors and
   *  the stamp's name. Enough to tell one line of an order from another, and nothing about where the
   *  copies live. */
  stamps: { numbers: string[]; name: string | null }[];
  /** How many copies leave on this line — a set can be a series, and choosing between two sets is
   *  then choosing between two runs of stamps. */
  copyCount: number;
  options: SaleShareOptionView[];
  /** True once the buyer has answered this line. The picker stays, so they can change it. */
  answered: boolean;
}

export interface SaleShareView {
  /** Whose sale it is, by collection name — how the buyer knows the link is the one they were sent.
   *  Nothing else about the collection is on the page. */
  sellerName: string;
  /** Where they bought it and, where the seller recorded one, the marketplace's own order number —
   *  the two things a buyer matches a link against their own inbox by. */
  platformName: string;
  orderRef: string | null;
  soldAt: string;
  lines: SaleShareLineView[];
  /** Whether a pick may still be made — up to the parcel being packed, and no further. */
  open: boolean;
  /** Said in place of the picker when it is not open, so a reader is told why rather than left
   *  looking for a control that is not there. */
  closedMessage: string | null;
}

/**
 * Assemble the buyer's page, or null when the sale has gone.
 *
 * A line is on it when nobody has chosen its set, or when the **buyer** chose it — that second half
 * is what makes an answer correctable, since the pick clears `setChoicePending` the moment it lands
 * and the line would otherwise vanish under the person who had just answered it. A line the seller
 * settled themselves simply is not here.
 *
 * One read for the order, one per open line for its candidates (there are one or two of those on a
 * real order), and one for every scan on the page.
 */
export async function readSaleShareView(access: SaleShareAccess): Promise<SaleShareView | null> {
  const sale = await prisma.sale.findUnique({
    where: { id: access.saleId },
    select: {
      soldAt: true,
      externalRef: true,
      collection: { select: { name: true } },
      platform: { select: { name: true } },
      lines: {
        where: { OR: [{ setChoicePending: true }, { setChosenByBuyerAt: { not: null } }] },
        select: { id: true, setChosenByBuyerAt: true },
      },
    },
  });
  if (!sale) return null;

  const open = canChooseSaleSet(access.status);
  const labeller = await makeOfferLabeller(access.collectionId);

  const lines: SaleShareLineView[] = [];
  // Which copies each option is made of, kept from the pass that built the options so the scans can
  // be fetched for the whole page in one query afterwards rather than a query per option.
  const itemsBySet = new Map<string, string[]>();
  for (const line of sale.lines) {
    // The seller's own candidate list, read through the seller's own function — the token acts as
    // the owner for this one sale, exactly as the trade link does for one trade.
    const choice = await listSaleLineSetOptions(access.ownerId, line.id, { withCopies: false });
    // A line whose offer is gone has nothing to choose among (`listSaleLineSetOptions` says so by
    // returning null). Left off the page rather than drawn as an empty question.
    if (!choice || choice.sets.length === 0) continue;

    const current = choice.sets.find((set) => set.offerSetId === choice.currentSetId);
    const stampRows = await readSetStamps(current?.itemIds ?? []);
    for (const set of choice.sets) itemsBySet.set(set.offerSetId, set.itemIds);

    lines.push({
      lineId: line.id,
      stamps: stampRows.map((stamp) => ({
        numbers: labeller.catalogNumbers(stamp),
        name: stamp.name,
      })),
      copyCount: current?.itemIds.length ?? 0,
      answered: line.setChosenByBuyerAt !== null,
      options: choice.sets.map((set, index) => ({
        offerSetId: set.offerSetId,
        photoIds: [],
        label: saleChoiceOptionLabel(index),
        // Only ever true where the buyer answered: an automatic pick is not an answer, and marking
        // it as one would ask them to un-choose something they never chose.
        chosen: line.setChosenByBuyerAt !== null && set.offerSetId === choice.currentSetId,
      })),
    });
  }

  // Every scan on the page in one query, never one per option.
  const photos = await photoIdsFor(new Set([...itemsBySet.values()].flat()));
  for (const line of lines) {
    for (const option of line.options) {
      option.photoIds = (itemsBySet.get(option.offerSetId) ?? []).flatMap(
        (itemId) => photos.get(itemId) ?? []
      );
    }
  }

  return {
    sellerName: sale.collection.name,
    platformName: sale.platform.name,
    orderRef: sale.externalRef,
    soldAt: sale.soldAt.toISOString(),
    lines,
    open,
    closedMessage: open ? null : describeSaleChoiceClosed(access.status),
  };
}

/** What the line is about, in the buyer's terms. The copies of the set the line names today — every
 *  set of one quantity listing holds the same stamps, which is why it is one listing. */
async function readSetStamps(itemIds: string[]): Promise<StampLabelRow[]> {
  if (itemIds.length === 0) return [];
  const rows = await prisma.item.findMany({
    where: { id: { in: itemIds } },
    select: { id: true, ...STAMP_LABEL_SELECT },
  });
  // Back into the set's own order (#306), which the candidate read already resolved: a series listed
  // as one set reads as a series or it reads as a bag.
  const byItem = new Map(rows.map((row) => [row.id, row.stamp]));
  return itemIds.flatMap((itemId) => {
    const stamp = byItem.get(itemId);
    return stamp ? [stamp] : [];
  });
}

/** The scans of a set of copies, in the app's own order — front, back, then the extras. One query
 *  for the whole page. `trade-proposals.ts`'s own reader, kept here rather than shared because the
 *  two pages are the only callers and neither is the other's abstraction. */
async function photoIdsFor(itemIds: Set<string>): Promise<Map<string, string[]>> {
  const out = new Map<string, string[]>();
  if (itemIds.size === 0) return out;
  const rows = await prisma.photo.findMany({
    where: { itemId: { in: [...itemIds] } },
    select: { id: true, itemId: true, role: true, title: true, sortOrder: true },
  });
  const byItem = new Map<string, typeof rows>();
  for (const row of rows) {
    if (!row.itemId) continue;
    const existing = byItem.get(row.itemId);
    if (existing) existing.push(row);
    else byItem.set(row.itemId, [row]);
  }
  for (const [itemId, group] of byItem) {
    out.set(
      itemId,
      group
        .map((p) => ({
          id: p.id,
          role: (p.role === "front" || p.role === "back" ? p.role : null) as
            | "front"
            | "back"
            | null,
          title: p.title,
          sortOrder: p.sortOrder,
        }))
        .sort(sortPhotos)
        .map((p) => p.id)
    );
  }
  return out;
}

// ── The answer ──────────────────────────────────────────────────────────────────────────────────

/**
 * Record which copy the buyer wants.
 *
 * The write is `swapSaleLineSet` (#697) — the seller's own — so the copies move, the price stands,
 * the packing marks of the copies that are no longer going are dropped and `setChoicePending`
 * clears, exactly as when the seller picks. What differs is one flag on the way in: the line is
 * stamped `setChosenByBuyerAt`, which is how the seller sees who chose and how this page knows the
 * line is still the buyer's to change.
 *
 * Refused when the parcel has been packed, and refused for a line that is not this order's or is not
 * the buyer's to answer. The candidate set itself is checked by `swapSaleLineSet`, which is where
 * *that* question already lived: another offer's set, or one whose copies have since sold, is
 * refused by name.
 */
export async function saveBuyerSetChoice(
  access: SaleShareAccess,
  lineId: string,
  offerSetId: string
): Promise<{ offerSetId: string }> {
  if (!canChooseSaleSet(access.status)) {
    throw new Error(describeSaleChoiceClosed(access.status));
  }

  // The one place a reader-supplied id reaches a query, and it is bounded by the token's own sale
  // before it reaches a write.
  const line = await prisma.saleLine.findFirst({
    where: {
      id: lineId,
      saleId: access.saleId,
      OR: [{ setChoicePending: true }, { setChosenByBuyerAt: { not: null } }],
    },
    select: { id: true },
  });
  if (!line) {
    throw new Error("That copy is not one this order is asking about any more.");
  }

  await swapSaleLineSet(access.ownerId, lineId, offerSetId, { byBuyer: true });
  return { offerSetId };
}

// ── The scans ───────────────────────────────────────────────────────────────────────────────────

/**
 * Whether a scan may be served through this token.
 *
 * The same scoping rule as everything else: a picture is reachable when it hangs on a copy of one of
 * the **listings this order is still asking about**, and the copy has not left on somebody else's
 * sale. Asked as one query anchored on the photo, so a thumbnail costs a lookup rather than the
 * page's whole derivation.
 *
 * Slightly wider than the page in one direction, and deliberately: a set is atomic, so one copy sold
 * elsewhere retires the whole set from the options while its siblings' scans stay servable. They are
 * copies of the listing this buyer bought from, reachable only by guessing a photo id, and narrowing
 * it further would mean re-deriving the candidate pool on every thumbnail.
 */
export async function canServeSaleSharePhoto(
  access: SaleShareAccess,
  photoId: string
): Promise<boolean> {
  const lines = await prisma.saleLine.findMany({
    where: {
      saleId: access.saleId,
      offerId: { not: null },
      OR: [{ setChoicePending: true }, { setChosenByBuyerAt: { not: null } }],
    },
    select: { id: true, offerId: true },
  });
  if (lines.length === 0) return false;

  const photo = await prisma.photo.findFirst({
    where: {
      id: photoId,
      item: {
        collectionId: access.collectionId,
        offerSetMemberships: {
          some: {
            offerSet: { offerId: { in: lines.flatMap((l) => (l.offerId ? [l.offerId] : [])) } },
          },
        },
        // Free, or already on one of this order's own lines — a copy that left on somebody else's
        // sale is nothing to do with this question.
        OR: [
          { saleLineItems: { none: {} } },
          { saleLineItems: { some: { saleLineId: { in: lines.map((l) => l.id) } } } },
        ],
      },
    },
    select: { id: true },
  });
  return photo !== null;
}
