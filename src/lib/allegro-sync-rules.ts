/**
 * The decisions the Allegro sold-listing sync makes, kept pure (#467; ADR-0024).
 *
 * Nothing here reaches a database or the network: what a payment status *is*, which local offer an
 * ordered line belongs to and when a worklist has gone stale are rules, and rules that live beside
 * the I/O that uses them are rules nobody tests. `allegro-sync.ts` is the half that fetches and
 * writes, and it makes no judgement of its own.
 */

import { urlNamesPlatformOffer } from "./platform-offer-url";

/** How far back the *first* sync reads. Later passes follow the event stream instead, so this is
 *  only ever the depth of the initial import — and of the fallback when a cursor has aged out. */
export const SYNC_WINDOW_DAYS = 30;

/** How often the background poll runs (#467). Comfortably inside Allegro's rate limits, and close
 *  enough that a worklist opened at any moment is describing the last quarter of an hour. */
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
