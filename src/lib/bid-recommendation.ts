// The arithmetic behind a lot's recommended bid (#509; ADR-0029 §1, §3, §4, §6). No Prisma import —
// kept apart from the domain layer so it is unit-testable, exactly as `auction-lot.ts` beside it.
//
// Everything hard has already happened by the time a line arrives here. Which anchor a line uses —
// ADR-0022's market median for its key, else its catalogue value times the ratio learned from
// recorded results (#520) — is resolved by the caller, as is the conversion into the sale's
// currency (#510). What is left is a sum, a percentage band around it, and the counts that keep the
// answer honest about how much of the lot it could actually price.
//
//     fair     = Σ anchor × quantity          (null when no line is anchored)
//     floor    = fair × bidFloorPercent   / 100
//     walkAway = fair × bidCeilingPercent / 100
//
// All three are **all-in** valuations, because a ceiling is (ADR-0021 §6), so each also carries the
// hammer price that fits inside it — what a bid box actually takes — via `maxBidWithin` with the
// sale's per-lot fees. Shipping is excluded, as everywhere a single lot is costed.
//
// No series premium and no bulk discount: a lot is worth the sum of its lines (ADR-0029 §6).
//
// Money is handled as `number` internally and returned as a 2-dp string, the convention every other
// pure money module here follows.

import { maxBidWithin, type AuctionFees } from "./auction-lot";

// ── The band percentages (#508) ─────────────────────────────────────────────

/** Defaults a collection starts with: buy at least 25% under the fair figure to call it a bargain,
 * walk away 25% above it. A stated trading style, not a measurement — see {@link BidBandPercents}. */
export const DEFAULT_BID_FLOOR_PERCENT = 75;
export const DEFAULT_BID_CEILING_PERCENT = 125;

/** Catalogue → anchor while the collection has no ratio evidence at all (ADR-0029 §2, bucket 5).
 * 100 so that, until anything has been learned, a catalogue-anchored recommendation is exactly what
 * the existing "ceiling ← catalogue value" quick fill (#370) already writes. */
export const DEFAULT_BID_FALLBACK_PERCENT = 100;

/** The range a stored percentage may take. Positive integers only — a floor of zero recommends
 * bidding nothing, and a negative band is not a band. The upper bound is a sanity guard on a
 * column, not an opinion: a collector who genuinely bids ten times catalogue is past what any
 * recommendation can help with. */
export const MIN_BID_PERCENT = 1;
export const MAX_BID_PERCENT = 1000;

/**
 * Read a stored or typed percentage, or null when it isn't a usable one.
 *
 * Floor ≤ 100 ≤ ceiling is deliberately **not** enforced, here or anywhere: a collector may
 * legitimately set a band entirely below the fair figure — "I only buy at 40–60% of what it is
 * worth" is a trading style, not a mistake.
 */
export function parseBidPercent(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(n)) return null;
  if (n < MIN_BID_PERCENT || n > MAX_BID_PERCENT) return null;
  return n;
}

/** The band a collection is configured with (#508). Both are percentages of `fair`, not of the
 * market's own spread: at the sample sizes this evidence has, a measured range would be one or two
 * results wearing a statistic's name (ADR-0029 §4). */
export interface BidBandPercents {
  /** Below this, the lot is a bargain. */
  bidFloorPercent: number;
  /** Past this, it belongs to somebody else. */
  bidCeilingPercent: number;
}

// ── The recommendation ──────────────────────────────────────────────────────

/** Which of the two anchors a line was priced from. There is no blend of the two: a figure that is
 * part-measured and part-policy cannot be explained when it looks wrong (ADR-0029 §1). */
export type BidAnchorSource = "market" | "catalogue";

/**
 * One `AuctionLotLine`, resolved and already converted into the sale's currency by the caller.
 */
export interface BidLine {
  /** How many of this stamp × condition × format the lot holds. Quantity multiplies and nothing
   * else does — a multiple is never decomposed (ADR-0020). */
  quantity: number;
  /** What **one** of them is worth, in the sale's currency. Null when the line could be anchored
   * by neither route: no market datapoint for its key and no catalogue value. */
  anchor: number | null;
  /** Which route produced {@link anchor}. Read only when there is one. */
  source: BidAnchorSource;
  /** An anchor exists but has no rate to the sale's currency. It exists and cannot be summed,
   * which is a different fact from having no price — reporting it as unanchored would send the
   * collector off to enter a value that is already there. */
  unconvertible: boolean;
}

/** One of the three figures: the all-in valuation, and the bid to type to stay inside it. */
export interface BidLevel {
  /** The all-in figure, 2-dp. */
  allIn: string;
  /** The highest hammer price whose all-in still fits inside it, 2-dp — or null when the fees
   * alone already eat the figure, which is a real answer rather than a zero. */
  bid: string | null;
}

/** What a lot is worth bidding, and how much of it could be answered. */
export interface BidRecommendation {
  /** Σ `anchor × quantity` over the anchored lines. **Null when no line is anchored**, rather than
   * `0.00`: a lot whose composition is entered but unpriceable is unanswered, not worthless. */
  fair: BidLevel | null;
  /** `fair × bidFloorPercent / 100`. Null exactly when {@link fair} is. */
  floor: BidLevel | null;
  /** `fair × bidCeilingPercent / 100`. Null exactly when {@link fair} is. */
  walkAway: BidLevel | null;
  /** Lines counted into the figures, by which anchor they used. */
  marketLines: number;
  catalogueLines: number;
  /** Lines with neither anchor. Counted and reported, never treated as zero — exactly as
   * `summarizeLotComposition` already reports `unpricedLines`. */
  unanchoredLines: number;
  /** Lines whose anchor cannot be expressed in the sale's currency. */
  unconvertibleLines: number;
}

/** Round to cents once, at the end. Rounding each component separately would drift by a cent on a
 * percentage that lands mid-way. */
function money(value: number): string {
  return value.toFixed(2);
}

/** A quantity as a line may carry it: whole, never negative. */
function count(quantity: number): number {
  return Number.isFinite(quantity) ? Math.max(0, Math.trunc(quantity)) : 0;
}

/** One figure, with the bid that fits inside it. Fees are the sale's **per-lot** components only —
 * shipping is stripped by {@link recommendBid} before it gets here. */
function level(value: number, fees: AuctionFees): BidLevel {
  const allIn = money(value);
  return { allIn, bid: maxBidWithin(allIn, fees) };
}

/**
 * What to bid on a lot, from its resolved lines and the collection's band.
 *
 * `fees` is the sale's; its `shippingCost` is ignored rather than trusted to be absent, since a
 * parcel ships once however many lots are in it and this figure is about a single lot.
 */
export function recommendBid(
  lines: BidLine[],
  band: BidBandPercents,
  fees: AuctionFees = {}
): BidRecommendation {
  let total = 0;
  let marketLines = 0;
  let catalogueLines = 0;
  let unanchoredLines = 0;
  let unconvertibleLines = 0;

  for (const line of lines) {
    // Unconvertible is asked first: the line *has* an anchor, it just cannot be stated in this
    // sale's currency, so it is neither summed nor filed as having no price.
    if (line.unconvertible) {
      unconvertibleLines++;
      continue;
    }
    if (line.anchor === null || !Number.isFinite(line.anchor)) {
      unanchoredLines++;
      continue;
    }
    if (line.source === "market") marketLines++;
    else catalogueLines++;
    total += line.anchor * count(line.quantity);
  }

  const anchored = marketLines + catalogueLines;
  const perLotFees: AuctionFees = {
    premiumPercent: fees.premiumPercent,
    premiumFixed: fees.premiumFixed,
  };

  return {
    // The band is computed from the unrounded total, so floor and walk-away are percentages of the
    // fair figure itself rather than of a figure already rounded once.
    fair: anchored > 0 ? level(total, perLotFees) : null,
    floor: anchored > 0 ? level((total * band.bidFloorPercent) / 100, perLotFees) : null,
    walkAway: anchored > 0 ? level((total * band.bidCeilingPercent) / 100, perLotFees) : null,
    marketLines,
    catalogueLines,
    unanchoredLines,
    unconvertibleLines,
  };
}
