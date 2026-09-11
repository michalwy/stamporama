// What the bid recommendation answers with, and the projection that builds it (#1168).
//
// **Pure, and structurally typed on purpose**, exactly as `collection-reads.ts` (#710),
// `offer-reads.ts` (#711) and `want-reads.ts` (#712) are and for their reason (`agent-api.md`, *The
// module layout is the Prisma-free split*): `LineAnchor` carries a resolved line's whole read model
// and a projection naming its type would stop being readable as a statement of what an agent is
// actually told. Everything here is a function of plain objects — no Prisma, no `server-only` — so
// `pnpm test:unit` holds the decisions.
//
// ## The one decision this file exists for: three unanswerable cases stay three answers
//
// `BidRecommendation` already separates them and an agent that collapses them into a number will
// recommend bidding on something unpriceable. They are:
//
//  - **no anchor at all** — `unanchoredLines`. Nothing in the catalogue prices this
//    `stamp × condition × certificate × format` and no result has ever been recorded against it.
//    The lines that *were* anchored still add up; the count is what says the total is partial.
//  - **an anchor with no rate** — `unconvertibleLines`. There *is* a figure and it cannot be
//    expressed in the currency asked for. Reporting it as having no price would send the collector
//    off to enter a value that already exists, which is the distinction
//    `LotLineValue.unconvertible` has carried since #353.
//  - **a figure the fees alone consume** — a level whose `allIn` is stated and whose `bid` is
//    **absent**. That is a real answer and emphatically not a zero: it says *at this house's
//    premium there is no hammer price that stays inside the figure*, which is the clearest possible
//    "do not bother" and would read as "bid nothing" if it came back as `0.00`.
//
// A fourth case looks like one of these and is not: **no line anchored at all**, where `fair` is
// null outright. ADR-0029 §1 is explicit that a lot whose composition is entered but unpriceable is
// *unanswered, not worthless*, so the three levels are absent rather than nought.
//
// ## And the fees are echoed rather than assumed
//
// With no premium stated, `maxBidWithin` returns the all-in figure itself, so `bid` equals `allIn`
// and an agent reading only the hammer price would bid the whole fair valuation and pay the
// premium on top of it. Omitting fees therefore **overstates what may be bid**, which is the wrong
// direction for a control whose whole job is to say *do not bother*. It cannot be defaulted — there
// is no sale here, and the only place a premium lives is the seller — and requiring it would make
// an agent invent a number it does not have. So it is optional and the answer **says what it used**:
// the overstatement stops being silent, which is the part that was actually wrong.

import { compact } from "./collection-reads";

/** One of the three figures: the all-in valuation, and the hammer price to type to stay inside it. */
export interface AgentBidLevel {
  /** The all-in valuation — what the lot is worth *including* the buyer's premium. */
  readonly allIn: string;
  /**
   * The highest hammer price whose all-in still fits inside {@link allIn} — what a bid box takes.
   *
   * **Absent when the fees alone consume the figure**, which is a real answer rather than a zero.
   * With no fees stated it equals {@link allIn}, because there is then nothing to subtract.
   */
  readonly bid?: string;
}

/** What anchored one line, and the evidence behind it. */
export interface AgentBidLine {
  readonly stampId: string;
  readonly stamp?: string;
  readonly catalogNumber?: string;
  readonly condition: string;
  readonly certificate?: string;
  readonly format?: string;
  readonly quantity: number;
  /**
   * `market` — a median of what copies of this exact key actually fetched (ADR-0022); `catalogue` —
   * the catalogue figure times the ratio this collection's own results have learned for its area,
   * grade and period (ADR-0029 §2). **Absent when neither could price the line**, which is the
   * `unanchored` case.
   */
  readonly anchoredOn?: "market" | "catalogue";
  /** What **one** of them is worth, in the answer's currency. Absent when the line is unanchored or
   *  unconvertible — the two are told apart by {@link unconvertible}. */
  readonly unitValue?: string;
  /** There is a figure for this line and no rate carries it into the answer's currency. It is
   *  **not** unpriced: the value exists and cannot be summed. */
  readonly unconvertible?: true;
  /** Datapoints behind a market anchor, so a figure resting on one result is not read as a market. */
  readonly marketSampleSize?: number;
  /** The bucket a learned ratio came from, named — `Polska Ludowa, MNH, 1945–1949` — because a
   *  ratio that cannot be argued with cannot be trusted (ADR-0029 §8). */
  readonly ratioBucket?: string;
  readonly ratioPercent?: number;
  /** Copies of this `stamp × condition` the collection already holds. **Evidence and never
   *  arithmetic** (ADR-0029 §7): it does not move a figure, because duplicates are bought
   *  deliberately for trade and a system-applied haircut would under-bid exactly that material. */
  readonly owned: number;
}

/** What `recommend_bid` answers with. */
export interface AgentBidRecommendation {
  /** What every figure here is stated in. */
  readonly currency: string;
  /** Below this the lot is a bargain. Absent exactly when {@link fair} is. */
  readonly floor?: AgentBidLevel;
  /** What the recorded evidence says it is worth. */
  readonly fair?: AgentBidLevel;
  /** Past this it belongs to somebody else. */
  readonly walkAway?: AgentBidLevel;
  /** The percentages `floor` and `walkAway` were taken at — the collector's own trading style, not
   *  a measured spread (ADR-0029 §4). */
  readonly floorPercent: number;
  readonly walkAwayPercent: number;
  /** The fees the hammer prices were computed with, as the caller stated them. Absent means none
   *  were given, and then every `bid` equals its `allIn`. */
  readonly premiumPercent?: number;
  readonly premiumFixed?: string;
  /** Lines counted into the figures, by which anchor priced them. */
  readonly marketLines: number;
  readonly catalogueLines: number;
  /** Lines nothing could price. The total is over the rest, so this is what says it is partial. */
  readonly unanchoredLines: number;
  /** Lines with a figure and no rate into {@link currency}. */
  readonly unconvertibleLines: number;
  readonly lines: readonly AgentBidLine[];
  /** Stamp ids that are not in this collection. */
  readonly unknownStampIds?: readonly string[];
}

/** A `BidLevel` as the agent reads it: `bid` dropped when the fees consume the figure. */
function level(value: { allIn: string; bid: string | null } | null): AgentBidLevel | undefined {
  if (value === null) return undefined;
  return compact({ allIn: value.allIn, bid: value.bid ?? undefined }) as AgentBidLevel;
}

/** The dictionary names for a line's grade, certificate and format, resolved by the caller off the
 *  very vocabulary the agent sends values from. */
export interface LineNaming {
  readonly condition: string;
  readonly certificate: string | null;
  readonly format: string | null;
}

/**
 * One resolved line as the agent reads it.
 *
 * **A null certificate and a null format are absent rather than spelled**, which is
 * `collection-reads.ts`'s rule (#710) and the right one here: on a described line the null *is* the
 * whole answer — no certificate, a single — exactly as it is on a copy, so its absence says what a
 * spelling would. That is the opposite of `want-reads.ts`, where a null is one **member of a set**
 * and dropping it changes the set; stated here so the difference reads as a decision.
 */
export function bidLine(
  anchor: {
    stampId: string;
    stampName: string | null;
    catalogLabel: string | null;
    quantity: number;
    anchor: number | null;
    source: "market" | "catalogue" | null;
    unconvertible: boolean;
    market: { n: number } | null;
    ratio: { ratio: number; bucketLabel: string } | null;
    owned: number;
  },
  naming: LineNaming
): AgentBidLine {
  const anchored = anchor.anchor !== null && !anchor.unconvertible;
  return compact({
    stampId: anchor.stampId,
    stamp: anchor.stampName ?? undefined,
    catalogNumber: anchor.catalogLabel ?? undefined,
    condition: naming.condition,
    certificate: naming.certificate ?? undefined,
    format: naming.format ?? undefined,
    quantity: anchor.quantity,
    // Read only where there is an anchor, exactly as `bid-recommendation.ts` reads `source`: an
    // unanchored line carries a route it never took.
    anchoredOn: anchored && anchor.source !== null ? anchor.source : undefined,
    unitValue: anchored ? anchor.anchor!.toFixed(2) : undefined,
    unconvertible: anchor.unconvertible ? (true as const) : undefined,
    marketSampleSize: anchor.market?.n,
    ratioBucket: anchor.source === "catalogue" ? anchor.ratio?.bucketLabel : undefined,
    ratioPercent:
      anchor.source === "catalogue" && anchor.ratio
        ? Math.round(anchor.ratio.ratio * 100)
        : undefined,
    owned: anchor.owned,
  }) as AgentBidLine;
}

/** The whole answer. */
export function bidRecommendation(
  source: {
    currency: string;
    band: { bidFloorPercent: number; bidCeilingPercent: number };
    fees: { premiumPercent?: string | number | null; premiumFixed?: string | number | null };
    recommendation: {
      fair: { allIn: string; bid: string | null } | null;
      floor: { allIn: string; bid: string | null } | null;
      walkAway: { allIn: string; bid: string | null } | null;
      marketLines: number;
      catalogueLines: number;
      unanchoredLines: number;
      unconvertibleLines: number;
    };
    unknownStampIds: readonly string[];
  },
  lines: readonly AgentBidLine[]
): AgentBidRecommendation {
  const percent =
    source.fees.premiumPercent === null || source.fees.premiumPercent === undefined
      ? undefined
      : Number(source.fees.premiumPercent);
  const fixed =
    source.fees.premiumFixed === null || source.fees.premiumFixed === undefined
      ? undefined
      : Number(source.fees.premiumFixed).toFixed(2);

  return compact({
    currency: source.currency,
    floor: level(source.recommendation.floor),
    fair: level(source.recommendation.fair),
    walkAway: level(source.recommendation.walkAway),
    floorPercent: source.band.bidFloorPercent,
    walkAwayPercent: source.band.bidCeilingPercent,
    premiumPercent: Number.isFinite(percent) ? percent : undefined,
    premiumFixed: fixed,
    marketLines: source.recommendation.marketLines,
    catalogueLines: source.recommendation.catalogueLines,
    unanchoredLines: source.recommendation.unanchoredLines,
    unconvertibleLines: source.recommendation.unconvertibleLines,
    lines,
    unknownStampIds: source.unknownStampIds.length > 0 ? source.unknownStampIds : undefined,
  }) as AgentBidRecommendation;
}
