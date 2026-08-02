import "server-only";
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
  };
  orders: WorklistOrder[];
  ended: WorklistEndedListing[];
}

/** The states an offer can be in and still be waiting to be sold or corrected. A terminal offer is
 *  already resolved, whatever the marketplace has since done with the listing. */
const LIVE_OFFER_STATES = ["preparing", "ready", "active", "paused"];

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
    freshness: syncFreshness(
      { lastSucceededAt: state?.lastSucceededAt ?? null, lastError: state?.lastError ?? null },
      now
    ),
  };

  const orderRows = await prisma.allegroOrder.findMany({
    where: { collectionId, paymentStatus: { not: "cancelled" } },
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

  // Which of those orders is already a sale here. `externalRef` is the marketplace's own order
  // number by the schema's own definition, so this is the same key #463 writes — one order can
  // therefore never produce two sales, and a row leaves the worklist the moment one exists.
  const recorded = new Set(
    (
      await prisma.sale.findMany({
        where: { collectionId, externalRef: { in: orderRows.map((row) => row.orderId) } },
        select: { externalRef: true },
      })
    ).flatMap((sale) => (sale.externalRef ? [sale.externalRef] : []))
  );

  const orders: WorklistOrder[] = orderRows
    .filter((row) => !recorded.has(row.orderId))
    .map((row) => ({
      orderId: row.orderId,
      boughtAt: row.boughtAt.toISOString(),
      paymentStatus: row.paymentStatus as AllegroPaymentStatus,
      orderStatus: row.status,
      buyerLogin: row.buyerLogin,
      buyerName: row.buyerName,
      totalPaid: row.totalPaid?.toString() ?? null,
      currency: row.currency,
      observedAt: row.observedAt.toISOString(),
      lines: row.lines.map((line) => ({
        id: line.id,
        platformOfferId: line.platformOfferId,
        title: line.title,
        quantity: line.quantity,
        unitPrice: line.unitPrice.toString(),
        currency: line.currency,
        offer: line.offer ? toWorklistOffer(line.offer) : null,
        matchedBy: (line.matchedBy as AllegroMatchBasis | null) ?? null,
      })),
    }));

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
