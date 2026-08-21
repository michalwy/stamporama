// Reservation of committed copies, and marketplace collisions (#639) — the pure half. No Prisma, no
// React, so the two gates, the two screens that state them and the unit tests share one vocabulary.
//
// The rule in one sentence: **a copy promised in an agreed trade must not also be sold out from
// under it, and a copy that has left the collection must not stay promised.**
//
// Nothing here is stored. A commitment is read off the trade the same way a sale is read off its
// `SaleLineItem` rather than a boolean on the copy: a flag would be a second place for the truth to
// live, and the day it disagreed with the trade there would be no way to tell which was right.
//
// **Committed means a give line on an `agreed` trade**, and nothing weaker. `preparing` and `shared`
// are negotiation — a list being composed, or one the partner has not answered yet — and reserving
// against them would stop a collector listing stock they may never send. `closed` and `cancelled`
// release: the exchange happened, or it is off. (`LIVE_TRADE_STATUSES` in `trade-lines.ts` is a
// wider set answering a different question — which trade already *names* a copy, so the picker does
// not offer it twice — and the two are deliberately not merged.)
//
// **Live means an `active` offer**, which is `isLiveState`'s own answer rather than a second reading
// of it: a `preparing` or `ready` offer is being assembled and holds no claim on anything, and a
// paused, sold or withdrawn one has stopped competing.
//
// The gate refuses **by name** — #418's shape — because "this copy is committed elsewhere" with no
// name in it sends the collector hunting through both sides of every section and every set of every
// offer. The reverse warning never refuses anything at all: a promise resting on a piece that no
// longer exists is a fact to be told, and its resolution is a withdrawal (#642), not a block.

import { nameFew } from "./trade-rules";

/** The trade a copy is committed to, named the way a collector reads a trade: its number and the
 *  person on the other end. */
export interface CommittingTrade {
  tradeId: string;
  tradeNo: number;
  partnerName: string;
}

/** The listing a copy is live on, named the way a collector reads an offer: its number, the label
 *  the offers list leads with, and the marketplace it is up on. */
export interface CollidingOffer {
  offerId: string;
  offerNo: number;
  label: string;
  platformName: string;
}

/** One copy promised in an agreed trade, blocking a listing. `label` is the copy as the collector
 *  knows it — `Copy #12`, the same wording the give-side picker refuses in. */
export interface CommittedCopy {
  itemId: string;
  label: string;
  trade: CommittingTrade;
}

/** One copy already live on a marketplace, blocking an agreement. */
export interface ListedCopy {
  itemId: string;
  label: string;
  offer: CollidingOffer;
}

/** Why a promise no longer rests on anything: the copy sold elsewhere, went to another partner
 *  (#644), or stopped being held. Three kinds and not one, because they are three different things
 *  to have happened and the collector resolves them differently — a sale is money that arrived, a
 *  trade is material that arrived, and a disposal is a piece that is simply gone. */
export type DepartedReason = "sold" | "traded" | "disposed";

/** One promised copy that has left the collection. A warning, never a block. */
export interface DepartedCopy {
  itemId: string;
  label: string;
  reason: DepartedReason;
}

/**
 * Why this offer cannot go live: the copies on it that are promised elsewhere, named with the trades
 * holding them.
 *
 * The trades are named rather than the copies counted, because the trade is what the collector has
 * to go and deal with — cancel it, withdraw the line (#642), or leave the listing alone.
 */
export function describeCommittedCopies(copies: readonly CommittedCopy[]): string {
  const trades = [...new Map(copies.map((c) => [c.trade.tradeId, c.trade])).values()];
  const subject =
    copies.length === 1
      ? `${copies[0].label} is`
      : `${copies.length} of this offer's copies are`;
  const held = nameFew(trades.map((t) => `#${t.tradeNo} (${t.partnerName})`));
  return `${subject} promised in an agreed trade: ${held}. Withdraw the line, or cancel the trade, before listing ${copies.length === 1 ? "it" : "them"}.`;
}

/**
 * Why this trade cannot be agreed: the give-side copies already up on a marketplace, named with the
 * listings holding them.
 *
 * The mirror of the sentence above and deliberately the same shape — one collision, told from
 * whichever end the collector happens to be standing at.
 */
export function describeListedCopies(copies: readonly ListedCopy[]): string {
  const offers = [...new Map(copies.map((c) => [c.offer.offerId, c.offer])).values()];
  const subject =
    copies.length === 1
      ? `${copies[0].label} is`
      : `${copies.length} of the copies you are giving are`;
  const listed = nameFew(offers.map((o) => `#${o.offerNo} ${o.label} on ${o.platformName}`));
  return `${subject} live on a marketplace: ${listed}. Withdraw or pause the listing before agreeing this trade.`;
}

/**
 * What has left the collection out from under this trade.
 *
 * One sentence per reason rather than one mixed list: "sold" and "no longer held" are answered in
 * different places, and a collector reading a single list would have to check each copy to find out
 * which of the two it is.
 */
export function describeDepartedCopies(copies: readonly DepartedCopy[]): string[] {
  const out: string[] = [];
  const sold = copies.filter((c) => c.reason === "sold");
  const traded = copies.filter((c) => c.reason === "traded");
  const disposed = copies.filter((c) => c.reason === "disposed");
  if (sold.length > 0) {
    out.push(
      `${sold.length === 1 ? "A copy promised here has" : `${sold.length} copies promised here have`} since sold elsewhere: ${nameFew(
        sold.map((c) => c.label)
      )}.`
    );
  }
  if (traded.length > 0) {
    out.push(
      `${traded.length === 1 ? "A copy promised here has" : `${traded.length} copies promised here have`} since gone to another partner: ${nameFew(
        traded.map((c) => c.label)
      )}.`
    );
  }
  if (disposed.length > 0) {
    out.push(
      `${disposed.length === 1 ? "A copy promised here is" : `${disposed.length} copies promised here are`} no longer held: ${nameFew(
        disposed.map((c) => c.label)
      )}.`
    );
  }
  return out;
}
