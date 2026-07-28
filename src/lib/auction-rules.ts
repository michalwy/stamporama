// Pure, Prisma-free vocabulary and parsing for auction tracking (#351/#352; ADR-0021), safe to
// import from both server and client code — the same split `sale-status.ts` makes for sales. The
// arithmetic lives next door in `auction-lot.ts`; this module owns the token sets, their labels and
// the small validation the domain module and the server actions share.
//
// The one rule with any thought behind it is **staleness** (§5): refreshing a bid is manual, so the
// screen has to say which lots are worth the effort. That is not "old" in the abstract — it is old
// *relative to how soon the lot closes*. A lot last checked three days ago that closes tonight is
// the one to open; the same lot closing in a month is fine.

import { normalizeDecimalInput } from "./decimal-input";

// ── Lot outcome ─────────────────────────────────────────────────────────────

/** A lot's outcome. `watching` is still running; the other three are terminal. Re-stated from
 * `auction-lot.ts` rather than imported both ways — that module owns the arithmetic, this one the
 * vocabulary, and the type is the seam between them. */
export type AuctionLotStatus = "watching" | "won" | "lost" | "cancelled";

/** Lifecycle order: what is still live first, then what was paid for, then what was not. Doubles as
 * the filter-chip order and as the sort rank when lots of several statuses are listed together. */
export const AUCTION_LOT_STATUSES: readonly AuctionLotStatus[] = [
  "watching",
  "won",
  "lost",
  "cancelled",
];

export const AUCTION_LOT_STATUS_LABEL: Record<AuctionLotStatus, string> = {
  watching: "Watching",
  won: "Won",
  lost: "Lost",
  cancelled: "Cancelled",
};

const VALID_LOT_STATUS = new Set<AuctionLotStatus>(AUCTION_LOT_STATUSES);

export function isAuctionLotStatus(value: string): value is AuctionLotStatus {
  return VALID_LOT_STATUS.has(value as AuctionLotStatus);
}

/** Whether the outcome is settled. Only a `watching` lot can still be bid on, so this is what the
 * inline bid editor and the staleness signal key off. */
export function isTerminalLotStatus(status: AuctionLotStatus): boolean {
  return status !== "watching";
}

// ── Sale status ─────────────────────────────────────────────────────────────

/** `open` — lots are still being added; `settled` — transcribed into a purchase (#28); `closed` —
 * nothing was won, so there is nothing to settle. Only an `open` sale is a candidate for the
 * automatic matching in #352: winning something from the same seller after their parcel has
 * shipped is a second sale, and that is the whole point of §1. */
export type AuctionSaleStatus = "open" | "settled" | "closed";

export const AUCTION_SALE_STATUSES: readonly AuctionSaleStatus[] = ["open", "settled", "closed"];

export const AUCTION_SALE_STATUS_LABEL: Record<AuctionSaleStatus, string> = {
  open: "Open",
  settled: "Settled",
  closed: "Closed",
};

const VALID_SALE_STATUS = new Set<AuctionSaleStatus>(AUCTION_SALE_STATUSES);

export function isAuctionSaleStatus(value: string): value is AuctionSaleStatus {
  return VALID_SALE_STATUS.has(value as AuctionSaleStatus);
}

// ── Staleness (§5) ──────────────────────────────────────────────────────────

/**
 * How much attention a watched lot's bid needs.
 *
 * - `fresh` — checked recently enough for how soon it closes.
 * - `stale` — the observation is old relative to the time left.
 * - `unchecked` — never checked at all, so there is no observation to trust.
 * - `closed` — `endsAt` has passed while the lot is still `watching`: the outcome is what is
 *   missing now, not the bid. It ranks above `stale` because it is the only one that will never
 *   fix itself.
 */
export type BidFreshness = "fresh" | "stale" | "unchecked" | "closed";

/** Sort rank for the freshness signal — what needs attention first. */
export const BID_FRESHNESS_RANK: Record<BidFreshness, number> = {
  closed: 0,
  unchecked: 1,
  stale: 2,
  fresh: 3,
};

/**
 * The staleness rule: an observation may be at most **a quarter of the time that was left when it
 * was taken** old before it counts as stale.
 *
 * That single ratio gives the behaviour the screen needs at both ends without a table of
 * thresholds. A lot closing in an hour goes stale in fifteen minutes; one closing in a month keeps
 * a week-old reading. Bids move as the close approaches, which is exactly when the ratio tightens.
 *
 * Capped at a day, because on a marketplace basket running for months a stale-in-three-weeks lot
 * still tells you nothing about what it costs today.
 */
const STALE_FRACTION = 0.25;
const STALE_CAP_MS = 24 * 60 * 60 * 1000;

/** {@link BidFreshness} for one lot. `now` is passed in rather than read — the caller renders on a
 * clock, and a pure function must not have one. A terminal lot is always `fresh`: its bid is
 * history, and flagging settled rows would bury the live ones. */
export function bidFreshness(
  lot: { status: AuctionLotStatus; endsAt: Date; checkedAt: Date | null },
  now: Date
): BidFreshness {
  if (isTerminalLotStatus(lot.status)) return "fresh";
  const endsAt = lot.endsAt.getTime();
  if (endsAt <= now.getTime()) return "closed";
  if (!lot.checkedAt) return "unchecked";

  const checkedAt = lot.checkedAt.getTime();
  // A reading taken after the lot closes is nonsense, but so is treating it as stale: the window
  // below would be negative. Clamp to "checked now".
  const remainingWhenChecked = Math.max(0, endsAt - checkedAt);
  const allowance = Math.min(remainingWhenChecked * STALE_FRACTION, STALE_CAP_MS);
  return now.getTime() - checkedAt > allowance ? "stale" : "fresh";
}

/**
 * How pressing a lot's closing time is, for tinting it on the list.
 *
 * - `past` — it has already closed while still being watched. Nothing can be done about the bid
 *   any more; what is missing is the outcome.
 * - `imminent` — inside two hours, which on any platform is when the bidding actually happens.
 * - `soon` — inside a day: today's work.
 * - `later` — everything else, and every settled lot, whose date is history rather than a deadline.
 *
 * Absolute thresholds on purpose, unlike {@link bidFreshness}, which is relative: staleness asks
 * "is this reading still good?", and that depends on the time left, while this asks "do I have to
 * deal with it now?", and an hour is an hour.
 */
export type ClosingUrgency = "past" | "imminent" | "soon" | "later";

const IMMINENT_MS = 2 * 60 * 60 * 1000;
const SOON_MS = 24 * 60 * 60 * 1000;

export function closingUrgency(
  lot: { status: AuctionLotStatus; endsAt: Date },
  now: Date
): ClosingUrgency {
  if (isTerminalLotStatus(lot.status)) return "later";
  const left = lot.endsAt.getTime() - now.getTime();
  if (left <= 0) return "past";
  if (left <= IMMINENT_MS) return "imminent";
  if (left <= SOON_MS) return "soon";
  return "later";
}

// ── Parsing ─────────────────────────────────────────────────────────────────

/** Validate and normalise an **optional** non-negative auction amount (a bid, a ceiling, shipping,
 * a fixed premium). Blank means "not recorded" and normalises to `null` — a lot nobody has bid on
 * is not a lot bid at zero, which is the distinction `auction-lot.ts` is built on. */
export function parseAuctionAmount(
  raw: string,
  label: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const trimmed = normalizeDecimalInput(raw.trim());
  if (!trimmed) return { ok: true, value: null };
  const n = Number(trimmed);
  if (!Number.isFinite(n)) return { ok: false, message: `${label} must be a number.` };
  if (n < 0) return { ok: false, message: `${label} cannot be negative.` };
  return { ok: true, value: n.toFixed(2) };
}

/** Same, for the buyer's premium percentage. Capped at 100: a premium above the hammer price is a
 * typo every time, and the column is `Decimal(5, 2)`. */
export function parsePremiumPercent(
  raw: string
): { ok: true; value: string | null } | { ok: false; message: string } {
  const parsed = parseAuctionAmount(raw, "Buyer's premium");
  if (!parsed.ok) return parsed;
  if (parsed.value !== null && Number(parsed.value) > 100) {
    return { ok: false, message: "Buyer's premium cannot be more than 100%." };
  }
  return parsed;
}

/**
 * Parse a closing time. The client submits an ISO instant (it converts the `datetime-local` field
 * through the browser's own zone, which is the only place the collector's zone is known), so this
 * only has to reject what is not one.
 */
export function parseAuctionInstant(raw: string): Date | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const d = new Date(trimmed);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** A URL as the lot and sale forms record it: trimmed, blank clears. Mirrors the offer listing
 * link's rule (`offer-rules.normalizeUrl`) — restated here only because that module is about the
 * offer state machine and importing it would tie the two together for one line. */
export function normalizeAuctionUrl(raw: string): string | null {
  const trimmed = raw.trim();
  return trimmed ? trimmed : null;
}

/** Optional free text (lot number, title, notes): trimmed, blank clears. */
export function normalizeAuctionText(raw: string | null | undefined): string | null {
  const trimmed = (raw ?? "").trim();
  return trimmed ? trimmed : null;
}

/**
 * A sale's display name when it was not given one. A marketplace basket is never named by hand —
 * it is "everything I am currently bidding on with this seller" — so the automatic matching (#352)
 * derives `Seller · Platform`, which is exactly what identifies it.
 */
export function deriveAuctionSaleName(sellerName: string, platformName: string): string {
  return sellerName === platformName ? sellerName : `${sellerName} · ${platformName}`;
}
