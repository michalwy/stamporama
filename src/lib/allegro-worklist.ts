import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getModulePlatform } from "./module-platform";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";
import {
  syncFreshness,
  type AllegroMatchBasis,
  type AllegroPaymentStatus,
  type SyncFreshness,
} from "./allegro-sync-rules";

/**
 * What the Allegro sync has to say (#467; ADR-0024) — the read half, and the whole of the worklist
 * screen's data.
 *
 * Two sections, because they ask for two different things:
 *
 *  • **Sold, awaiting sale** — order lines observed on Allegro with no `Sale` recorded here. A row
 *    leaves the list when the sale exists, which is what makes it a list that empties rather than a
 *    search to be repeated. A line matching no local offer is **shown** rather than dropped: that is
 *    how the collector learns a listing was posted outside Stamporama, or that its URL was never
 *    recorded here.
 *  • **Ended without selling** — a listing that has dropped out of the account's active offers while
 *    the offer here is still live. Nothing sold, so there is no sale to record; what is wrong is the
 *    state of the offer on this side, and that is a different action.
 *
 * A **cancelled** order appears in neither. The sale did not happen, and putting it in a worklist
 * would be this app suggesting a financial record on the strength of an order the buyer withdrew.
 * Nor does an order a **merged one has taken over** (#495): its purchases are all on the order that
 * absorbed them, and showing both would ask for the same sale twice.
 *
 * Nothing here writes. Whether the sale gets made is the collector's, through the sell flow each row
 * reaches (#166, and #463 once it can pre-fill that flow from the order).
 */

/** One offer of this collection, as a worklist row names it. Shaped so the row can open the existing
 *  sell flow without a second read. */
export interface WorklistOffer {
  id: string;
  offerNo: number;
  name: string | null;
  /** What the row shows: the stored listing title, or the offer's own number where it has none. */
  label: string;
  state: string;
  price: string;
  currency: string;
  platformId: string;
  platformName: string;
  url: string | null;
}

export interface WorklistLine {
  id: string;
  platformOfferId: string;
  title: string;
  quantity: number;
  unitPrice: string;
  currency: string;
  offer: WorklistOffer | null;
  matchedBy: AllegroMatchBasis | null;
  /** Whether this line's offer is already on the sale claiming the order (#463). A partially
   *  recorded order stays on the worklist, and this is what says which of it is done. */
  recorded: boolean;
}

export interface WorklistOrder {
  orderId: string;
  boughtAt: string;
  paymentStatus: AllegroPaymentStatus;
  orderStatus: string;
  /** Who bought it: their Allegro login, and their name or company where the order states one.
   *  Nothing else about them — the sale is where a buyer becomes a `Contact` (#463). */
  buyerLogin: string | null;
  buyerName: string | null;
  /** What the buyer paid in total, delivery included, in `currency`. Null where Allegro stated no
   *  summary — in which case the lines are still all there to be added up by eye. */
  totalPaid: string | null;
  currency: string | null;
  /** When the sync last saw this order. An undated "sold" says nothing about how current it is. */
  observedAt: string;
  lines: WorklistLine[];
  /** The sale this order almost certainly *is* (#480), derived rather than searched for — see
   *  {@link deriveSuggestedSales}. Null wherever the data says anything but one thing. */
  suggestedSale: SuggestedSale | null;
  /** The sale that already carries this order number, on an order that is **partly** recorded
   *  (#463). A fully recorded order is gone from the list altogether, so this is never set on one:
   *  it means "this much is done, the rest is still yours". */
  recordedSale: { id: string; saleNo: number } | null;
}

/** A sale the app worked out on its own, offered for one click. */
export interface SuggestedSale {
  id: string;
  saleNo: number;
  soldAt: string;
  currency: string;
  total: string;
}

export interface WorklistEndedListing {
  platformOfferId: string;
  title: string;
  /** When the listing was last seen **up** on Allegro. */
  lastSeenAt: string;
  endingAt: string | null;
  offer: WorklistOffer;
}

export interface AllegroWorklist {
  /** Whether there is a grant to sync with at all, and whether it has stopped working. Both come
   *  from the connection rather than from the sync: "not connected" is not a failed sync. */
  connected: boolean;
  needsReconnect: boolean;
  connectionError: string | null;
  /** The platform contact marked as Allegro, or null — with none, every line is unmatched, and the
   *  screen says so rather than quietly showing a page of unmatched rows. */
  platform: { id: string; name: string } | null;
  sync: {
    lastSucceededAt: string | null;
    lastFailedAt: string | null;
    lastError: string | null;
    running: boolean;
    listingsSweptAt: string | null;
    freshness: SyncFreshness;
    /** The event poll's own date and error (#481). Separate from the pass above because it runs on
     *  its own two-minute cadence over both of Allegro's event streams: "when did we last look for
     *  something new" and "when did we last read the account end to end" are two questions, and one
     *  date answering both would be wrong about one of them. */
    eventPolledAt: string | null;
    eventPollError: string | null;
  };
  orders: WorklistOrder[];
  ended: WorklistEndedListing[];
}

/** The states an offer can be in and still be waiting to be sold or corrected. A terminal offer is
 *  already resolved, whatever the marketplace has since done with the listing. */
const LIVE_OFFER_STATES = ["preparing", "ready", "active", "paused"];

/** How far either side of the order's own date a candidate sale is looked for (#479). Wide, because
 *  a collector who records sales in batches may be weeks behind the marketplace — but not unbounded,
 *  since a picker of every sale ever made is not a picker. */
const LINK_WINDOW_DAYS = 90;

/** How many candidates the picker offers. Ordered by how close their date is to the order's, so the
 *  cut falls on the least likely ones. */
const LINK_CANDIDATE_LIMIT = 25;

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

type OfferRow = {
  id: string;
  offerNo: number;
  name: string | null;
  state: string;
  price: { toString(): string };
  currency: string;
  platformId: string;
  platform: { name: string };
  url: string | null;
};

function toWorklistOffer(offer: OfferRow): WorklistOffer {
  return {
    id: offer.id,
    offerNo: offer.offerNo,
    name: offer.name,
    // The derived set label (#379) is deliberately not built here: it needs the offer's whole
    // composition and the area tree, which is a page of reads for a line that already names the
    // listing in the marketplace's own words. The offer number is the honest fallback.
    label: offer.name ?? `Offer #${offer.offerNo}`,
    state: offer.state,
    price: offer.price.toString(),
    currency: offer.currency,
    platformId: offer.platformId,
    platformName: offer.platform.name,
    url: offer.url,
  };
}

const OFFER_SELECT = {
  id: true,
  offerNo: true,
  name: true,
  state: true,
  price: true,
  currency: true,
  platformId: true,
  platform: { select: { name: true } },
  url: true,
} as const;

export async function getAllegroWorklist(
  ownerId: string,
  collectionId: string
): Promise<AllegroWorklist> {
  await assertCollectionOwner(ownerId, collectionId);

  const [connection, state, platform] = await Promise.all([
    prisma.allegroConnection.findUnique({
      where: { collectionId },
      select: { refreshTokenSealed: true, needsReconnect: true, lastError: true },
    }),
    prisma.allegroSyncState.findUnique({ where: { collectionId } }),
    getModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE),
  ]);

  const now = new Date();
  const sync = {
    lastSucceededAt: state?.lastSucceededAt?.toISOString() ?? null,
    lastFailedAt: state?.lastFailedAt?.toISOString() ?? null,
    lastError: state?.lastError ?? null,
    running: state?.running ?? false,
    listingsSweptAt: state?.listingsSweptAt?.toISOString() ?? null,
    eventPolledAt: state?.eventPolledAt?.toISOString() ?? null,
    eventPollError: state?.eventPollError ?? null,
    freshness: syncFreshness(
      { lastSucceededAt: state?.lastSucceededAt ?? null, lastError: state?.lastError ?? null },
      now
    ),
  };

  const orderRows = await prisma.allegroOrder.findMany({
    // An order a merged one has taken over is gone from here altogether (#495). Its purchases have
    // not disappeared — they are on the order that absorbed them, which is the one shown — so leaving
    // the original standing would be the worklist asking twice for the same sale.
    where: { collectionId, paymentStatus: { not: "cancelled" }, supersededByOrderId: null },
    orderBy: { boughtAt: "desc" },
    select: {
      orderId: true,
      boughtAt: true,
      paymentStatus: true,
      status: true,
      buyerLogin: true,
      buyerName: true,
      totalPaid: true,
      currency: true,
      observedAt: true,
      lines: {
        orderBy: { boughtAt: "asc" },
        select: {
          id: true,
          platformOfferId: true,
          title: true,
          quantity: true,
          unitPrice: true,
          currency: true,
          matchedBy: true,
          offer: { select: OFFER_SELECT },
        },
      },
    },
  });

  // Which of those orders is already a sale here, and **how much of it**. `externalRef` is the
  // marketplace's own order number by the schema's own definition, so this is the same key #463
  // writes — one order can therefore never produce two sales.
  //
  // A claimed order is not automatically a finished one (#463). Where the sale covers only some of
  // the order's lines — a multi-item order whose second offer could not be matched, or one recorded
  // a line at a time — the order **stays here**, marked, with the rest still offered. The two sides
  // are compared on the offer, which is the only thing they share: `SaleLine.offerId` against the
  // offer each ordered line matched.
  const claims = await prisma.sale.findMany({
    where: { collectionId, externalRef: { in: orderRows.map((row) => row.orderId) } },
    select: { id: true, saleNo: true, externalRef: true, lines: { select: { offerId: true } } },
  });
  const claimByOrder = new Map(
    claims.flatMap((sale) => (sale.externalRef ? [[sale.externalRef, sale] as const] : []))
  );

  const orders: WorklistOrder[] = orderRows.flatMap((row) => {
    const claim = claimByOrder.get(row.orderId) ?? null;
    const covered = new Set(
      (claim?.lines ?? []).flatMap((line) => (line.offerId ? [line.offerId] : []))
    );
    // A claimed sale whose lines name no offer at all — every one of them detached by an offer
    // deletion (`SetNull`) — cannot be compared line by line. It is still a real sale for this
    // order, so the order counts as recorded rather than being re-offered wholesale.
    const uncomparable = claim !== null && claim.lines.length > 0 && covered.size === 0;

    const lines = row.lines.map((line) => ({
      id: line.id,
      platformOfferId: line.platformOfferId,
      title: line.title,
      quantity: line.quantity,
      unitPrice: line.unitPrice.toString(),
      currency: line.currency,
      offer: line.offer ? toWorklistOffer(line.offer) : null,
      matchedBy: (line.matchedBy as AllegroMatchBasis | null) ?? null,
      recorded: Boolean(line.offer && covered.has(line.offer.id)),
    }));

    if (claim && (uncomparable || lines.every((line) => line.recorded))) return [];

    return [
      {
        orderId: row.orderId,
        boughtAt: row.boughtAt.toISOString(),
        paymentStatus: row.paymentStatus as AllegroPaymentStatus,
        orderStatus: row.status,
        buyerLogin: row.buyerLogin,
        buyerName: row.buyerName,
        totalPaid: row.totalPaid?.toString() ?? null,
        currency: row.currency,
        observedAt: row.observedAt.toISOString(),
        lines,
        suggestedSale: null,
        recordedSale: claim ? { id: claim.id, saleNo: claim.saleNo } : null,
      },
    ];
  });

  await attachSuggestedSales(collectionId, orders);

  // An offer already sitting in the sold section is not also reported as having ended: the listing
  // is gone from Allegro because it sold, which is the first section's business.
  const awaiting = new Set(
    orders.flatMap((order) => order.lines.flatMap((line) => (line.offer ? [line.offer.id] : [])))
  );

  const endedRows = await prisma.allegroListing.findMany({
    where: {
      collectionId,
      status: "ENDED",
      offerId: { not: null },
      offer: { state: { in: LIVE_OFFER_STATES } },
    },
    orderBy: { observedAt: "desc" },
    select: {
      platformOfferId: true,
      title: true,
      observedAt: true,
      endingAt: true,
      offer: { select: OFFER_SELECT },
    },
  });

  const ended = endedRows.flatMap((row) => {
    // An unmatched ended listing is deliberately not reported. It is a listing this collection never
    // claimed, and the action it would ask for — correct an offer — has no offer to point at.
    if (!row.offer || awaiting.has(row.offer.id)) return [];
    return [
      {
        platformOfferId: row.platformOfferId,
        title: row.title,
        lastSeenAt: row.observedAt.toISOString(),
        endingAt: row.endingAt?.toISOString() ?? null,
        offer: toWorklistOffer(row.offer),
      },
    ];
  });

  return {
    connected: Boolean(connection?.refreshTokenSealed),
    needsReconnect: connection?.needsReconnect ?? false,
    connectionError: connection?.needsReconnect ? (connection.lastError ?? null) : null,
    platform,
    sync,
    orders,
    ended,
  };
}

/**
 * The sale each order almost certainly **is** (#480), worked out rather than searched for.
 *
 * #479's picker judges candidates by date and total, which asks the collector to recognise something
 * the data already states: a line matched an offer (#467), and `SaleLine.offerId` points at that
 * same offer from the sale's side. Where those two meet on exactly one sale, there is nothing to
 * recognise.
 *
 * **Exactly one, and unclaimed.** Several is not a failure to be broken by picking the nearest date:
 * an offer can sit on several sales (#473 sells one set at a time) and a multi-line order can point
 * at different ones, so where the data says two things the collector decides. A sale already naming
 * another order is spoken for and is not a candidate at all.
 *
 * It is a **proposal**. Nothing here writes, and the sync never writes `externalRef` on its own: an
 * inferred link that silently emptied a row would take the signal away exactly when the inference
 * was wrong.
 *
 * One query for the whole page — the offers are already on the rows.
 */
async function attachSuggestedSales(
  collectionId: string,
  orders: WorklistOrder[]
): Promise<void> {
  const offerIds = [
    ...new Set(
      orders.flatMap((order) => order.lines.flatMap((line) => (line.offer ? [line.offer.id] : [])))
    ),
  ];
  if (offerIds.length === 0) return;

  const sales = await prisma.sale.findMany({
    where: { collectionId, lines: { some: { offerId: { in: offerIds } } } },
    select: {
      id: true,
      saleNo: true,
      soldAt: true,
      currency: true,
      externalRef: true,
      lines: { select: { offerId: true, price: true } },
    },
  });

  // Which sales each offer appears on, so an order is answered from its own offers rather than by
  // scanning every sale again per order.
  const salesByOffer = new Map<string, typeof sales>();
  for (const sale of sales) {
    for (const line of sale.lines) {
      if (!line.offerId) continue;
      const list = salesByOffer.get(line.offerId);
      if (list) list.push(sale);
      else salesByOffer.set(line.offerId, [sale]);
    }
  }

  for (const order of orders) {
    // An order already claimed by a sale (the partially recorded case, #463) proposes nothing: the
    // link exists, and offering a *different* sale for it would be offering something the domain
    // layer refuses by name.
    if (order.recordedSale) continue;
    const candidates = new Map<string, (typeof sales)[number]>();
    for (const line of order.lines) {
      if (!line.offer) continue;
      for (const sale of salesByOffer.get(line.offer.id) ?? []) {
        // A sale that already names an order is spoken for — including one naming *this* order,
        // which cannot happen here (such an order has already left the list) but which the rule
        // states anyway rather than relying on that.
        if (sale.externalRef) continue;
        candidates.set(sale.id, sale);
      }
    }
    if (candidates.size !== 1) continue;
    const [sale] = [...candidates.values()];
    order.suggestedSale = {
      id: sale.id,
      saleNo: sale.saleNo,
      soldAt: sale.soldAt.toISOString(),
      currency: sale.currency,
      total: sale.lines
        .reduce((sum, line) => sum.add(line.price), new Prisma.Decimal(0))
        .toFixed(2),
    };
  }
}

// ---------------------------------------------------------------------------
// Linking an order to a sale already recorded by hand (#479)
// ---------------------------------------------------------------------------
//
// The worklist drops an order the moment a `Sale` carries its id as `externalRef`. That works
// perfectly for a sale recorded *from* this screen and not at all for one recorded before the sync
// existed — the two are the same transaction and neither knows about the other. This is the second
// direction of the same one key: point the order at the sale that is already there.
//
// It writes **only** `externalRef`. The collector recorded that sale deliberately, with its own
// amounts, buyer and lines, and a sync has no business correcting any of it.

/** One sale the picker can offer for an order. */
export interface LinkableSale {
  id: string;
  saleNo: number;
  soldAt: string;
  currency: string;
  /** The sale's gross, so two sales a day apart can be told apart by the figure rather than by
   *  opening both. Summed from the lines, which is what the sales list shows. */
  total: string;
  buyerName: string | null;
  platformName: string;
  lineCount: number;
}

/**
 * Sales that could be this order, nearest date first.
 *
 * **Only sales with no order number.** One that already names an order is spoken for, and offering
 * it would be offering to overwrite a link somebody made — which this never does.
 *
 * Scoped to the platform marked as Allegro where one is set. With none set the scope is the whole
 * collection: the collector has not told us which platform this is, and refusing to help on that
 * basis would be pedantry when the date and the total are right there to judge by.
 */
export async function listSalesLinkableToAllegroOrder(
  ownerId: string,
  collectionId: string,
  orderId: string
): Promise<LinkableSale[]> {
  await assertCollectionOwner(ownerId, collectionId);

  const order = await prisma.allegroOrder.findUnique({
    where: { collectionId_orderId: { collectionId, orderId } },
    select: { boughtAt: true },
  });
  if (!order) return [];

  const platform = await getModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE);
  const window = LINK_WINDOW_DAYS * 24 * 60 * 60 * 1000;

  const sales = await prisma.sale.findMany({
    where: {
      collectionId,
      externalRef: null,
      ...(platform ? { platformId: platform.id } : {}),
      soldAt: {
        gte: new Date(order.boughtAt.getTime() - window),
        lte: new Date(order.boughtAt.getTime() + window),
      },
    },
    select: {
      id: true,
      saleNo: true,
      soldAt: true,
      currency: true,
      buyer: { select: { name: true } },
      platform: { select: { name: true } },
      lines: { select: { price: true } },
    },
  });

  // Sorted here rather than in the query: the ordering is by *distance* from the order's own date,
  // which is not a column and which Postgres would need an expression index to answer.
  return sales
    .sort(
      (a, b) =>
        Math.abs(a.soldAt.getTime() - order.boughtAt.getTime()) -
        Math.abs(b.soldAt.getTime() - order.boughtAt.getTime())
    )
    .slice(0, LINK_CANDIDATE_LIMIT)
    .map((sale) => ({
      id: sale.id,
      saleNo: sale.saleNo,
      soldAt: sale.soldAt.toISOString(),
      currency: sale.currency,
      total: sale.lines
        .reduce((sum, line) => sum.add(line.price), new Prisma.Decimal(0))
        .toFixed(2),
      buyerName: sale.buyer?.name ?? null,
      platformName: sale.platform.name,
      lineCount: sale.lines.length,
    }));
}

/** Raised for the two ways a link is refused, so the caller can say which. */
export class AllegroLinkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AllegroLinkError";
  }
}

/**
 * Point an order at a sale, by writing the order id into the sale's `externalRef`.
 *
 * Refuses rather than duplicates. Two sales claiming one order would put the same money in the books
 * twice and leave the worklist unable to say which of them is the record — so an order already
 * claimed is an error naming the sale that holds it, and a sale that already names some *other*
 * order is never quietly rewritten.
 */
export async function linkAllegroOrderToSale(
  ownerId: string,
  collectionId: string,
  orderId: string,
  saleId: string
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);

  const order = await prisma.allegroOrder.findUnique({
    where: { collectionId_orderId: { collectionId, orderId } },
    select: { id: true },
  });
  if (!order) throw new AllegroLinkError("That Allegro order is not in this collection.");

  const claimed = await prisma.sale.findFirst({
    where: { collectionId, externalRef: orderId },
    select: { saleNo: true },
  });
  if (claimed) {
    throw new AllegroLinkError(
      `Sale #${claimed.saleNo} already carries that order number. One order cannot be two sales.`
    );
  }

  const sale = await prisma.sale.findFirst({
    where: { id: saleId, collectionId },
    select: { externalRef: true, saleNo: true },
  });
  if (!sale) throw new AllegroLinkError("That sale is not in this collection.");
  if (sale.externalRef) {
    throw new AllegroLinkError(
      `Sale #${sale.saleNo} already carries order number ${sale.externalRef}. Clear it on the sale first if it is wrong.`
    );
  }

  await prisma.sale.update({ where: { id: saleId }, data: { externalRef: orderId } });
}
