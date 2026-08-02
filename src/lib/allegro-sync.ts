import "server-only";
import { prisma } from "./db";
import {
  AllegroApiError,
  getAllegroLatestOrderEventId,
  getAllegroOrder,
  listAllegroOrderEvents,
  listAllegroOrders,
  listAllegroSellerOffers,
  type AllegroOrder,
} from "./allegro-api";
import {
  AllegroNotConnectedError,
  getAllegroAccessToken,
  markAllegroConnectionRejected,
} from "./allegro-connection";
import { getModulePlatform } from "./module-platform";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";
import {
  ACTIVE_PUBLICATION_STATUSES,
  matchListingToOffer,
  ORDER_EVENT_TYPES,
  paymentStatusFor,
  SYNC_LOCK_TIMEOUT_MS,
  SYNC_MAX_ORDERS_PER_PASS,
  SYNC_WINDOW_DAYS,
  windowFloor,
  type MatchableOffer,
} from "./allegro-sync-rules";

/**
 * The Allegro sold-listing sync (#467; ADR-0024) — the half that fetches and writes.
 *
 * What it produces is an **observation**, never a financial record: it says which of the collector's
 * listings have sold on Allegro and which have quietly ended, and creating the `Sale` stays an
 * explicit act (#463). Nothing here writes to `Offer`, `Sale` or anything else the collector owns.
 *
 * The pass has two halves, and they fail independently on purpose — a listing sweep that Allegro
 * refuses is no reason to throw away three hundred orders already read:
 *
 *  • **orders**, followed through Allegro's own event stream from a stored cursor, which is what
 *    makes a re-run a refresh rather than a re-import. With no usable cursor — a first sync, or one
 *    Allegro no longer accepts because the stream only reaches back so far — it falls back to a
 *    dated read of the last {@link SYNC_WINDOW_DAYS} days. That fallback is safe precisely because
 *    every write here is an upsert keyed on Allegro's own order and line ids.
 *  • **listings**, a sweep of the account's active offers. A row that drops out of a sweep is marked
 *    `ENDED`: that absence is the whole of the "ended without selling" signal, and it is only ever
 *    computed off a sweep that finished.
 *
 * Every judgement it makes — what a payment status is, which local offer a line belongs to — is
 * `allegro-sync-rules.ts`'s and pure.
 */

/** What one pass did, for the log and for the **Sync now** button's own answer. */
export interface AllegroSyncOutcome {
  status: "ok" | "skipped" | "failed";
  /** Why it was skipped, or what failed. Null on a clean pass. */
  message: string | null;
  ordersRead: number;
  linesWritten: number;
  listingsSeen: number;
  listingsEnded: number;
}

const EMPTY: Omit<AllegroSyncOutcome, "status" | "message"> = {
  ordersRead: 0,
  linesWritten: 0,
  listingsSeen: 0,
  listingsEnded: 0,
};

/** Allegro's page size for both reads. Its own ceilings are far higher; a hundred keeps one failed
 *  page cheap to repeat. */
const PAGE = 100;

/** How long an `ENDED` listing row is kept after it was last seen up. Long enough that the second
 *  section is still useful weeks later, short enough that the table does not become an archive of
 *  every listing the account has ever run. */
const ENDED_RETENTION_DAYS = SYNC_WINDOW_DAYS * 3;

/** The statuses that mean "this cursor is no good", as opposed to "this request was refused". */
const CURSOR_REJECTED = [400, 404, 410, 422];

/** A ceiling on the listing sweep, so a paging bug or an unexpected page shape can never turn one
 *  poll into an unbounded walk. Far above any collection this app is built for. */
const MAX_LISTING_PAGES = 100;

// ---------------------------------------------------------------------------
// The pass
// ---------------------------------------------------------------------------

/** Claim the collection for this pass, or report that somebody else has it. A claim older than
 *  {@link SYNC_LOCK_TIMEOUT_MS} is taken anyway: it belongs to a process that is gone, and a lock
 *  nothing can release would end the sync for good. */
async function claim(collectionId: string, now: Date): Promise<boolean> {
  await prisma.allegroSyncState.upsert({
    where: { collectionId },
    create: { collectionId },
    update: {},
  });
  const claimed = await prisma.allegroSyncState.updateMany({
    where: {
      collectionId,
      OR: [
        { running: false },
        { startedAt: null },
        { startedAt: { lt: new Date(now.getTime() - SYNC_LOCK_TIMEOUT_MS) } },
      ],
    },
    data: { running: true, startedAt: now },
  });
  return claimed.count > 0;
}

/**
 * One sync pass for one collection.
 *
 * `ownerId` is passed in rather than looked up because the token store authorizes on it — the poll
 * reads it off the collection, and a call from the app already has a session. It is the same check
 * either way, which is what keeps the background path from being a hole in the access model.
 */
export async function runAllegroSync(
  ownerId: string,
  collectionId: string
): Promise<AllegroSyncOutcome> {
  const now = new Date();

  let token: { accessToken: string; sandbox: boolean };
  try {
    token = await getAllegroAccessToken(ownerId, collectionId);
  } catch (err) {
    if (err instanceof AllegroNotConnectedError) {
      // Not a failure of the sync: there is nothing to sync from. The settings panel already says
      // what to do about it, and writing it into `lastError` here would put the same sentence in
      // two places saying different things about whose problem it is.
      return { status: "skipped", message: err.message, ...EMPTY };
    }
    throw err;
  }

  if (!(await claim(collectionId, now))) {
    return { status: "skipped", message: "A sync is already running.", ...EMPTY };
  }

  try {
    const state = await prisma.allegroSyncState.findUnique({ where: { collectionId } });
    const offers = await loadMatchableOffers(collectionId);

    const orders = await syncOrders(collectionId, token, state ?? null, offers, now);
    const listings = await sweepListings(collectionId, token, offers, now);

    await prisma.allegroSyncState.update({
      where: { collectionId },
      data: {
        running: false,
        lastSucceededAt: new Date(),
        lastFailedAt: null,
        lastError: null,
      },
    });
    return { status: "ok", message: null, ...orders, ...listings };
  } catch (err) {
    const message = describeSyncError(err);
    // A 401 during a background pass is the grant having been withdrawn, and the fix is the same
    // reconnection every other unusable state points at (ADR-0023) — so it latches there rather than
    // being reported here as a sync that happened to fail.
    if (err instanceof AllegroApiError && err.unauthorized) {
      await markAllegroConnectionRejected(collectionId, message);
    }
    await prisma.allegroSyncState.update({
      where: { collectionId },
      data: { running: false, lastFailedAt: new Date(), lastError: message },
    });
    return { status: "failed", message, ...EMPTY };
  }
}

/**
 * One pass over every collection with a working Allegro grant — what the background poll runs.
 *
 * A collection needing a reconnection is skipped rather than attempted: the grant is known bad, and
 * calling on it every quarter of an hour would spend requests to rediscover a fact the settings
 * panel is already stating. One collection's failure never stops the next one's pass.
 */
export async function syncAllAllegroCollections(): Promise<
  { collectionId: string; outcome: AllegroSyncOutcome }[]
> {
  const connections = await prisma.allegroConnection.findMany({
    where: { refreshTokenSealed: { not: null }, needsReconnect: false },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });

  const results: { collectionId: string; outcome: AllegroSyncOutcome }[] = [];
  for (const connection of connections) {
    try {
      results.push({
        collectionId: connection.collectionId,
        outcome: await runAllegroSync(connection.collection.ownerId, connection.collectionId),
      });
    } catch (err) {
      results.push({
        collectionId: connection.collectionId,
        outcome: { status: "failed", message: describeSyncError(err), ...EMPTY },
      });
    }
  }
  return results;
}

function describeSyncError(err: unknown): string {
  if (err instanceof AllegroApiError) return err.message;
  if (err instanceof AllegroNotConnectedError) return err.message;
  if (err instanceof Error) return err.message;
  return "The Allegro sync failed.";
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/** Every offer the sync could match against: this collection's offers on the platform marked as
 *  Allegro. Loaded once per pass — a match is asked hundreds of times and the answer never moves
 *  while a pass runs. */
async function loadMatchableOffers(collectionId: string): Promise<MatchableOffer[]> {
  const platform = await getModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE);
  if (!platform) {
    // No platform here *is* Allegro, so nothing can be matched. The sync still runs and still
    // records what sold — every line simply comes back unmatched, which is the honest answer and
    // the one that sends the collector to Settings → Allegro.
    return [];
  }
  return prisma.offer.findMany({
    where: { collectionId, platformId: platform.id },
    select: { id: true, offerNo: true, url: true },
  });
}

async function syncOrders(
  collectionId: string,
  token: { accessToken: string; sandbox: boolean },
  state: { orderCursor: string | null; ordersSyncedAt: Date | null } | null,
  offers: MatchableOffer[],
  now: Date
): Promise<{ ordersRead: number; linesWritten: number }> {
  let cursor = state?.orderCursor ?? null;
  let orders: AllegroOrder[] = [];

  if (cursor) {
    try {
      const followed = await followEvents(token, cursor);
      orders = followed.orders;
      cursor = followed.cursor;
    } catch (err) {
      // Allegro refuses a cursor it no longer holds. That is not a failure — it is the stream having
      // moved past us — so the pass falls back to the dated read and mints a fresh cursor. Safe
      // because every write below is an upsert on Allegro's own ids.
      //
      // Only the refusals that are *about the cursor*: a rejected token (401) and a scope the
      // application does not carry (403) are the collector's to fix, and quietly re-reading a month
      // of orders on either would hide the thing they need to be told.
      if (err instanceof AllegroApiError && CURSOR_REJECTED.includes(err.status ?? 0)) {
        cursor = null;
      } else {
        throw err;
      }
    }
  }

  if (!cursor) {
    // The cursor is taken *before* the window read, so an order that lands while it runs is picked
    // up by the next pass instead of falling between the two.
    const latest = await getAllegroLatestOrderEventId(token);
    orders = await readWindow(token, windowFloor(now, state?.ordersSyncedAt ?? null));
    cursor = latest;
  }

  let linesWritten = 0;
  for (const order of orders) {
    linesWritten += await writeOrder(collectionId, order, offers, now);
  }

  await prisma.allegroSyncState.update({
    where: { collectionId },
    data: { orderCursor: cursor, ordersSyncedAt: now },
  });

  return { ordersRead: orders.length, linesWritten };
}

/** Follow the event stream from the cursor, and fetch each order it names exactly once. */
async function followEvents(
  token: { accessToken: string; sandbox: boolean },
  cursor: string
): Promise<{ orders: AllegroOrder[]; cursor: string }> {
  const orderIds: string[] = [];
  const seen = new Set<string>();
  let at = cursor;

  for (;;) {
    const events = await listAllegroOrderEvents({
      ...token,
      after: at,
      limit: PAGE,
      types: [...ORDER_EVENT_TYPES],
    });
    if (events.length === 0) break;
    at = events[events.length - 1].id;
    for (const event of events) {
      if (!event.orderId || seen.has(event.orderId)) continue;
      seen.add(event.orderId);
      orderIds.push(event.orderId);
    }
    // One pass is bounded so a long-idle install cannot spend an unbounded stretch inside one poll.
    // The cursor has already advanced, so the next pass carries straight on from here.
    if (events.length < PAGE || orderIds.length >= SYNC_MAX_ORDERS_PER_PASS) break;
  }

  const orders: AllegroOrder[] = [];
  for (const orderId of orderIds) {
    const order = await getAllegroOrder({ ...token, orderId });
    if (order) orders.push(order);
  }
  return { orders, cursor: at };
}

/** The dated read: every order bought since the floor, paged to the end. */
async function readWindow(
  token: { accessToken: string; sandbox: boolean },
  boughtAtGte: Date
): Promise<AllegroOrder[]> {
  const orders: AllegroOrder[] = [];
  for (let offset = 0; offset < SYNC_MAX_ORDERS_PER_PASS; offset += PAGE) {
    const page = await listAllegroOrders({ ...token, boughtAtGte, limit: PAGE, offset });
    orders.push(...page);
    if (page.length < PAGE) break;
  }
  return orders;
}

/** Upsert one order and its lines. Keyed on Allegro's own ids, so a second sight of an order updates
 *  the rows it already wrote — which is what stops a re-run producing a second worklist entry. */
async function writeOrder(
  collectionId: string,
  order: AllegroOrder,
  offers: MatchableOffer[],
  observedAt: Date
): Promise<number> {
  const paymentStatus = paymentStatusFor(order.status, order.paymentFinishedAt);

  // The order is dated by the earliest of its lines. Allegro dates the purchase per line, and a
  // multi-item order's first line is what the collector thinks of as when it was bought.
  const boughtAt = order.lineItems
    .map((line) => (line.boughtAt ? new Date(line.boughtAt) : observedAt))
    .filter((date) => !Number.isNaN(date.getTime()))
    .reduce((earliest, date) => (date < earliest ? date : earliest), observedAt);

  const header = {
    status: order.status,
    paymentStatus,
    boughtAt,
    buyerLogin: order.buyerLogin,
    buyerName: order.buyerName,
    totalPaid: order.totalPaid,
    currency: order.currency,
    observedAt,
  };
  const row = await prisma.allegroOrder.upsert({
    where: { collectionId_orderId: { collectionId, orderId: order.id } },
    create: { collectionId, orderId: order.id, ...header },
    update: header,
    select: { id: true },
  });

  for (const line of order.lineItems) {
    const match = matchListingToOffer(offers, {
      platformOfferId: line.offerId,
      externalId: line.externalId,
    });
    const lineBoughtAt = line.boughtAt ? new Date(line.boughtAt) : observedAt;
    const common = {
      collectionId,
      platformOfferId: line.offerId,
      externalId: line.externalId,
      title: line.title,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      currency: line.currency,
      boughtAt: Number.isNaN(lineBoughtAt.getTime()) ? observedAt : lineBoughtAt,
      offerId: match?.offerId ?? null,
      matchedBy: match?.matchedBy ?? null,
      observedAt,
    };
    await prisma.allegroOrderLine.upsert({
      where: {
        allegroOrderId_lineItemId: { allegroOrderId: row.id, lineItemId: line.id },
      },
      create: { allegroOrderId: row.id, lineItemId: line.id, ...common },
      update: common,
    });
  }
  return order.lineItems.length;
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

async function sweepListings(
  collectionId: string,
  token: { accessToken: string; sandbox: boolean },
  offers: MatchableOffer[],
  now: Date
): Promise<{ listingsSeen: number; listingsEnded: number }> {
  let seen = 0;

  for (let pageIndex = 0; pageIndex < MAX_LISTING_PAGES; pageIndex++) {
    const offset = pageIndex * PAGE;
    const { offers: page } = await listAllegroSellerOffers({
      ...token,
      publicationStatus: [...ACTIVE_PUBLICATION_STATUSES],
      limit: PAGE,
      offset,
    });
    for (const listing of page) {
      const match = matchListingToOffer(offers, {
        platformOfferId: listing.id,
        externalId: listing.externalId,
      });
      const endingAt = listing.endingAt ? new Date(listing.endingAt) : null;
      const common = {
        externalId: listing.externalId,
        title: listing.title,
        status: listing.status,
        endingAt: endingAt && !Number.isNaN(endingAt.getTime()) ? endingAt : null,
        available: listing.available,
        sold: listing.sold,
        offerId: match?.offerId ?? null,
        matchedBy: match?.matchedBy ?? null,
        observedAt: now,
      };
      await prisma.allegroListing.upsert({
        where: {
          collectionId_platformOfferId: { collectionId, platformOfferId: listing.id },
        },
        create: { collectionId, platformOfferId: listing.id, ...common },
        update: common,
      });
    }
    seen += page.length;
    if (page.length < PAGE) break;
  }

  // Anything the sweep did not see is no longer up. `observedAt` is deliberately left where it was:
  // it now reads as "last seen active", which is the only date this app has for a listing Allegro
  // was never asked about.
  const ended = await prisma.allegroListing.updateMany({
    where: { collectionId, observedAt: { lt: now }, status: { not: "ENDED" } },
    data: { status: "ENDED" },
  });

  // Ended rows are kept long enough to be useful and no longer — this is a worklist, not an archive
  // of every listing the account has ever run.
  await prisma.allegroListing.deleteMany({
    where: {
      collectionId,
      status: "ENDED",
      observedAt: { lt: new Date(now.getTime() - ENDED_RETENTION_DAYS * 24 * 60 * 60 * 1000) },
    },
  });

  await prisma.allegroSyncState.update({
    where: { collectionId },
    data: { listingsSweptAt: now },
  });

  return { listingsSeen: seen, listingsEnded: ended.count };
}
