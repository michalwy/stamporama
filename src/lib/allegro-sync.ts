import "server-only";
import { prisma } from "./db";
import {
  AllegroApiError,
  getAllegroLatestOrderEventId,
  getAllegroOrder,
  listAllegroOfferEvents,
  listAllegroOrderEvents,
  listAllegroOrders,
  listAllegroSellerOffers,
  type AllegroOrder,
  type AllegroSellerOffer,
} from "./allegro-api";
import {
  type AllegroCallCredentials,
  AllegroNotConnectedError,
  getAllegroAccessToken,
  markAllegroConnectionRejected,
} from "./allegro-connection";
import { getModulePlatform } from "./module-platform";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";
import {
  ACTIVE_PUBLICATION_STATUSES,
  BID_DETAIL_BATCH,
  BID_EVENT_TYPES,
  bidWriteFor,
  MAX_BID_EVENT_PAGES,
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
 * explicit act (#463). Nothing here writes a `Sale`, a state or a composition.
 *
 * It does write **one** thing the collector owns, and only on their own auctions: a bid landing is
 * carried straight onto the offer as `inActiveBidding` plus the standing bid (#481; ADR-0021 §8 as
 * amended). That is the one fact where waiting for a confirmation would defeat the point — the
 * collector is committed the moment somebody bids — and it is never undone here. See
 * {@link applyBidding}.
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
  /** Rows that had matched nothing and now do — the collector having fixed an offer's URL since. */
  rematched: number;
  /** Auctions this pass marked **in active bidding** (#481), a bid having landed on them. */
  biddingFlagged: number;
  /** Auctions whose standing bid this pass refreshed. */
  bidsRefreshed: number;
}

const EMPTY: Omit<AllegroSyncOutcome, "status" | "message"> = {
  ordersRead: 0,
  linesWritten: 0,
  listingsSeen: 0,
  listingsEnded: 0,
  rematched: 0,
  biddingFlagged: 0,
  bidsRefreshed: 0,
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

  let token: AllegroCallCredentials;
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
    const rematched = await rematchUnmatched(collectionId, offers);

    await prisma.allegroSyncState.update({
      where: { collectionId },
      data: {
        running: false,
        lastSucceededAt: new Date(),
        lastFailedAt: null,
        lastError: null,
      },
    });
    return { status: "ok", message: null, ...orders, ...listings, rematched };
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
// The event poll (#481) — both of Allegro's streams, every couple of minutes
// ---------------------------------------------------------------------------

/** What one event poll did. */
export interface AllegroEventPollOutcome {
  status: "ok" | "skipped" | "failed";
  message: string | null;
  /** Events read across both streams. Zero is the ordinary answer, and the cheap one. */
  eventsRead: number;
  /** Listings whose detail was actually fetched — only ever the offers the events named. */
  offersRead: number;
  biddingFlagged: number;
  bidsRefreshed: number;
  /** Orders followed up from the order stream, and the lines they wrote. */
  ordersRead: number;
  linesWritten: number;
}

const NOTHING_POLLED: Omit<AllegroEventPollOutcome, "status" | "message"> = {
  eventsRead: 0,
  offersRead: 0,
  biddingFlagged: 0,
  bidsRefreshed: 0,
  ordersRead: 0,
  linesWritten: 0,
};

/**
 * One event poll for one collection — the fast path, over **both** of Allegro's streams.
 *
 * The full pass (#467) runs every quarter of an hour and reads the whole account. That is right for
 * the things only a sweep can answer and far too slow for the two that are actually urgent: somebody
 * bidding on the collector's auction (#481), which commits them to pulling those copies from every
 * other marketplace *now*, and an order landing, which is what the worklist is for. Doing either by
 * re-reading the account every two minutes is the obvious way and the wrong one — almost every pass
 * would spend the quota to learn that nothing had changed.
 *
 * Both are event-driven instead, and for the same reason they can be:
 *
 *  1. `GET /sale/offer-events` from the stored cursor, asked for the two bid events only.
 *  2. `GET /order/events` from the sync's own order cursor, asked for the same order types the full
 *     pass follows.
 *  3. Whatever those name is read back and nothing else — the offers by id in batches, the orders one
 *     by one — through {@link recordListing} and {@link writeOrder}, the very paths the full pass
 *     writes through, so a row can never depend on which poll happened to see it.
 *
 * On a quiet account that is **two requests**, both answering with an empty page. It shares the
 * sync's claim, so a poll and a full pass can never write the same rows at once, and a poll that
 * finds the collection busy simply skips: the next one is two minutes away.
 *
 * What it deliberately does **not** do is the listing sweep. "Ended without selling" is derived from
 * a listing's *absence* from a complete read of the account (ADR-0024 §2), which is exactly the
 * expensive thing this poll exists to avoid — and a listing quietly ending is not urgent in the way
 * a bid or an order is. The same goes for the dated fallback import and the re-match: with no usable
 * order cursor this poll leaves the orders alone entirely rather than pulling a month of history on
 * a two-minute timer, and lets the full pass do it.
 */
export async function runAllegroEventPoll(
  ownerId: string,
  collectionId: string
): Promise<AllegroEventPollOutcome> {
  const now = new Date();

  let token: AllegroCallCredentials;
  try {
    token = await getAllegroAccessToken(ownerId, collectionId);
  } catch (err) {
    if (err instanceof AllegroNotConnectedError) {
      return { status: "skipped", message: err.message, ...NOTHING_POLLED };
    }
    throw err;
  }

  if (!(await claim(collectionId, now))) {
    return { status: "skipped", message: "A sync is already running.", ...NOTHING_POLLED };
  }

  try {
    const state = await prisma.allegroSyncState.findUnique({
      where: { collectionId },
      select: { offerEventCursor: true, orderCursor: true },
    });

    const bids = await followOfferEvents(token, state?.offerEventCursor ?? null);

    // Only where the full pass has already established one. A missing or aged-out order cursor means
    // a window import, which belongs to the pass that is built for it — replaying a month of orders
    // on a two-minute timer would be the opposite of what this poll is for.
    const orders = state?.orderCursor
      ? await followOrderEventsSafely(token, state.orderCursor)
      : { orders: [], cursor: state?.orderCursor ?? null, eventsRead: 0 };

    let offersRead = 0;
    let biddingFlagged = 0;
    let bidsRefreshed = 0;
    let linesWritten = 0;

    if (bids.offerIds.length > 0 || orders.orders.length > 0) {
      // Loaded once, and only where there is something to match against — the whole point of the
      // streams is that most polls do no work at all, and a query per two minutes is still a query.
      const offers = await loadMatchableOffers(collectionId);

      for (let at = 0; at < bids.offerIds.length; at += BID_DETAIL_BATCH) {
        const batch = bids.offerIds.slice(at, at + BID_DETAIL_BATCH);
        const { offers: listings } = await listAllegroSellerOffers({
          ...token,
          // No status filter: a bid landing on an auction that ends moments later is precisely the
          // one worth reading, and asking only for active listings would drop it.
          offerIds: batch,
          limit: batch.length,
        });
        offersRead += listings.length;
        for (const listing of listings) {
          const applied = await recordListing(collectionId, listing, offers, now);
          if (applied.flagged) biddingFlagged++;
          if (applied.refreshed) bidsRefreshed++;
        }
      }

      for (const order of orders.orders) {
        linesWritten += await writeOrder(collectionId, order, offers, now);
      }
    }

    await prisma.allegroSyncState.update({
      where: { collectionId },
      data: {
        running: false,
        offerEventCursor: bids.cursor,
        // Advanced even where the poll wrote nothing: the events were read, and re-reading them on
        // the next poll would be work already done.
        orderCursor: orders.cursor,
        // `ordersSyncedAt` moves **only** when the stream was actually followed, because it is the
        // floor a later window read starts from. Stamping it on a *refused* cursor would tell the
        // full pass that the orders are current as of now, and its fallback would then import a
        // single day instead of the month an aged-out cursor is exactly the case for.
        ...(orders.cursor && orders.cursor !== state?.orderCursor ? { ordersSyncedAt: now } : {}),
        eventPolledAt: now,
        eventPollError: null,
      },
    });
    return {
      status: "ok",
      message: null,
      eventsRead: bids.eventsRead + orders.eventsRead,
      offersRead,
      biddingFlagged,
      bidsRefreshed,
      ordersRead: orders.orders.length,
      linesWritten,
    };
  } catch (err) {
    const message = describeSyncError(err);
    if (err instanceof AllegroApiError && err.unauthorized) {
      await markAllegroConnectionRejected(collectionId, message);
    }
    await prisma.allegroSyncState.update({
      where: { collectionId },
      data: { running: false, eventPollError: message },
    });
    return { status: "failed", message, ...NOTHING_POLLED };
  }
}

/**
 * Follow the order stream for the fast poll, treating a refused cursor as **nothing to do**.
 *
 * The full pass answers that refusal with a dated window read, which is right there and wrong here:
 * this poll runs every two minutes, and a cursor Allegro has aged out would otherwise make each one
 * re-import a month of orders. Clearing the cursor is enough — the next full pass sees a missing
 * cursor, does the window read it is built for, and mints a fresh one.
 */
async function followOrderEventsSafely(
  token: AllegroCallCredentials,
  cursor: string
): Promise<{ orders: AllegroOrder[]; cursor: string | null; eventsRead: number }> {
  try {
    const followed = await followEvents(token, cursor);
    return { orders: followed.orders, cursor: followed.cursor, eventsRead: followed.eventsRead };
  } catch (err) {
    if (err instanceof AllegroApiError && CURSOR_REJECTED.includes(err.status ?? 0)) {
      return { orders: [], cursor: null, eventsRead: 0 };
    }
    throw err;
  }
}

/**
 * Walk the offer event stream from the cursor, collecting the offers that were bid on.
 *
 * **With no cursor it seeks rather than replays**: it walks to the end of what Allegro still holds
 * and collects nothing. A first poll, or one whose cursor has aged out of the 24-hour window, has no
 * business restating a day of bidding — the full sweep reads every listing's bidding anyway, and it
 * has either just run or is minutes away. What matters is that the *next* poll starts from a real
 * position rather than from the beginning of the stream every two minutes.
 */
async function followOfferEvents(
  token: AllegroCallCredentials,
  cursor: string | null
): Promise<{ offerIds: string[]; eventsRead: number; cursor: string | null }> {
  const seeking = cursor === null;
  const offerIds: string[] = [];
  const seen = new Set<string>();
  let at = cursor;
  let eventsRead = 0;

  for (let page = 0; page < MAX_BID_EVENT_PAGES; page++) {
    let events;
    try {
      events = await listAllegroOfferEvents({
        ...token,
        after: at,
        limit: PAGE,
        types: [...BID_EVENT_TYPES],
      });
    } catch (err) {
      // A cursor the stream no longer holds is the ordinary state of an instance that was off
      // overnight, not a failure: start again from the end and let the sweep restate the rest. Only
      // ever once — a refusal with no cursor to blame is a real refusal, and retrying it here would
      // be a loop rather than a recovery.
      if (!seeking && err instanceof AllegroApiError && CURSOR_REJECTED.includes(err.status ?? 0)) {
        const sought = await followOfferEvents(token, null);
        return { offerIds: [], eventsRead: eventsRead + sought.eventsRead, cursor: sought.cursor };
      }
      throw err;
    }

    if (events.length === 0) break;
    at = events[events.length - 1].id;
    eventsRead += events.length;
    if (!seeking) {
      for (const event of events) {
        if (!event.offerId || seen.has(event.offerId)) continue;
        seen.add(event.offerId);
        offerIds.push(event.offerId);
      }
    }
    if (events.length < PAGE) break;
  }

  return { offerIds, eventsRead, cursor: at };
}

/**
 * One bidding poll over every collection with a working Allegro grant.
 *
 * Same rule as the full sync's own pass: a connection known to need reconnecting is skipped rather
 * than called on every two minutes to rediscover it, and one collection's failure never stops the
 * next one's poll.
 */
export async function pollAllAllegroEvents(): Promise<
  { collectionId: string; outcome: AllegroEventPollOutcome }[]
> {
  const connections = await prisma.allegroConnection.findMany({
    where: { refreshTokenSealed: { not: null }, needsReconnect: false },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });

  const results: { collectionId: string; outcome: AllegroEventPollOutcome }[] = [];
  for (const connection of connections) {
    try {
      results.push({
        collectionId: connection.collectionId,
        outcome: await runAllegroEventPoll(
          connection.collection.ownerId,
          connection.collectionId
        ),
      });
    } catch (err) {
      results.push({
        collectionId: connection.collectionId,
        outcome: { status: "failed", message: describeSyncError(err), ...NOTHING_POLLED },
      });
    }
  }
  return results;
}

// ---------------------------------------------------------------------------
// Orders
// ---------------------------------------------------------------------------

/**
 * One local offer as the pass holds it: what a match is resolved against, plus what a bid
 * observation is judged against (#481).
 *
 * The bidding half is deliberately carried on the same row rather than read per listing — the sweep
 * would otherwise ask the database for an offer it has already loaded — and it is **mutated in
 * place** when a write goes out, so two listings resolving to one offer cannot both report having
 * flagged it.
 */
interface SyncOffer extends MatchableOffer {
  listingType: string;
  state: string;
  currency: string;
  inActiveBidding: boolean;
  bidderCount: number | null;
}

/** Every offer the sync could match against: this collection's offers on the platform marked as
 *  Allegro. Loaded once per pass — a match is asked hundreds of times and the answer never moves
 *  while a pass runs. */
async function loadMatchableOffers(collectionId: string): Promise<SyncOffer[]> {
  const platform = await getModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE);
  if (!platform) {
    // No platform here *is* Allegro, so nothing can be matched. The sync still runs and still
    // records what sold — every line simply comes back unmatched, which is the honest answer and
    // the one that sends the collector to Settings → Allegro.
    return [];
  }
  return prisma.offer.findMany({
    where: { collectionId, platformId: platform.id },
    select: {
      id: true,
      offerNo: true,
      url: true,
      listingType: true,
      state: true,
      currency: true,
      inActiveBidding: true,
      bidderCount: true,
    },
  });
}

async function syncOrders(
  collectionId: string,
  token: AllegroCallCredentials,
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
  token: AllegroCallCredentials,
  cursor: string
): Promise<{ orders: AllegroOrder[]; cursor: string; eventsRead: number }> {
  const orderIds: string[] = [];
  const seen = new Set<string>();
  let at = cursor;
  let eventsRead = 0;

  for (;;) {
    const events = await listAllegroOrderEvents({
      ...token,
      after: at,
      limit: PAGE,
      types: [...ORDER_EVENT_TYPES],
    });
    if (events.length === 0) break;
    at = events[events.length - 1].id;
    eventsRead += events.length;
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
  return { orders, cursor: at, eventsRead };
}

/** The dated read: every order bought since the floor, paged to the end. */
async function readWindow(
  token: AllegroCallCredentials,
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
// Re-matching
// ---------------------------------------------------------------------------

/**
 * Give every row that matched nothing another go, against the offers as they are **now**.
 *
 * Without this, fixing an offer's listing URL did not fix the worklist. A match is worked out when a
 * row is written, and a pass following the event stream only rewrites orders that have *changed* —
 * so an order imported last week with no URL to recognise it by stayed unmatched for ever, however
 * carefully the collector then filled the field in. The only way out was to clear the cursor and
 * re-import a month of orders to recompute one boolean.
 *
 * It costs one query and no request to Allegro: the candidate offers are already loaded once for the
 * whole pass, and the match itself is pure.
 *
 * **Only rows that matched nothing.** A match already made is a fact the collector may have acted
 * on, and re-deciding it every quarter of an hour would let an edited URL silently move a recorded
 * observation from one offer to another. Correcting a *wrong* match is a different act, and one this
 * does not claim to do.
 */
async function rematchUnmatched(collectionId: string, offers: MatchableOffer[]): Promise<number> {
  if (offers.length === 0) return 0;

  const [lines, listings] = await Promise.all([
    prisma.allegroOrderLine.findMany({
      where: { collectionId, offerId: null },
      select: { id: true, platformOfferId: true, externalId: true },
    }),
    // The listing sweep re-matches everything it sees, so only the rows it no longer sees — the
    // ended ones — can be stranded here.
    prisma.allegroListing.findMany({
      where: { collectionId, offerId: null, status: "ENDED" },
      select: { id: true, platformOfferId: true, externalId: true },
    }),
  ]);

  let rematched = 0;

  for (const line of lines) {
    const match = matchListingToOffer(offers, line);
    if (!match) continue;
    await prisma.allegroOrderLine.update({
      where: { id: line.id },
      data: { offerId: match.offerId, matchedBy: match.matchedBy },
    });
    rematched++;
  }

  for (const listing of listings) {
    const match = matchListingToOffer(offers, listing);
    if (!match) continue;
    await prisma.allegroListing.update({
      where: { id: listing.id },
      data: { offerId: match.offerId, matchedBy: match.matchedBy },
    });
    rematched++;
  }

  return rematched;
}

// ---------------------------------------------------------------------------
// Listings
// ---------------------------------------------------------------------------

async function sweepListings(
  collectionId: string,
  token: AllegroCallCredentials,
  offers: SyncOffer[],
  now: Date
): Promise<{
  listingsSeen: number;
  listingsEnded: number;
  biddingFlagged: number;
  bidsRefreshed: number;
}> {
  let seen = 0;
  let biddingFlagged = 0;
  let bidsRefreshed = 0;

  for (let pageIndex = 0; pageIndex < MAX_LISTING_PAGES; pageIndex++) {
    const offset = pageIndex * PAGE;
    const { offers: page } = await listAllegroSellerOffers({
      ...token,
      publicationStatus: [...ACTIVE_PUBLICATION_STATUSES],
      limit: PAGE,
      offset,
    });
    for (const listing of page) {
      const applied = await recordListing(collectionId, listing, offers, now);
      if (applied.flagged) biddingFlagged++;
      if (applied.refreshed) bidsRefreshed++;
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

  return { listingsSeen: seen, listingsEnded: ended.count, biddingFlagged, bidsRefreshed };
}

/**
 * Record one listing as the platform currently states it, and carry its bidding onto the offer.
 *
 * Shared by the full sweep and the bidding poll deliberately: the two differ only in *which*
 * listings they read and how often, and a row written one way and one way only can never drift from
 * a row written the other. `observedAt` reads the same from both — when the listing was last seen
 * up — which is what the sweep's "ended without selling" is derived from.
 */
async function recordListing(
  collectionId: string,
  listing: AllegroSellerOffer,
  offers: SyncOffer[],
  now: Date
): Promise<{ flagged: boolean; refreshed: boolean }> {
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
    // What Allegro said about the bidding (#481), kept beside its own row whether or not it reaches
    // an offer: an unmatched auction still has a standing bid, and the row is what says so once the
    // collector fixes the listing's URL.
    format: listing.format,
    biddersCount: listing.biddersCount,
    currentPrice: listing.currentPrice,
    currentCurrency: listing.currentCurrency,
    offerId: match?.offerId ?? null,
    matchedBy: match?.matchedBy ?? null,
    observedAt: now,
  };
  await prisma.allegroListing.upsert({
    where: { collectionId_platformOfferId: { collectionId, platformOfferId: listing.id } },
    create: { collectionId, platformOfferId: listing.id, ...common },
    update: common,
  });

  return applyBidding(listing, match?.offerId ?? null, offers, now);
}

/**
 * Carry one listing's bidding onto the offer behind it (#481).
 *
 * This is the one place in the whole sync that writes to something the collector owns, and it does
 * so on purpose: a bid landing on the collector's own auction commits them *now*, and a flag waiting
 * to be confirmed would be no faster than the click it replaces. What may be written is
 * {@link bidWriteFor}'s alone — the flag it never clears, the standing bid it only records in the
 * offer's own currency — and it reaches nothing else: no `Sale`, no state change, no other offer.
 * The cascade onto offers holding the same copies is a *derivation* off this flag (ADR-0013 §4), so
 * it follows on its own, exactly as it does from the collector's own click.
 *
 * An unmatched listing is simply skipped. Its bidding is recorded on the `AllegroListing` row above,
 * and there is no offer here to say it about.
 */
async function applyBidding(
  listing: { format: string | null; biddersCount: number | null; currentPrice: string | null; currentCurrency: string | null },
  offerId: string | null,
  offers: SyncOffer[],
  now: Date
): Promise<{ flagged: boolean; refreshed: boolean }> {
  const none = { flagged: false, refreshed: false };
  if (!offerId) return none;
  const offer = offers.find((candidate) => candidate.id === offerId);
  if (!offer) return none;

  const write = bidWriteFor(listing, offer, now);
  if (!write) return none;

  await prisma.offer.update({
    where: { id: offer.id },
    data: {
      ...write,
      // Flagging it *is* the news, so the notice is raised in the same write that raises the flag —
      // never on a refresh of a bid already flagged, which would put an auction back on the bell
      // every time somebody outbid somebody else. Cleared when the collector opens the offer.
      ...(write.inActiveBidding ? { biddingNoticeAt: now } : {}),
    },
  });

  // The loaded row is the pass's own copy, so it is brought up to date rather than left stating what
  // was true before this write — two listings resolving to one offer must not both report a flag.
  if (write.inActiveBidding) offer.inActiveBidding = true;
  if (write.bidderCount !== undefined) offer.bidderCount = write.bidderCount;

  return { flagged: write.inActiveBidding === true, refreshed: write.price !== undefined };
}
