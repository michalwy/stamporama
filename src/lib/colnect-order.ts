import "server-only";
import { prisma } from "./db";
import { COLNECT_PLATFORM_MODULE } from "./platform-modules";
import { getModulePlatform } from "./module-platform";
import { resolvePurchaseContact } from "./contacts";
import { addSaleLines, createSale, deleteSale, listSellableOffers } from "./sales";
import { getShippingMethods } from "./shipping-methods";
import { matchShippingMethod } from "./allegro-sale-rules";
import { parseSaleDate } from "./sale-rules";
import { saleImportSummary, type ImportedSaleSummary } from "./order-import-summary";
import {
  describeColnectOrderProblems,
  planColnectOrderSale,
  type ColnectOrderCandidate,
  type ColnectOrderInput,
  type ColnectOrderProblem,
} from "./colnect-order-rules";

// Recording one Colnect **transaction** as a `Sale` (#698; ADR-0041) — the write half of the marks
// the Assistant draws on Colnect's own transaction screens.
//
// The Delcampe import's twin (#612), and deliberately its shape: **one transaction is one sale for
// ever** (a re-import answers with the sale that claims it and writes nothing), and **all lines or
// nothing** (the click happens on Colnect's page with nothing reviewed in between, so an order that
// cannot be recorded whole is not recorded at all and every reason is named at once).
//
// Three things differ, and each is something Colnect states that Delcampe did not:
//
//   * **One join key.** A transaction row prints no seller reference, only the listing's own sale
//     code, so a row finds its offer through `Offer.colnectSaleId` (#696) and nowhere else. The way
//     through a refusal is to put the listing's address on the offer — or to record that sale from
//     the offer's own screen — and then press the same button again.
//   * **A pick instead of a refusal** (#697). A matched offer with more sets left than the row
//     bought records the lowest ones and flags the line: the sets of one offer are the same thing at
//     the same price, so which copy leaves is the seller's own choice at the packing table.
//   * **A shipping method** (#468). Colnect names one, so it is written as printed, and matched
//     against the platform's own dictionary where the name is one the collector already keeps. The
//     FK is the convenience; the printed name is the record.
//
// **Nothing is written to Colnect.** The Assistant reads these screens and clicks none of their
// buttons: `Items sent` is Colnect's ladder and `Sale.status` is the collector's own (#191/#492).
// And nothing about the buyer beyond a login and a name is read, though the same page prints their
// full postal address — what never arrives here can never be stored (ADR-0038 §4).

/** A refusal about the transaction as a whole — an unowned collection, no Colnect platform, or the
 *  reasons the rules gave for not recording it. `problems` carries them one per row where there are
 *  rows to blame, so the page can say which listing to go and fix. */
export class ColnectOrderError extends Error {
  readonly problems: ColnectOrderProblem[];

  constructor(message: string, problems: ColnectOrderProblem[] = []) {
    super(message);
    this.name = "ColnectOrderError";
    this.problems = problems;
  }
}

/** The sale one Colnect transaction is here, as the mark draws it. `path` is **relative**, the offer
 *  lookup's own rule (#466): the instance answers where the sale is on itself, and the extension
 *  joins that to the base URL it authenticated against. */
export interface ColnectOrderSaleMatch {
  orderId: string;
  saleId: string;
  saleNo: number;
  path: string;
  /** The sale's fulfillment status (#191) — the collector's own workflow, worth seeing beside a
   *  Colnect ladder that says something different. */
  status: string;
}

/** How many transactions one lookup may ask about. The transaction list shows a page of them, never
 *  a thousand; the cap is the offer lookup's guard against a page that would ask about everything. */
const ORDER_LOOKUP_LIMIT = 200;

async function collectionOf(ownerId: string, collectionId: string): Promise<{ slug: string }> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { slug: true },
  });
  if (!collection) throw new ColnectOrderError("Collection not found.");
  return collection;
}

/**
 * Which of these Colnect transactions are already recorded here (#698).
 *
 * Matched on `Sale.externalRef` — the column an Allegro order number (#479) and a Delcampe order id
 * (#612) also go into — and narrowed to the platform this collection calls Colnect, so a Delcampe
 * order that happens to carry the same characters never answers for a Colnect one.
 *
 * **Many transactions per call**, because the transaction list is a list: asking per row would be a
 * request per row. A miss is an absent entry rather than an error — a transaction not yet recorded
 * is the ordinary case, and it is the one the *Import* affordance exists for.
 */
export async function findSalesForColnectOrders(
  ownerId: string,
  collectionId: string,
  orderIds: string[]
): Promise<ColnectOrderSaleMatch[]> {
  const collection = await collectionOf(ownerId, collectionId);
  const ids = [...new Set(orderIds.map((id) => id.trim()).filter(Boolean))].slice(
    0,
    ORDER_LOOKUP_LIMIT
  );
  if (ids.length === 0) return [];

  const platform = await getModulePlatform(collectionId, COLNECT_PLATFORM_MODULE);
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
export interface ColnectOrderImportResult extends ColnectOrderSaleMatch {
  /** False when the transaction was already recorded — the answer is then a link and nothing was
   *  written. */
  created: boolean;
  /** What the sale says, for the window the collector is reading this in. Stated for a sale that was
   *  already there as well as one just written: a re-import is a link, and a link worth following is
   *  worth describing. */
  summary: ImportedSaleSummary | null;
}

/**
 * Record one transaction as a sale.
 *
 * The order of operations is the order of the refusals: the platform, then the sale that may already
 * claim this transaction, then which offers the rows are, then whether the whole thing can be
 * recorded. Nothing is written until every one of those has an answer.
 */
export async function importColnectOrder(
  ownerId: string,
  collectionId: string,
  order: ColnectOrderInput
): Promise<ColnectOrderImportResult> {
  const collection = await collectionOf(ownerId, collectionId);
  const orderId = order.orderId.trim();
  if (!orderId) throw new ColnectOrderError("That screen states no Colnect transaction id.");

  const platform = await getModulePlatform(collectionId, COLNECT_PLATFORM_MODULE);
  if (!platform) {
    throw new ColnectOrderError(
      "No platform is marked as Colnect yet, so there is nothing to record this transaction against. Settings → Colnect."
    );
  }

  const salePath = (saleId: string) => `/c/${encodeURIComponent(collection.slug)}/sales/${saleId}`;

  // One transaction is one sale. The existing one is the answer, not a conflict: the collector
  // pressed *Import* on a page whose mark had not caught up, or on the same page twice.
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
      summary: await saleImportSummary(collectionId, existing.id),
    };
  }

  const contact = await prisma.contact.findFirst({
    where: { id: platform.id, collectionId },
    select: { platformCurrency: true },
  });
  const currency = contact?.platformCurrency ?? null;
  if (!currency) {
    throw new ColnectOrderError(
      `${platform.name} has no currency set, so a transaction's amounts cannot be read into a sale. Settings → Colnect.`
    );
  }

  const candidates = await matchOrderItems(ownerId, collectionId, platform.id, order);
  const plan = planColnectOrderSale(order, { currency, candidates });
  if (!plan.ok) {
    throw new ColnectOrderError(describeColnectOrderProblems(plan.problems), plan.problems);
  }
  // Through the sale form's own reader, and not `new Date(...)`: `Sale.soldAt` is a date column that
  // the FX freeze hangs off, and a local midnight is the previous day in every timezone west of UTC.
  const soldAt = parseSaleDate(plan.soldAt);
  if (!soldAt) {
    throw new ColnectOrderError("The date this transaction states could not be read as a sale date.");
  }

  // The buyer is found or created under their **login** (#463's rule, and the address book's): it is
  // what a buyer is filed under here, and filing them under the printed legal name would quietly
  // make a second contact for somebody who is already in the book.
  const buyerId = plan.buyer.name
    ? await resolvePurchaseContact(collectionId, { name: plan.buyer.name, role: "buyer" })
    : null;

  // How it went, as Colnect printed it (#468). Matched against the platform's own price list by
  // name, which is the only thing the two lists share — an unmatched name is recorded as a one-off
  // and still records the sale, because what carried the parcel is a fact whether or not the
  // collector keeps a row for it. **No cost**: the dictionary's figure is what postage *usually*
  // costs the collector, and nothing on this page says what this parcel cost them (#206).
  const printedMethod = plan.shippingMethodName;
  const shipping = printedMethod
    ? matchShippingMethod(await getShippingMethods(ownerId, platform.id), printedMethod)
    : null;

  const saleId = await createSale(ownerId, collectionId, {
    platformId: platform.id,
    buyerId,
    // Colnect's transaction id, which is what makes a second import a link rather than a second sale.
    externalRef: orderId,
    transactionUrl: order.orderUrl.trim() || null,
    soldAt,
    currency,
    buyerHandling: null,
    buyerPaidTotal: plan.buyerPaidTotal,
    commission: null,
    shipping: shipping
      ? { methodId: shipping.methodId, methodName: shipping.methodName, cost: null, currency: "" }
      : null,
  });

  try {
    await addSaleLines(ownerId, saleId, plan.lines);
  } catch (err) {
    // All lines or nothing, kept true even against a race: everything above said this transaction
    // could be recorded whole, so a failure here is a copy that sold in another tab between the
    // check and the write. The header this call created seconds ago carries no lines and stands for
    // nothing, and leaving it behind would be an empty sale holding this transaction's id — which is
    // also what would make the next attempt answer "already recorded".
    await deleteSale(ownerId, saleId).catch(() => {});
    throw new ColnectOrderError(
      err instanceof Error ? err.message : "The sold sets could not be recorded."
    );
  }

  // Only where the contact has no legal name of its own: an empty field gains what Colnect printed,
  // and a name the collector wrote is never overwritten by a marketplace.
  if (buyerId && plan.buyer.fullName) {
    const buyer = await prisma.contact.findFirst({
      where: { id: buyerId, collectionId },
      select: { fullName: true },
    });
    if (buyer && !buyer.fullName) {
      await prisma.contact.update({
        where: { id: buyerId },
        data: { fullName: plan.buyer.fullName },
      });
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
    summary: await saleImportSummary(collectionId, saleId),
  };
}

/**
 * Which offer each row of the transaction is, and what it still has to sell.
 *
 * **One key only**: `Offer.colnectSaleId` (#696), unique per collection, written wherever the
 * offer's URL is written. Colnect prints no reference of the seller's own on a transaction row, so
 * there is no second reading to fall back on and none is invented — a listing this collection never
 * recorded an address for simply matches nothing, and the refusal says exactly that.
 *
 * The sellable sets come from the picker's own reader (`listSellableOffers`), narrowed to the
 * Colnect platform and read **once** for the whole transaction rather than per row, and they arrive
 * in the offer's own order — which is what makes #697's pick the *lowest* sets rather than arbitrary
 * ones. An offer that is not in that list — sold, withdrawn, or every set already gone — comes back
 * with no sets, and the planner refuses it by name.
 */
async function matchOrderItems(
  ownerId: string,
  collectionId: string,
  platformId: string,
  order: ColnectOrderInput
): Promise<ColnectOrderCandidate[]> {
  const saleCodes = [...new Set(order.lines.map((line) => line.saleCode))];

  const [offers, sellable] = await Promise.all([
    saleCodes.length > 0
      ? prisma.offer.findMany({
          where: { collectionId, colnectSaleId: { in: saleCodes } },
          select: { id: true, offerNo: true, name: true, platformId: true, colnectSaleId: true },
        })
      : [],
    listSellableOffers(ownerId, collectionId, { platformId }),
  ]);

  const byCode = new Map(
    offers.flatMap((offer) => (offer.colnectSaleId ? [[offer.colnectSaleId, offer]] : []))
  );
  const setsByOffer = new Map(sellable.map((offer) => [offer.offerId, offer.sets]));

  return order.lines.map((line) => {
    const offer = byCode.get(line.saleCode);
    if (!offer || offer.platformId !== platformId) {
      // An offer of this collection that is on another platform is not this transaction's: one live
      // listing is one marketplace's, and a sale code stored against something else is a mistake to
      // report rather than a match to make.
      return { saleCode: line.saleCode, offer: null, sets: [] };
    }
    return {
      saleCode: line.saleCode,
      offer: {
        id: offer.id,
        offerNo: offer.offerNo,
        label: offer.name ?? `Offer #${offer.offerNo}`,
      },
      sets: (setsByOffer.get(offer.id) ?? []).map((set) => ({
        offerSetId: set.offerSetId,
        label: set.label,
        itemIds: set.itemIds,
      })),
    };
  });
}
