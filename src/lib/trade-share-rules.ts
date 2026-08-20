import type { TradeSide, TradeStatus } from "./trade-rules";

// **What a share link is allowed to do** (#640; ADR-0039 §9) — the pure half, with no database and
// no `server-only`, so the rules can be reasoned about and tested on their own.
//
// Three questions live here and nowhere else: whether a string is even one of our tokens, whether a
// given token on a given trade may still be served, and what the partner's page calls the two sides.

/** Every raw token starts with this. `stmpa_` is the Assistant's; a share link is a different
 *  credential authorising a different thing, so it is told apart before a hash is ever computed. */
export const TRADE_SHARE_TOKEN_PREFIX = "stmpx_";

/** Cheap shape check, run before any lookup: anything not carrying our prefix is not ours, and
 *  hashing it to find that out would be a database round trip per stray request. */
export function isTradeShareTokenShape(raw: string): boolean {
  return raw.startsWith(TRADE_SHARE_TOKEN_PREFIX) && raw.length > TRADE_SHARE_TOKEN_PREFIX.length;
}

/**
 * Why a link is not being served.
 *
 * Told apart because they are different news for the reader: *expired* and *withdrawn* say the
 * collector once meant to share this and something has moved on, while *unknown* says the address is
 * simply wrong. The page prints a sentence per reason rather than one blank refusal — the partner
 * has no account, no history and nobody to ask.
 */
export type TradeShareRefusal = "unknown" | "expired" | "cancelled";

export const TRADE_SHARE_REFUSAL_MESSAGE: Record<TradeShareRefusal, string> = {
  unknown: "This link is not valid. It may have been withdrawn, or replaced by a newer one.",
  expired: "This link has expired. Ask the collector for a new one.",
  cancelled: "This exchange has been called off.",
};

/**
 * Whether a verified token may still be served, given the trade it names.
 *
 * **Every live status serves**, `preparing` included: a link is an address for a list, not a stage of
 * the negotiation, and the collector who generated one while still composing did so on purpose.
 * Minting a link is deliberately **not** the `preparing → shared` transition either — that move is
 * the collector's own act, gated on the valuation check, and a link that silently performed it would
 * be a button doing two things.
 *
 * `cancelled` is the one refusal: the exchange is off, and a partner refreshing an old link should
 * be told so rather than shown a list nobody intends to honour. `closed` still serves, because the
 * partner is entitled to the list of what was actually exchanged after it has happened.
 */
export function resolveTradeShareAccess(
  token: { expiresAt: Date | null },
  status: TradeStatus,
  now: Date
): { ok: true } | { ok: false; reason: TradeShareRefusal } {
  if (token.expiresAt && token.expiresAt.getTime() <= now.getTime()) {
    return { ok: false, reason: "expired" };
  }
  if (status === "cancelled") return { ok: false, reason: "cancelled" };
  return { ok: true };
}

/**
 * What the partner's page heads each side with.
 *
 * **By name, never by "give" and "receive".** Those two words are the collector's, and on the
 * partner's screen they invert: what the collector gives is what the partner gets. A page that
 * printed the collector's vocabulary to the other side of the table would have every reader working
 * out whose point of view they were reading from, so both headings name who the material comes from
 * and neither reader has to.
 */
export function tradeShareSideHeading(
  side: TradeSide,
  collectorName: string,
  partnerName: string
): string {
  return side === "give" ? `From ${collectorName}` : `From ${partnerName}`;
}
