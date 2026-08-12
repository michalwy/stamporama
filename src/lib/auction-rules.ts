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
import { compactCatalogNumbers } from "./offer-title-template";

// ── Lot lifecycle and outcome (ADR-0021 §4) ─────────────────────────────────
//
// Two different questions, deliberately kept apart. **Lifecycle** is where the lot is in its life
// and is recorded by hand. **Outcome** is how the bidding went and is *computed* from the figures by
// `lotOutcome` in `auction-lot.ts` — never stored, because it is a conclusion rather than a fact.
// The vocabulary for both lives here; the arithmetic behind the second lives next door.

/** Where a lot is in its life, as the collector records it.
 *
 * - `open` — still running, or ended and not yet gone back to.
 * - `closed` — the auction ended and its figures have been confirmed.
 * - `cancelled` — withdrawn by the seller, or ended without a sale. No datapoint at all.
 *
 * Re-stated from `auction-lot.ts` rather than imported both ways — that module owns the arithmetic,
 * this one the vocabulary, and the type is the seam between them. */
export type AuctionLotStatus = "open" | "closed" | "cancelled";

export const AUCTION_LOT_STATUSES: readonly AuctionLotStatus[] = ["open", "closed", "cancelled"];

export const AUCTION_LOT_STATUS_LABEL: Record<AuctionLotStatus, string> = {
  open: "Open",
  closed: "Closed",
  cancelled: "Cancelled",
};

const VALID_LOT_STATUS = new Set<AuctionLotStatus>(AUCTION_LOT_STATUSES);

export function isAuctionLotStatus(value: string): value is AuctionLotStatus {
  return VALID_LOT_STATUS.has(value as AuctionLotStatus);
}

/** Whether the lot is finished with. Only an `open` lot can still be bid on, so this is what the
 * inline bid editor and the staleness signal key off. */
export function isTerminalLotStatus(status: AuctionLotStatus): boolean {
  return status !== "open";
}

/**
 * How the bidding went — **derived**, and what the screens actually name a lot by.
 *
 * - `pending` — the lot is `open`, so there is no outcome yet to speak of.
 * - `won` — the result came in below the collector's own maximum.
 * - `lost` — it went past it.
 * - `observed` — no bid was ever placed. The lot was tracked to record what it fetched, which is a
 *   price datapoint for #24 and emphatically not a defeat.
 * - `cancelled` — the lifecycle state of the same name; there was no result to have.
 */
export type AuctionLotOutcome = "pending" | "won" | "lost" | "observed" | "cancelled";

/** Order: what is still live first, then what was paid for, then what was not, then what was only
 * watched, then what never happened. Doubles as the filter-chip order. */
export const AUCTION_LOT_OUTCOMES: readonly AuctionLotOutcome[] = [
  "pending",
  "won",
  "lost",
  "observed",
  "cancelled",
];

/** `pending` is labelled after its lifecycle state rather than as "Pending": on a filter chip the
 * collector is picking between lots still in play and lots filed, and "Open" is what the row says. */
export const AUCTION_LOT_OUTCOME_LABEL: Record<AuctionLotOutcome, string> = {
  pending: "Open",
  won: "Won",
  lost: "Lost",
  observed: "Observed",
  cancelled: "Cancelled",
};

const VALID_LOT_OUTCOME = new Set<AuctionLotOutcome>(AUCTION_LOT_OUTCOMES);

export function isAuctionLotOutcome(value: string): value is AuctionLotOutcome {
  return VALID_LOT_OUTCOME.has(value as AuctionLotOutcome);
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

/** The most of one stamp a single lot line may state. A house lot holding a thousand of one stamp
 * at one condition is a typo, and the composition editor is not a bulk-intake screen. */
const MAX_LINE_QUANTITY = 9999;

/**
 * Parse a composition line's quantity (#353).
 *
 * Blank means one — a line the collector added without touching the field is one stamp, which is
 * the overwhelmingly common case and the schema's own default. Zero is refused rather than stored:
 * a line for none of something is a line that should not exist, and deleting it says so plainly.
 */
export function parseLotQuantity(
  raw: string
): { ok: true; value: number } | { ok: false; message: string } {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: 1 };
  const n = Number(trimmed);
  if (!Number.isInteger(n)) return { ok: false, message: "Quantity must be a whole number." };
  if (n < 1) return { ok: false, message: "Quantity must be at least 1 — remove the line instead." };
  if (n > MAX_LINE_QUANTITY) {
    return { ok: false, message: `Quantity cannot be more than ${MAX_LINE_QUANTITY}.` };
  }
  return { ok: true, value: n };
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

// ── Derived lot name (#353) ─────────────────────────────────────────────────

/** One composition line, as the derived lot name reads it. */
export interface AuctionLotLabelLine {
  /**
   * The line's catalog number, **prefix-formatted** (`Mi·PL 12`) — the caller resolves the prefix,
   * because which vendor is primary and how it is prefixed both depend on the stamp's area.
   *
   * One number, not all of them: a lot is named after one catalogue, and printing three numbering
   * systems side by side names none of them (#357). Empty when the stamp carries no number.
   */
  catalogNumbers: readonly string[];
  stampName: string | null;
  /** Null for a stamp that belongs to no issue; groups with the other such lines. */
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  quantity: number;
}

/**
 * What a lot is called, in the one order every surface reads it in: the name the collector gave it,
 * then the name derived from what it holds (#353), then the house's own number for it.
 *
 * The derived name outranks the number deliberately — `Mi·PL 1-12 · Definitives (1950)` says what
 * the lot *is*, while `Lot 385` only says where it sits in someone else's catalogue. But a lot bid
 * on sight-unseen has neither of the first two, and there the number is the only thing that
 * identifies it at all: that is the case #556 was about, where settlement dropped it and the
 * purchase line came out generically numbered, unattributable to the lot it was won as.
 *
 * Returns null when the lot answers to none of the three. Callers supply their own last resort,
 * which differs by surface — a watchlist row says "Untitled lot", an action item names the sale.
 */
export function auctionLotName(lot: {
  title: string | null;
  derivedTitle?: string | null;
  lotNo: string | null;
}): string | null {
  return lot.title || lot.derivedTitle || (lot.lotNo ? `Lot ${lot.lotNo}` : null);
}

/** Past this, a collapsed number list has stopped identifying the lot and started being a wall of
 * digits — the count says more. Truncating mid-range would print a span the lot does not hold. */
const MAX_LABEL_NUMBERS = 48;

function stampsWord(n: number): string {
  return `${n} stamp${n === 1 ? "" : "s"}`;
}

/**
 * What to call a lot the collector never named, derived from **what it holds** (#353).
 *
 * A house lot is identified by its numbers — "Mi 1-12, complete" — so the numbers lead, carrying
 * their catalogue prefix and collapsed on both of #150's axes by the very engine that writes listing
 * titles (`compactCatalogNumbers`); two implementations of that collapsing would drift apart within
 * a release. The prefix rides *inside* the collapsing rather than being bolted on around it, which
 * is what keeps a lot spanning two areas honest: `Mi·PL 1-3,Mi·DE 5` is two families, and each says
 * which catalogue it belongs to. The issue follows as context when every line shares one, because
 * even a prefixed span is ambiguous across a collection and `Mi·PL 1-12 · Definitives (1950)` is not.
 *
 * A lot spanning several issues is **not** enumerated: the point of a name is to be read at a
 * glance down a watchlist, and a mixed lot's honest short answer is its size.
 *
 * Returns null when there is nothing to derive from, which is the normal state of a lot the moment
 * it is captured — the caller then falls back to the lot number.
 */
export function deriveAuctionLotLabel(lines: readonly AuctionLotLabelLine[]): string | null {
  if (lines.length === 0) return null;

  const stamps = lines.reduce((n, l) => n + Math.max(0, l.quantity), 0);
  const issues = new Map<string, { name: string | null; year: number | null }>();
  for (const line of lines) {
    issues.set(line.issueId ?? "__none__", { name: line.issueName, year: line.issueYear });
  }

  if (issues.size > 1) {
    return `${stampsWord(stamps)} · ${issues.size} issues`;
  }

  const numbers = lines.map((l) => l.catalogNumbers[0]).filter((n): n is string => !!n);
  const collapsed = numbers.length > 0 ? compactCatalogNumbers(numbers) : "";
  const names = [...new Set(lines.map((l) => l.stampName?.trim()).filter((n): n is string => !!n))];

  const head =
    collapsed && collapsed.length <= MAX_LABEL_NUMBERS
      ? collapsed
      : names.length > 0 && names.length <= 3
        ? names.join(", ")
        : stampsWord(stamps);

  const [{ name, year }] = [...issues.values()];
  const issue = name || year ? [name ?? "(unnamed issue)", year ? `(${year})` : null].filter(Boolean).join(" ") : null;
  return issue ? `${head} · ${issue}` : head;
}
