/**
 * The decisions the Allegro sold-listing sync makes, kept pure (#467; ADR-0024).
 *
 * Nothing here reaches a database or the network: what a payment status *is*, which local offer an
 * ordered line belongs to and when a worklist has gone stale are rules, and rules that live beside
 * the I/O that uses them are rules nobody tests. `allegro-sync.ts` is the half that fetches and
 * writes, and it makes no judgement of its own.
 */

import { CLOSED_OFFER_STATES, isAuctionListing, normalizeListingType } from "./offer-rules";
import { urlNamesPlatformOffer } from "./platform-offer-url";

/** How far back the *first* sync reads. Later passes follow the event stream instead, so this is
 *  only ever the depth of the initial import — and of the fallback when a cursor has aged out. */
export const SYNC_WINDOW_DAYS = 30;

/** How often the **full** pass runs (#467) — the one that reads the account end to end, and so the
 *  only one that can derive "ended without selling" from a listing's absence. Comfortably inside
 *  Allegro's rate limits. New orders and new bids do not wait for it: they arrive through the event
 *  poll below, every {@link EVENT_POLL_INTERVAL_MS}. */
export const SYNC_INTERVAL_MS = 15 * 60 * 1000;

/** Past this without a successful pass, the worklist says so rather than looking current: a stale
 *  list that reads as fresh is the failure mode the whole design is against. Four polls' worth, so
 *  a single missed pass is not an alarm. */
export const SYNC_STALE_AFTER_MS = 60 * 60 * 1000;

/** A pass claims the collection while it runs, so a **Sync now** click and the poll cannot read the
 *  same events twice. A process killed mid-pass would otherwise leave that claim standing for ever,
 *  so it times out — a second pass over idempotent writes is cheaper than a sync that never runs
 *  again. */
export const SYNC_LOCK_TIMEOUT_MS = 10 * 60 * 1000;

/** How many orders one pass will follow up before leaving the rest to the next one. A first sync of
 *  a busy account is the case this bounds; the cursor means the next pass carries straight on. */
export const SYNC_MAX_ORDERS_PER_PASS = 300;

/**
 * The event types the sync follows. `FULFILLMENT_STATUS_CHANGED` is deliberately absent: the seller
 * marking an order packed says nothing about whether it has been recorded as a sale here, and
 * re-reading the order for it would spend the collector's quota to write the same row back.
 */
export const ORDER_EVENT_TYPES = [
  "BOUGHT",
  "FILLED_IN",
  "READY_FOR_PROCESSING",
  "BUYER_CANCELLED",
  "AUTO_CANCELLED",
] as const;

/** The publication statuses the listing sweep asks for — everything that counts as up on Allegro
 *  right now. `ACTIVATING` is included because a listing on its way up is not one that has ended. */
export const ACTIVE_PUBLICATION_STATUSES = ["ACTIVE", "ACTIVATING"] as const;

/** What the sync says about an order's money: `unpaid` (bought, not yet settled), `paid`, or
 *  `cancelled`. Deliberately three words of our own rather than Allegro's status verbatim — the
 *  worklist is asking one question, "is this waiting to be recorded", and Allegro's vocabulary
 *  answers a different one. */
export type AllegroPaymentStatus = "unpaid" | "paid" | "cancelled";

/**
 * The payment reading of an order.
 *
 * A finished payment is the only positive evidence there is, so it leads. `READY_FOR_PROCESSING` is
 * accepted beside it because that is Allegro's own word for a form filled in *and* paid, and an
 * order can reach it with the payment timestamp not yet mirrored onto the form.
 */
export function paymentStatusFor(
  orderStatus: string,
  paymentFinishedAt: string | Date | null
): AllegroPaymentStatus {
  const status = orderStatus.toUpperCase();
  if (status === "CANCELLED") return "cancelled";
  if (paymentFinishedAt !== null) return "paid";
  if (status === "READY_FOR_PROCESSING") return "paid";
  return "unpaid";
}

/**
 * Whether a line is still waiting on the collector.
 *
 * A cancelled order is **reported, never actioned**: the sale did not happen, and offering to record
 * one would be the sync putting a financial suggestion in front of somebody on the strength of an
 * order the buyer withdrew. Unpaid is still actionable — the collector may well want the sale on the
 * books at `ordered`, which is exactly what the fulfilment lifecycle's first step is (#191).
 */
export function lineAwaitsSale(paymentStatus: AllegroPaymentStatus): boolean {
  return paymentStatus !== "cancelled";
}

/** One order as the supersession rule reads it: its Allegro id, the line items it carries, and when
 *  the sync last saw it. */
export interface SupersedableOrder {
  orderId: string;
  lineItemIds: readonly string[];
  observedAt: Date;
}

/**
 * Which orders have been **taken over by a merged one** (#495), keyed by order id.
 *
 * A buyer who wins several auctions gets a checkout form per purchase, and paying for several at once
 * makes Allegro issue a new form carrying all of them — reusing each purchase's own `lineItemId` and
 * abandoning the original forms, unpaid, with no event and no status change to say what happened. The
 * shared line item ids are the whole of the evidence, and they are enough: a line item is one
 * purchase, so an order whose every line item is also carried elsewhere has nothing left of its own.
 *
 * The taking-over order has to be the **later statement** of that purchase, which is what keeps the
 * relation one-way: a strictly bigger order, or an equally big one seen more recently. Two orders
 * with the same lines and the same `observedAt` supersede neither — the pair says nothing about which
 * came second, and guessing would hide a real order.
 *
 * Where several orders qualify, the biggest wins, then the most recently seen, then the id: the
 * verdict is a stored column, and one that moved between passes over unchanged data would be a
 * worklist that flickers.
 *
 * Pure, and computed over rows the sync already holds — it asks Allegro nothing.
 */
export function supersededOrders(
  orders: readonly SupersedableOrder[]
): Map<string, string | null> {
  const verdict = new Map<string, string | null>();

  for (const order of orders) {
    verdict.set(order.orderId, null);
    // An order with no lines is not "contained" by anything: every other order would trivially carry
    // all nothing of it, and a header the sync has yet to fill in is not a leftover.
    if (order.lineItemIds.length === 0) continue;

    let winner: SupersedableOrder | null = null;
    for (const other of orders) {
      if (other.orderId === order.orderId) continue;
      const later =
        other.lineItemIds.length > order.lineItemIds.length ||
        (other.lineItemIds.length === order.lineItemIds.length &&
          other.observedAt.getTime() > order.observedAt.getTime());
      if (!later) continue;
      const carriesAll = order.lineItemIds.every((lineItemId) =>
        other.lineItemIds.includes(lineItemId)
      );
      if (!carriesAll) continue;
      if (!winner || compareTakeover(other, winner) < 0) winner = other;
    }

    if (winner) verdict.set(order.orderId, winner.orderId);
  }

  return verdict;
}

/** Orders the candidates for a takeover, best first: most lines, then most recently seen, then id. */
function compareTakeover(a: SupersedableOrder, b: SupersedableOrder): number {
  if (a.lineItemIds.length !== b.lineItemIds.length) {
    return b.lineItemIds.length - a.lineItemIds.length;
  }
  if (a.observedAt.getTime() !== b.observedAt.getTime()) {
    return b.observedAt.getTime() - a.observedAt.getTime();
  }
  return a.orderId.localeCompare(b.orderId);
}

/** How a line or a listing was tied to a local offer. */
export type AllegroMatchBasis = "external" | "url";

/** The local offers a match is resolved against — the narrowest shape the rule needs. */
export interface MatchableOffer {
  id: string;
  offerNo: number;
  url: string | null;
}

/**
 * Which local offer a marketplace listing is, and on what evidence.
 *
 * Two ways in, in order of how much they claim:
 *
 *  • the listing's **external id**, which is the Stamporama offer number when the listing was
 *    published through the API. That is an exact statement of identity rather than one derived from
 *    an address, so it wins wherever it exists.
 *  • the stored **URL**, at the address's own boundaries (`platform-offer-url.ts`) — what everything
 *    posted by hand is matched on, and never a bare substring.
 *
 * Ambiguity is a **refusal**: two offers claiming one listing is a data problem, and picking one of
 * them would record a sale against a listing the collector never checked. The line is then shown as
 * unmatched, which is a state the worklist already has a shape for.
 */
export function matchListingToOffer(
  offers: readonly MatchableOffer[],
  listing: { platformOfferId: string; externalId: string | null }
): { offerId: string; matchedBy: AllegroMatchBasis } | null {
  const external = listing.externalId?.trim();
  if (external) {
    const byExternal = offers.filter(
      (offer) => offer.id === external || String(offer.offerNo) === external
    );
    if (byExternal.length === 1) return { offerId: byExternal[0].id, matchedBy: "external" };
    if (byExternal.length > 1) return null;
  }

  const byUrl = offers.filter((offer) => urlNamesPlatformOffer(offer.url, listing.platformOfferId));
  if (byUrl.length === 1) return { offerId: byUrl[0].id, matchedBy: "url" };
  return null;
}

// ---------------------------------------------------------------------------
// Bidding (#481)
// ---------------------------------------------------------------------------

/** Allegro's own word for an auction, in `sellingMode.format`. The other two — `BUY_NOW`,
 *  `ADVERTISEMENT` — have no bidding to observe. */
export const AUCTION_FORMAT = "AUCTION";

/**
 * How often the event poll runs (#481) — the fast path over **both** of Allegro's event streams.
 *
 * Two minutes, and it can be that because it is **event-driven**: it asks what changed, so a poll on
 * a quiet account costs two requests answering with empty pages. Re-reading the account this often
 * to discover that nothing had happened is exactly what the streams exist to avoid.
 *
 * The number is the collector's own answer to "how quickly must I know": a bid commits them to
 * pulling the copies from every other marketplace, and that is a decision measured in minutes. An
 * order rides the same timer because it costs one more request to do so — the reason it used to wait
 * a quarter of an hour was the sweep's cost, and the stream does not have it.
 */
export const EVENT_POLL_INTERVAL_MS = 2 * 60 * 1000;

/**
 * The offer events the poll follows.
 *
 * Both directions, because both move the count: a bid landing is the whole point, and a bid
 * cancelled is the case where the standing figure on screen would otherwise be a bid that no longer
 * exists. Neither ever clears the flag — {@link bidWriteFor} is what decides that, and it does not.
 *
 * Everything else Allegro publishes here — a listing activated, ended, restocked, retitled — is the
 * full sweep's business (#467). Asking for it would turn a poll that is usually an empty page into
 * a poll that re-reads offers on every price edit the collector makes themselves.
 */
export const BID_EVENT_TYPES = ["OFFER_BID_PLACED", "OFFER_BID_CANCELED"] as const;

/** How many offers are asked for in one `GET /sale/offers` read by id. Allegro takes the parameter
 *  repeated; a page of fifty keeps one refused request cheap to repeat. */
export const BID_DETAIL_BATCH = 50;

/** A ceiling on one poll's walk of the event stream, so a long-idle instance cannot spend an
 *  unbounded stretch inside a two-minute timer. The cursor advances as it goes, so the next poll
 *  carries straight on. */
export const MAX_BID_EVENT_PAGES = 20;

/** What the sweep saw of one listing's bidding — the narrowest shape the rule needs. */
export interface ObservedBidding {
  /** Allegro's selling mode, or null where it stated none. */
  format: string | null;
  /** How many have bid. Null is Allegro not having said, which is **not** zero. */
  biddersCount: number | null;
  /** The standing bid and the currency it is quoted in; both null together. */
  currentPrice: string | null;
  currentCurrency: string | null;
  /** When Allegro says the listing closes (#490), or null where it said nothing. */
  endingAt: Date | null;
}

/** The local offer a bid observation would be written onto. */
export interface BiddableOffer {
  listingType: string;
  state: string;
  currency: string;
  inActiveBidding: boolean;
  bidderCount: number | null;
  /** The closing time already recorded locally (#490), so an unchanged one is not rewritten. */
  endsAt: Date | null;
}

/** What to write onto the offer — only the fields that should actually change. */
export interface BidWrite {
  inActiveBidding?: true;
  price?: string;
  priceCheckedAt?: Date;
  bidderCount?: number;
  /** The listing's closing time as Allegro states it (#490). */
  endsAt?: Date;
}

/**
 * What a sweep's sight of an auction means for the offer behind it (#481).
 *
 * Pure, and deliberately the only place the judgements live:
 *
 *  • **Both sides must call it an auction.** Allegro's `sellingMode.format` says what is actually
 *    running; the local `listingType` says what the collector recorded. Acting on Allegro's word
 *    alone would write a standing bid over the asking price of an offer recorded as a quick buy, and
 *    correcting a mis-recorded listing type is a different claim than this makes.
 *  • **A bid sets the flag, and nothing ever clears it.** Not an auction that ended unsold, not a
 *    withdrawn listing, not a bid the bidder retracted: the collector has pulled those copies from
 *    every other marketplace on the strength of this flag, and a silent un-commit in the background
 *    is worse than a row to look at (#215). A count that falls back to zero — a bid retracted — is
 *    still recorded as the observation it is, and that disagreement between a standing flag and a
 *    bidderless auction *is* the row to look at.
 *  • **No bids keeps a zero bid.** The opening figure is never copied into `price` — that is what
 *    `startingPrice` is for, and a bid that never happened must not be recorded as one. The count is
 *    still written, because "looked at, unbid" and "never looked at" are different facts.
 *  • **A bid is only written in the offer's own currency.** An offer is priced in one currency by
 *    decision (#196); converting a marketplace figure into it silently would invent a number. The
 *    flag still goes on — *that* somebody has bid does not depend on the currency it was bid in.
 *  • **A closed offer is left alone.** Sold or withdrawn, there is nothing here to commit and
 *    nothing left to price.
 *  • **The closing time is carried whatever the bidding says** (#490). It is a fact about the
 *    listing, not about the bids, so it is recorded above the guard that stops on an unstated count
 *    — and it is *always* taken from Allegro rather than only being filled in when absent, which is
 *    the whole point: an auction that ended unsold and was relisted automatically comes back with a
 *    new closing time, and an offer still holding the old one would go on being reported as an ended
 *    auction waiting to be resolved.
 *
 * `null` means "write nothing" — including the case where every field already says this. `now` is
 * passed in rather than read, so the rule stays pure and one pass stamps one instant.
 */
export function bidWriteFor(
  listing: ObservedBidding,
  offer: BiddableOffer,
  now: Date
): BidWrite | null {
  if ((listing.format ?? "").toUpperCase() !== AUCTION_FORMAT) return null;
  if (!isAuctionListing(normalizeListingType(offer.listingType))) return null;
  if ((CLOSED_OFFER_STATES as readonly string[]).includes(offer.state)) return null;

  const write: BidWrite = {};
  if (listing.endingAt && listing.endingAt.getTime() !== (offer.endsAt?.getTime() ?? 0)) {
    write.endsAt = listing.endingAt;
  }

  const bidders = listing.biddersCount;
  if (bidders === null || bidders < 0) {
    return write.endsAt ? write : null;
  }

  if (offer.bidderCount !== bidders) write.bidderCount = bidders;

  if (bidders > 0) {
    if (!offer.inActiveBidding) write.inActiveBidding = true;
    if (listing.currentPrice && listing.currentCurrency === offer.currency) {
      write.price = listing.currentPrice;
      // Restamped on every pass that saw a bid, even where the figure has not moved: the date says
      // when the number was last *confirmed*, which is the whole of what it is worth.
      write.priceCheckedAt = now;
    }
  }

  return Object.keys(write).length > 0 ? write : null;
}

/** The floor a window read starts at: {@link SYNC_WINDOW_DAYS} back from now on a first sync, and
 *  from the last sync otherwise, with a day of overlap so an order that landed while a pass was
 *  running is never stepped over. Never earlier than the window, so a long-idle install re-imports
 *  a month rather than a year. */
export function windowFloor(now: Date, ordersSyncedAt: Date | null): Date {
  const window = new Date(now.getTime() - SYNC_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  if (!ordersSyncedAt) return window;
  const overlapped = new Date(ordersSyncedAt.getTime() - 24 * 60 * 60 * 1000);
  return overlapped < window ? window : overlapped;
}

/** How the worklist describes its own currency. `never` is a collection whose sync has not yet run
 *  once — which is not a failure, and must not read as one. */
export type SyncFreshness = "never" | "fresh" | "stale" | "failing";

export function syncFreshness(
  state: { lastSucceededAt: Date | null; lastError: string | null },
  now: Date
): SyncFreshness {
  if (state.lastError) return "failing";
  if (!state.lastSucceededAt) return "never";
  return now.getTime() - state.lastSucceededAt.getTime() > SYNC_STALE_AFTER_MS ? "stale" : "fresh";
}
