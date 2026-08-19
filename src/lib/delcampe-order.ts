import "server-only";
import { prisma } from "./db";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";
import { getModulePlatform } from "./module-platform";
import { resolvePurchaseContact } from "./contacts";
import { addSaleLines, createSale, deleteSale, listSellableOffers } from "./sales";
import { offerNoFromPersonalReference } from "./delcampe-import-rules";
import { parseSaleDate } from "./sale-rules";
import {
  describeDelcampeOrderProblems,
  planDelcampeOrderSale,
  type DelcampeOrderCandidate,
  type DelcampeOrderInput,
  type DelcampeOrderProblem,
} from "./delcampe-order-rules";

// Recording one Delcampe **order** as a `Sale` (#612; ADR-0038) — the write half of the marks the
// Assistant draws on the seller's own My Sold Items screens.
//
// It is the third and last leg of a loop that never touches Delcampe's API: #610 writes the upload,
// #611 reads the active-items export back and learns each listing's `id_auction`, and this asks the
// only question the export could not answer — a listing that came down: sold to whom, for how much?
// The answer is on the order screens, where the collector is already standing when they pack the
// parcel, so that is where it is asked rather than in a second file full of buyers.
//
// **The extension reports and this decides** (#409). What arrives is what a row printed; which offer
// it is, whether the whole order can be recorded, and what the sale then says are settled here, and
// the judgements themselves are pure in `delcampe-order-rules.ts`.
//
// Two rules run through everything below:
//
//   * **One order is one sale, for ever.** A re-import of an order already recorded answers with the
//     sale that claims it and writes nothing — the marker's own contract, and what makes clicking
//     *Import* twice harmless.
//   * **All lines or nothing.** Unlike Allegro's flow (#463), which shows a dialog before it writes,
//     the click here happens on Delcampe's page with nothing reviewed in between. So an order that
//     cannot be recorded whole is not recorded at all, and every reason is named at once.
//
// **The buyer is a login and a name.** Delcampe prints the shipping address on the same row and
// serves a relay e-mail beside it; neither is read, so neither can be stored. `Contact` gains no
// address field here and the relay address is worth less than none — its lifetime is unknown and
// nothing here could ever refresh it.

/** A refusal about the order as a whole — an unowned collection, no Delcampe platform, or the
 *  reasons the rules gave for not recording it. `problems` carries them one per row where there are
 *  rows to blame, so the page can say which item to go and fix. */
export class DelcampeOrderError extends Error {
  readonly problems: DelcampeOrderProblem[];

  constructor(message: string, problems: DelcampeOrderProblem[] = []) {
    super(message);
    this.name = "DelcampeOrderError";
    this.problems = problems;
  }
}

/** The sale one Delcampe order is here, as the marker draws it. `path` is **relative**, the offer
 *  lookup's own rule (#466): the instance answers where the sale is on itself, and the extension
 *  joins that to the base URL it authenticated against. */
export interface DelcampeOrderSaleMatch {
  orderId: string;
  saleId: string;
  saleNo: number;
  path: string;
  /** The sale's fulfillment status (#191) — the collector's own workflow, which is worth seeing
   *  beside a Delcampe row whose phase says something different. */
  status: string;
}

/** How many orders one lookup may ask about. A phase screen shows a page of orders, never a
 *  thousand; the cap is the offer lookup's guard against a page that would ask about everything. */
const ORDER_LOOKUP_LIMIT = 200;

async function collectionOf(ownerId: string, collectionId: string): Promise<{ slug: string }> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { slug: true },
  });
  if (!collection) throw new DelcampeOrderError("Collection not found.");
  return collection;
}

/**
 * Which of these Delcampe orders are already recorded here (#612).
 *
 * Matched on `Sale.externalRef` — the same column #479 drops an Allegro order id into — and narrowed
 * to the platform this collection calls Delcampe, so an Allegro order that happens to carry the same
 * digits never answers for a Delcampe one.
 *
 * **Many orders per call**, because a phase screen is a list: asking per row would be a request per
 * row. A miss is an absent entry rather than an error, exactly as the offer lookup's is — an order
 * not yet recorded is the ordinary case, and it is the one the *Import* affordance exists for.
 */
export async function findSalesForDelcampeOrders(
  ownerId: string,
  collectionId: string,
  orderIds: string[]
): Promise<DelcampeOrderSaleMatch[]> {
  const collection = await collectionOf(ownerId, collectionId);
  const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    ORDER_LOOKUP_LIMIT
  );
  if (ids.length === 0) return [];

  const platform = await getModulePlatform(collectionId, DELCAMPE_PLATFORM_MODULE);
  if (!platform) return [];

  const sales = await prisma.sale.findMany({
    where: { collectionId, platformId: platform.id, externalRef: { in: ids } },
    select: { id: true, saleNo: true, externalRef: true, status: true },
  });
  return sales.flatMap((sale) =>
    sale.externalRef
      ? [
          {
            orderId: sale.externalRef,
            saleId: sale.id,
            saleNo: sale.saleNo,
            path: `/c/${encodeURIComponent(collection.slug)}/sales/${sale.id}`,
            status: sale.status,
          },
        ]
      : []
  );
}

/** What one import produced: the sale, and whether this call is what created it. */
export interface DelcampeOrderImportResult extends DelcampeOrderSaleMatch {
  /** False when the order was already recorded — the answer is then a link and nothing was written. */
  created: boolean;
}

/**
 * Record one order as a sale.
 *
 * The order of operations is the order of the refusals: the platform, then the sale that may already
 * claim this order, then which offers the rows are, then whether the whole thing can be recorded.
 * Nothing is written until every one of those has an answer.
 *
 * Each row finds its offer two ways, in this order:
 *
 *   1. **Delcampe's own id.** `Offer.delcampeItemId` is what #611 wrote from the active-items export,
 *      so this is an exact match on the marketplace's own key — the strongest kind there is, and the
 *      reason this issue waited for that one.
 *   2. **The reference the row prints.** Since #635 that is the offer's own **number**, read back by
 *      `offerNoFromPersonalReference` — Delcampe caps the column at 20 characters, so the short URL
 *      #610 wrote there does not fit. The screen is already this collection's, so the number is the
 *      only thing left to say. A listing put up before the export existed carries whatever the
 *      collector typed and simply matches nothing.
 *
 * The two are asked in that order and never averaged: an id is a fact and a reference is a label,
 * and a label that disagrees with the id it sits beside is worth nothing.
 */
export async function importDelcampeOrder(
  ownerId: string,
  collectionId: string,
  order: DelcampeOrderInput
): Promise<DelcampeOrderImportResult> {
  const collection = await collectionOf(ownerId, collectionId);
  const orderId = order.orderId.trim();
  if (!orderId) throw new DelcampeOrderError("That row states no Delcampe order number.");

  const platform = await getModulePlatform(collectionId, DELCAMPE_PLATFORM_MODULE);
  if (!platform) {
    throw new DelcampeOrderError(
      "No platform is marked as Delcampe yet, so there is nothing to record this order against. Settings → Delcampe."
    );
  }

  const salePath = (saleId: string) =>
    `/c/${encodeURIComponent(collection.slug)}/sales/${saleId}`;

  // One order is one sale. The existing one is the answer, not a conflict: the collector clicked
  // *Import* on a row whose marker had not caught up, or on the same row twice.
  const existing = await prisma.sale.findFirst({
    where: { collectionId, platformId: platform.id, externalRef: orderId },
    select: { id: true, saleNo: true, status: true },
  });
  if (existing) {
    return {
      orderId,
      saleId: existing.id,
      saleNo: existing.saleNo,
      path: salePath(existing.id),
      status: existing.status,
      created: false,
    };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: platform.id, collectionId },
    select: { platformCurrency: true },
  });
  const currency = contact?.platformCurrency ?? null;
  if (!currency) {
    throw new DelcampeOrderError(
      `${platform.name} has no currency set, so an order's amounts cannot be read into a sale. Settings → Delcampe.`
    );
  }

  const candidates = await matchOrderItems(ownerId, collectionId, platform.id, order);
  const plan = planDelcampeOrderSale(order, { currency, candidates });
  if (!plan.ok) {
    throw new DelcampeOrderError(describeDelcampeOrderProblems(plan.problems), plan.problems);
  }
  // Through the sale form's own reader, and not `new Date(...)`: `Sale.soldAt` is a date column that
  // the FX freeze hangs off, and a local midnight is the previous day in every timezone west of
  // UTC — a sale dated a day out, with the wrong day's rate frozen onto it.
  const soldAt = parseSaleDate(plan.soldAt);
  if (!soldAt) {
    throw new DelcampeOrderError("The date this order states could not be read as a sale date.");
  }

  // The buyer is found or created under their **login** (#463's rule, and the address book's): it is
  // what a buyer is filed under here, and filing them under the printed legal name would quietly
  // make a second contact for somebody who is already in the book.
  const buyerId = plan.buyer.name
    ? await resolvePurchaseContact(collectionId, { name: plan.buyer.name, role: "buyer" })
    : null;

  const saleId = await createSale(ownerId, collectionId, {
    platformId: platform.id,
    buyerId,
    // Delcampe's order number, which is what makes a second import a link rather than a second sale.
    externalRef: orderId,
    transactionUrl: order.orderUrl.trim() || null,
    soldAt,
    currency,
    buyerHandling: null,
    buyerPaidTotal: plan.buyerPaidTotal,
    commission: null,
    shipping: null,
  });

  try {
    await addSaleLines(ownerId, saleId, plan.lines);
  } catch (err) {
    // All lines or nothing, kept true even against a race: everything above said this order could be
    // recorded whole, so a failure here is a copy that sold in another tab between the check and the
    // write. The header this call created seconds ago carries no lines and stands for nothing, and
    // leaving it behind would be an empty sale nobody asked for holding this order's number — which
    // is also what would make the next attempt answer "already recorded".
    await deleteSale(ownerId, saleId).catch(() => {});
    throw new DelcampeOrderError(
      err instanceof Error ? err.message : "The sold sets could not be recorded."
    );
  }

  // Only where the contact has no legal name of its own: an empty field gains what Delcampe printed,
  // and a name the collector wrote is never overwritten by a marketplace. Deliberately the whole of
  // what this flow adds to a contact — Allegro's counterpart also fills an e-mail, and there is no
  // e-mail here worth keeping.
  if (buyerId && plan.buyer.fullName) {
    const buyer = await prisma.contact.findFirst({
      where: { id: buyerId, collectionId },
      select: { fullName: true },
    });
    if (buyer && !buyer.fullName) {
      await prisma.contact.update({ where: { id: buyerId }, data: { fullName: plan.buyer.fullName } });
    }
  }

  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: { saleNo: true, status: true },
  });
  return {
    orderId,
    saleId,
    saleNo: sale?.saleNo ?? 0,
    path: salePath(saleId),
    status: sale?.status ?? "ordered",
    created: true,
  };
}

/**
 * Which offer each row of the order is, and what it still has to sell.
 *
 * The sellable sets come from the picker's own reader (`listSellableOffers`), narrowed to the
 * Delcampe platform and read **once** for the whole order rather than per row: a parcel is several
 * offers, and the question "what has this offer left" is one query for all of them. An offer that is
 * not in that list — sold, withdrawn, or every set already gone — comes back with no sets, and the
 * planner refuses it by name.
 */
async function matchOrderItems(
  ownerId: string,
  collectionId: string,
  platformId: string,
  order: DelcampeOrderInput
): Promise<DelcampeOrderCandidate[]> {
  const itemIds = [...new Set(order.lines.map((line) => line.itemId))];
  const referencedOfferNos = [
    ...new Set(
      order.lines.flatMap((line) => {
        const offerNo = offerNoFromPersonalReference(line.reference);
        return offerNo === null ? [] : [offerNo];
      })
    ),
  ];

  const [byItemId, byOfferNo, sellable] = await Promise.all([
    itemIds.length > 0
      ? prisma.offer.findMany({
          where: { collectionId, delcampeItemId: { in: itemIds } },
          select: { id: true, offerNo: true, name: true, platformId: true, delcampeItemId: true },
        })
      : [],
    referencedOfferNos.length > 0
      ? prisma.offer.findMany({
          where: { collectionId, offerNo: { in: referencedOfferNos } },
          select: { id: true, offerNo: true, name: true, platformId: true, delcampeItemId: true },
        })
      : [],
    listSellableOffers(ownerId, collectionId, { platformId }),
  ]);

  const itemIndex = new Map(
    byItemId.flatMap((offer) => (offer.delcampeItemId ? [[offer.delcampeItemId, offer]] : []))
  );
  const offerNoIndex = new Map(byOfferNo.map((offer) => [offer.offerNo, offer]));
  const setsByOffer = new Map(sellable.map((offer) => [offer.offerId, offer.sets]));

  return order.lines.map((line) => {
    const referencedNo = offerNoFromPersonalReference(line.reference);
    const hit = itemIndex.get(line.itemId);
    const viaReference = referencedNo === null ? undefined : offerNoIndex.get(referencedNo);
    const offer = hit ?? viaReference;
    if (!offer || offer.platformId !== platformId) {
      // An offer of this collection that is on another platform is not this order's — the same
      // listing id cannot be on two marketplaces, and a reference somebody re-used could be.
      return { itemId: line.itemId, offer: null, matchedBy: null, sets: [] };
    }
    return {
      itemId: line.itemId,
      offer: {
        id: offer.id,
        offerNo: offer.offerNo,
        label: offer.name ?? `Offer #${offer.offerNo}`,
      },
      matchedBy: hit ? "item-id" : "reference",
      sets: (setsByOffer.get(offer.id) ?? []).map((set) => ({
        offerSetId: set.offerSetId,
        label: set.label,
        itemIds: set.itemIds,
      })),
    };
  });
}
