// Pure arithmetic for auction tracking (#350; ADR-0021). No Prisma import — kept apart from the
// domain layer so it is unit-testable, mirroring how `offer-summary.ts` holds the offer bar's sums
// and `valuation.ts` holds `aggregateHoldings`.
//
// The one figure everything here is built on is the **all-in cost**: what a bid actually costs once
// the seller's buyer's premium and the shipping share are added. Comparing a catalogue value
// against the hammer price alone systematically overpays on cheap lots, where shipping is a large
// share of what leaves the bank account.
//
//     allIn(bid) = bid + bid × premiumPercent / 100 + premiumFixed + shippingCost
//     headroom   = catalogueValue − allIn(bid)
//
// Money is handled as `number` internally and returned as a 2-dp string, the convention every other
// pure money module here follows.

import type { CatalogPriceMark } from "./catalog-price-mark";

/** An amount as it arrives from the database (a Prisma `Decimal` serialises to a string), from a
 * form, or already as a number. Null/undefined/blank all mean "not recorded". */
export type Amount = string | number | null | undefined;

/** The seller's terms as a sale carries them. Every part is optional: a marketplace seller
 * typically charges no premium at all, and shipping may not be known until the parcel is quoted. */
export interface AuctionFees {
  /** Buyer's premium as a percentage of the hammer price, e.g. `20` for 20%. */
  premiumPercent?: Amount;
  /** A flat per-lot fee charged on top of the percentage. Both apply — a house charging 20% plus a
   * lot fee is one set of terms, not two. */
  premiumFixed?: Amount;
  /** Shipping for the parcel. It belongs to the **sale**, not the lot, so summing `allIn` across
   * several lots would count it once per lot; {@link summarizeAuctionSale} adds it once instead. */
  shippingCost?: Amount;
}

/** Parse an amount, treating anything unparseable as absent rather than as zero. */
function num(value: Amount): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  // A blank string is an empty field, not a zero — `Number("")` is 0, so it has to be caught here.
  const trimmed = value.trim();
  if (!trimmed) return null;
  const n = Number(trimmed);
  return Number.isFinite(n) ? n : null;
}

/** Same, but for the fee components, where "not recorded" and "zero" cost the same. */
function fee(value: Amount): number {
  return num(value) ?? 0;
}

/** Round to cents once, at the end. Rounding each component separately would drift by a cent on
 * a percentage that lands mid-way. */
function money(value: number): string {
  return value.toFixed(2);
}

/**
 * What a bid actually costs: hammer price + percentage premium + fixed premium + shipping.
 *
 * Returns null when no bid is recorded — a lot nobody has bid on yet has no cost, and that is
 * different from a cost of zero. Pass `shippingCost` only where the figure is a single lot's true
 * total; when summing a whole parcel use {@link summarizeAuctionSale}, which adds shipping once.
 */
export function allIn(bid: Amount, fees: AuctionFees = {}): string | null {
  const base = num(bid);
  if (base === null) return null;
  return money(allInValue(base, fees));
}

/** {@link allIn} as a raw number, for the aggregation below. */
function allInValue(bid: number, fees: AuctionFees): number {
  return (
    bid + (bid * fee(fees.premiumPercent)) / 100 + fee(fees.premiumFixed) + fee(fees.shippingCost)
  );
}

/**
 * How much room is left against a catalogue value: `catalogueValue − allIn(bid)`.
 *
 * Positive means the lot is still below catalogue all-in; negative means the bid has passed it.
 * Null when either side is unrecorded — a lot with no composition entered yet has no catalogue
 * value, and reporting that as zero headroom would read as "bid exactly to catalogue".
 */
export function headroom(catalogValue: Amount, bid: Amount, fees: AuctionFees = {}): string | null {
  const cv = num(catalogValue);
  const base = num(bid);
  if (cv === null || base === null) return null;
  return money(cv - allInValue(base, fees));
}

/**
 * What one won lot costs as a **purchase line** when the parcel is settled (#28): hammer price plus
 * the seller's premium, and **no shipping**.
 *
 * Shipping is deliberately left out here even though the lot is being costed for real money. It
 * becomes `Purchase.shippingCost` and is then distributed across every line by price through
 * ADR-0009 §3 — the same mechanism a hand-entered purchase uses. Adding it per line here would
 * charge it once per lot and then a second time through the distribution.
 *
 * Null when the lot has no price, which settlement refuses before it gets this far: a `won` lot's
 * `finalPrice` is required precisely because this figure is built from it (ADR-0021 §7).
 */
export function settlementLinePrice(finalPrice: Amount, fees: AuctionFees = {}): string | null {
  return allIn(finalPrice, { premiumPercent: fees.premiumPercent, premiumFixed: fees.premiumFixed });
}

/**
 * The **highest hammer price whose all-in cost still fits inside a ceiling** — the inverse of
 * {@link allIn}, and what a bid should actually be placed at.
 *
 *     bid = (ceiling − premiumFixed − shipping) / (1 + premiumPercent / 100)
 *
 * A ceiling is what the lot is worth **all-in** (ADR-0021 §6), but what gets typed into the
 * platform's bid box is a hammer price. Bidding the ceiling itself therefore overshoots by exactly
 * the fees — on a 20% house, a 100 ceiling bid at 100 costs 120.
 *
 * Rounded **down** to the cent: rounding up would put the all-in a cent past the very limit this
 * exists to respect. Null when no ceiling is recorded, and null when the fees alone already eat it
 * — there is then no bid that fits, which is a real answer rather than a zero.
 *
 * Pass `shippingCost` only when costing the lot as if it were the sole thing won from the sale; the
 * per-lot views leave it out, exactly as {@link allIn} does.
 */
export function maxBidWithin(ceiling: Amount, fees: AuctionFees = {}): string | null {
  const cap = num(ceiling);
  if (cap === null) return null;
  const room = cap - fee(fees.premiumFixed) - fee(fees.shippingCost);
  if (room <= 0) return null;
  const hammer = room / (1 + fee(fees.premiumPercent) / 100);
  return (Math.floor(hammer * 100) / 100).toFixed(2);
}

/**
 * The hammer price that **costs** a given all-in figure — {@link allIn} inverted and rounded to the
 * **nearest** cent.
 *
 * Deliberately not {@link maxBidWithin}, which asks a different question. That one respects a
 * *cap*, so it rounds down and a cent of slack is the correct answer. This one converts a figure
 * the collector **stated**: they typed a total into the all-in cell of their own column, and the
 * bid stored has to be the one that reads back as the number they typed. Rounding down there loses
 * a cent on the way out and shows it straight back to them — a 20% + 1.50 house turns a stated 200
 * into 199.99, which reads as arithmetic going wrong rather than as a bid being chosen.
 *
 * Nothing here is a limit, so nearest is safe: a placed bid is a *record* of a commitment, and
 * whether it sits above what the lot is worth to the collector is what the ceiling and
 * `myBidOverCeiling` are for.
 *
 * Null when the target is unrecorded, and null when the fees alone already exceed it — no bid
 * produces that total, which is a real answer rather than a zero.
 */
export function bidCosting(total: Amount, fees: AuctionFees = {}): string | null {
  const target = num(total);
  if (target === null) return null;
  const room = target - fee(fees.premiumFixed) - fee(fees.shippingCost);
  if (room <= 0) return null;
  return money(room / (1 + fee(fees.premiumPercent) / 100));
}

/**
 * The smallest ceiling that still **allows** a given bid: {@link allIn} rounded **up** to the cent.
 *
 * The mirror of {@link bidCosting}, for the other two-sided column. A ceiling is an all-in
 * valuation, so typing a bid into its bid cell means "I want to be able to bid this much" — and the
 * ceiling stored has to be enough for that bid to still fit inside it. Rounding to nearest would
 * round *down* whenever the true cost lands mid-cent, and {@link maxBidWithin} would then hand back
 * a bid one cent under the one that was typed.
 *
 * The epsilon absorbs binary-float noise, so a cost that is exactly a whole cent is not pushed up
 * to the next one.
 */
export function ceilingAllowing(bid: Amount, fees: AuctionFees = {}): string | null {
  const base = num(bid);
  if (base === null) return null;
  return (Math.ceil(allInValue(base, fees) * 100 - 1e-6) / 100).toFixed(2);
}

/**
 * The ceiling a lot is held to: the one **set apart** when there is one, else what the collector's
 * own bid costs all-in (#1515).
 *
 * A ceiling **follows the bid unless it is set apart**. The collector almost always bids and caps a
 * lot at the same figure, so `AuctionLot.maxBid` stores only a ceiling chosen *separately* from the
 * bid — from the row's ⋮ menu or the lot's form — and stays put until it is cleared. Null there means
 * "my ceiling is my bid": it moves whenever the bid does, whether the bid came from *Bid this* or was
 * typed by hand, and it is never stored, so a later change of premium cannot leave it behind.
 *
 * Every reader that compares against a ceiling goes through this — the signals, the exposure totals,
 * the morning reminder, the agent's reads — so a lot carrying only a bid is capped at that bid
 * everywhere at once. Premium only, never shipping: like {@link allIn} on a row, a ceiling is about
 * one lot, and shipping belongs to the parcel. Null when neither figure is recorded.
 */
export function ceilingOf(
  lot: { myBid?: Amount; maxBid?: Amount },
  fees: AuctionFees = {}
): string | null {
  const apart = num(lot.maxBid);
  if (apart !== null) return money(apart);
  return allIn(lot.myBid, { premiumPercent: fees.premiumPercent, premiumFixed: fees.premiumFixed });
}

/**
 * Where the collector stands on a lot, derived from what they placed against what it now stands at.
 *
 * - `leading` — their bid is at or above the current price, so nobody has passed them.
 * - `outbid` — the price has gone beyond what they committed.
 * - `null` — one of the two is unrecorded, so the question cannot be answered. Not "leading".
 *
 * Deliberately **not stored**: a flag would be a third figure to keep current by hand, and it would
 * be wrong the moment the price moved without anyone updating it. An exact tie counts as leading —
 * on the platforms this tracks, the earlier bid wins a tie, and the earlier bid is the one already
 * placed.
 */
export function bidStanding(myBid: Amount, currentBid: Amount): "leading" | "outbid" | null {
  const mine = num(myBid);
  const current = num(currentBid);
  if (mine === null || current === null) return null;
  return mine >= current ? "leading" : "outbid";
}

/** Where a lot is in its life, as the collector records it. `open` is still in play; the other two
 * are terminal. Mirrored from `auction-rules.ts`, which owns the vocabulary. */
export type AuctionLotStatus = "open" | "closed" | "cancelled";

/** How the bidding went — derived here, never stored. Mirrored from `auction-rules.ts`. */
export type AuctionLotOutcome = "pending" | "won" | "lost" | "observed" | "cancelled";

/** What {@link lotOutcome} reads. Everything on it is already recorded on the lot. */
export interface LotOutcomeInput {
  status: AuctionLotStatus;
  /** The collector's own **maximum**, as placed at the platform. Absent means they never bid. */
  myBid?: Amount;
  /** What the lot fetched. */
  finalPrice?: Amount;
  /** Who bid first, consulted only at {@link lotOutcome}'s tie. */
  wonTie?: boolean | null;
}

/**
 * How the bidding went, computed from the figures the lot already carries (ADR-0021 §4).
 *
 * The comparison works because `myBid` is a **proxy maximum**, not a bid the lot stands at: winning
 * pays the runner-up's maximum plus an increment, which lands *below* your own, while being outbid
 * puts the result *above* it. So `finalPrice < myBid` is a win and `finalPrice > myBid` is a loss,
 * with no flag to keep in step and nothing that can contradict the money.
 *
 * Three cases the arithmetic cannot answer on its own:
 *
 * - **No `myBid` at all** — `observed`. The lot was tracked to record what it went for without ever
 *   being bid on, which is a price datapoint and not a defeat. This is the case the old
 *   won/lost/cancelled vocabulary had nowhere to put.
 * - **A tie.** Equal figures come from two different worlds — you bid your maximum first and won, or
 *   somebody else bid the same maximum first and you lost — and only the order of the bids tells
 *   them apart. That is what `wonTie` records, asked once at closing. Null there reads as `lost`:
 *   the close form always asks, so it should not arise, and guessing a win would feed a fabricated
 *   line into settlement (§7).
 * - **A bid but no `finalPrice`** — `lost`, and **only reachable on rows written before this
 *   model**. Closing now refuses a blank price unless the collector's own bid is cleared, so the
 *   state cannot be created; ADR-0021 §5 filed exactly this shape as "lost with no figure", and
 *   reading it any other way would silently restate history.
 */
export function lotOutcome(lot: LotOutcomeInput): AuctionLotOutcome {
  if (lot.status === "open") return "pending";
  if (lot.status === "cancelled") return "cancelled";

  const mine = num(lot.myBid);
  if (mine === null) return "observed";

  const final = num(lot.finalPrice);
  if (final === null) return "lost";
  if (final < mine) return "won";
  if (final > mine) return "lost";
  return lot.wonTie === true ? "won" : "lost";
}

/** What {@link closingPricePrefill} reads: the price already confirmed on this lot, if any, and the
 * last bid observed on it. */
export interface ClosingPrefillInput {
  /** A result already recorded — reopening the close dialog is editing that figure, not guessing
   * again. */
  finalPrice?: Amount;
  /** The last bid **observed on the lot**, as `AuctionLot.currentBid` holds it. */
  currentBid?: Amount;
}

/**
 * What the closing-price field opens carrying (#851).
 *
 * The order is: a price already confirmed on this lot, else the last bid observed on it, else
 * nothing.
 *
 * **Which bid — and it is `currentBid`, never the highest figure the lot holds.** A lot carries
 * three amounts before it closes and only one of them is a bid anyone actually made *on the lot*:
 * `currentBid` is what it stood at when it was last read, `myBid` is the proxy maximum placed at
 * the platform (which the platform bids up only as far as it must), and `maxBid` is a private
 * ceiling that may never have been placed anywhere. Highest and most recent cannot disagree
 * *within* `currentBid` — ADR-0021 §5: "`currentBid` is overwritten in place and `checkedAt`
 * records when it was read. There is no bid history table." — so the question only arises across
 * the three fields, and there the highest figure is routinely `maxBid`, a number nobody ever bid.
 * Taking the most recent observation is therefore the only reading that always names a real bid.
 *
 * **No bid gives an empty field, never a zero.** A zero is a recorded price rather than an absent
 * one, and it would land in the market data #24 consumes and drag every average over closed lots
 * down with it. A `currentBid` of zero or less is read the same way: nobody bids nothing, so that
 * is an empty field too.
 *
 * This is a **default, not an answer**. The last observed bid is a lower bound on the hammer price
 * — the reason ADR-0021 §5/§7 originally left the field blank — so the dialog labels the figure as
 * an observation and dates it, and clearing the field leaves it cleared.
 */
export function closingPricePrefill(lot: ClosingPrefillInput): string {
  const recorded = num(lot.finalPrice);
  if (recorded !== null) return money(recorded);
  const observed = num(lot.currentBid);
  if (observed === null || observed <= 0) return "";
  return money(observed);
}

/**
 * The **derived** states a live lot can be in — what the row already shows as tint and chip, made
 * filterable.
 *
 * These are not statuses. A status is recorded by the collector and answers "how did this end"; a
 * signal is computed from the figures and answers "what should I do about it now". Both exist
 * because a watchlist of forty lots is worked through by the second question and filed by the first.
 *
 * - `bid-possible` — the ceiling still leaves room above the current price: this lot can be taken
 *   without going past what it is worth. The one that turns a list into a to-do.
 * - `outbid` — the price has passed the bid you placed.
 * - `leading` — your bid still covers it.
 * - `over-ceiling` — the current price, all-in, has passed your ceiling: it has become too
 *   expensive, whoever is winning.
 * - `won-pending` — its moment has gone by with your bid ahead and the lot is still `open`, so the
 *   figures have not been confirmed. Since the outcome is derived rather than recorded (§4), this
 *   is exactly the list of lots waiting to be closed.
 */
export type LotSignal = "bid-possible" | "outbid" | "leading" | "over-ceiling" | "won-pending";

export const LOT_SIGNALS: readonly LotSignal[] = [
  "bid-possible",
  "outbid",
  "leading",
  "over-ceiling",
  "won-pending",
];

/** One lot, as the signal rules read it. Fees are the sale's — shipping excluded, as everywhere a
 * single lot is costed. */
export interface LotSignalInput {
  status: AuctionLotStatus;
  endsAt: Date;
  currentBid?: Amount;
  myBid?: Amount;
  /** The ceiling set apart from the bid; absent follows the bid ({@link ceilingOf}, #1515). */
  maxBid?: Amount;
  fees?: AuctionFees;
}

/**
 * Whether a lot carries a signal, at the instant `now`.
 *
 * Signals only apply while a lot is `open`: once it is closed there is nothing to decide, and the
 * derived outcome says how it went. `won-pending` is the exception in appearance only — it is about
 * a lot still `open` whose moment has gone by, which is precisely the case the collector has to come
 * back and close.
 */
export function lotHasSignal(signal: LotSignal, lot: LotSignalInput, now: Date): boolean {
  if (lot.status !== "open") return false;
  const ended = lot.endsAt.getTime() <= now.getTime();
  const standing = bidStanding(lot.myBid, lot.currentBid);

  switch (signal) {
    case "won-pending":
      return ended && standing === "leading";
    case "leading":
      return !ended && standing === "leading";
    case "outbid":
      return !ended && standing === "outbid";
    case "over-ceiling": {
      if (ended) return false;
      const cost = allIn(lot.currentBid, lot.fees);
      const cap = num(ceilingOf(lot, lot.fees));
      return cost !== null && cap !== null && Number(cost) > cap;
    }
    case "bid-possible": {
      if (ended) return false;
      // Room is measured against the *hammer* price, since that is what a bid box takes: the most
      // that fits inside the ceiling has to be above both what the lot stands at and what has
      // already been placed, or there is nothing left to do here. A ceiling that follows the bid
      // (#1515) leaves no room above it by definition.
      const room = maxBidWithin(ceilingOf(lot, lot.fees), lot.fees);
      if (room === null) return false;
      const roomValue = Number(room);
      const current = num(lot.currentBid);
      const mine = num(lot.myBid);
      return (current === null || roomValue > current) && (mine === null || roomValue > mine);
    }
  }
}

// ── Composition (#353) ──────────────────────────────────────────────────────

/**
 * One composition line as the catalogue-value roll-up reads it.
 *
 * The line's value has **already been resolved** by the catalog rules that own it — the
 * unknown-variant rollup (#238) and format pricing (ADR-0020) — and converted into the sale's
 * currency. What is left here is arithmetic and bookkeeping, which is why it is pure.
 */
export interface LotLineValue {
  /** How many of this stamp × condition × format the lot holds. */
  quantity: number;
  /** Value of **one** of them, in the sale's currency. Null whenever the line contributes nothing,
   * for either of the two reasons below. */
  unitValue: number | null;
  /** No catalogue price at all for this stamp at that condition × format. A multiple with neither
   * an explicit price nor a factor lands here — never valued at the single's figure (ADR-0020). */
  unpriced: boolean;
  /** The line is unpriced because its catalogue gives no price on purpose (#1615) — not a price to
   *  go and enter, so it is not counted among the lot's unpriced lines. */
  mark: CatalogPriceMark | null;
  /** Priced, but in a currency with no rate to the sale's. It exists and cannot be counted, which
   * is a different fact from having no price, and reporting it as unpriced would send the collector
   * off to enter a value that is already there. */
  unconvertible: boolean;
  /** The figure came from the cheapest variant child of an unknown-variant umbrella (#238) — an
   * estimate, rendered with the same `~` + italics vocabulary the issue list uses. */
  uncertain: boolean;
  /** The top of the line's range when its condition is not settled (#1623) — the highest value over
   * its possible conditions, where {@link unitValue} is the lowest. Absent or equal to
   * {@link unitValue} on a settled line. */
  unitValueHigh?: number | null;
  /** The line's condition is unknown or one of several (#1623). */
  conditionUnsettled?: boolean;
  /** Possible conditions the catalogue gives no figure for — left out of the range rather than
   * emptying it, and said. Zero on a settled line. */
  unpricedConditions?: number;
}

/**
 * A catalogue valuation as `valuateItemRows` returns it, reduced to the three fields the rule below
 * actually reads. Structural rather than `CopyValuation` itself, so this module stays pure: a
 * `stamp × condition × certificate × format` valued for a copy, for a lot's composition line, or
 * for a line that exists nowhere but in the caller's question, all satisfy it.
 */
export interface CatalogueLineValuation {
  unpriced: boolean;
  /** Why it is unpriced, when the catalogue gives no price on purpose (#1615). Absent reads as none. */
  mark?: CatalogPriceMark | null;
  /** The figure in the **collection's base** currency, or null when nothing priced it. */
  baseAmount: number | null;
  uncertain: boolean;
}

/**
 * The three outcomes a catalogue-valued line can have, kept apart — **the one place that decides
 * it** (#1168).
 *
 * It is three lines of arithmetic and it is extracted for exactly one reason: it is the whole of the
 * valuation rule that sits above `valuateItemRows`, and a second copy of it is how one caller comes
 * to call a line unpriced while another calls it unconvertible. `valuateAuctionLotLines` (#353) is
 * one caller and the lot-free recommendation for a specification nobody holds (#1168) is the other,
 * and they must not be able to disagree.
 *
 * - **unpriced** — nothing in the catalogue answers this `stamp × condition × certificate × format`.
 *   A multiple with neither an explicit price nor a factor lands here rather than being valued at
 *   the single's figure (ADR-0020).
 * - **unconvertible** — there *is* a figure and no rate carries it into the target currency. It is
 *   deliberately not *unpriced*: reporting it as having no price sends the collector off to enter a
 *   value that already exists.
 * - a **figure**, `baseAmount × rate`.
 *
 * `rate` is base → the currency being answered in, exactly as `baseToSaleRates` produces it, and
 * null there means *no rate could be had* rather than zero.
 */
export function lotLineValueOf(
  quantity: number,
  valuation: CatalogueLineValuation | undefined,
  rate: number | null
): LotLineValue {
  const unpriced = !valuation || valuation.unpriced || valuation.baseAmount === null;
  const unconvertible = !unpriced && rate === null;
  return {
    quantity,
    unitValue: unpriced || unconvertible ? null : valuation!.baseAmount! * rate!,
    unpriced,
    mark: unpriced ? (valuation?.mark ?? null) : null,
    unconvertible,
    uncertain: valuation?.uncertain ?? false,
  };
}

/**
 * A certified line's catalogue figure **derived from the plain one** (#1636), for a certificate the
 * catalogue gives no price of its own — `None × 120%`. See {@link deriveCertifiedValue}.
 */
export interface CertificateDerivation {
  /** The status's percentage of the plain price (#1242); null when it has none, and then nothing is
   *  derived — never an assumed 100%. */
  percent: number | null;
  /** The figure with **no** certificate, for one, in the line's currency — what is multiplied. Null
   *  when that figure has no rate into the line's currency. */
  plainUnitValue: number | null;
  /** `plainUnitValue × percent`, for one; null when either half is missing. */
  unitValue: number | null;
  /** The plain figure exists and no rate carries it into the line's currency. */
  unconvertible: boolean;
}

/**
 * What a certified line is worth when its certificate has **no price of its own** (#1636): the price
 * without a certificate × the status's percentage — the percentage *Fill from None* copies with
 * (#1242), here applied on the spot and never written anywhere. Null when there is nothing to derive.
 *
 * - **A recorded figure wins.** A line priced at its certificate — even one with no rate — is
 *   answered by that, and a cell the catalogue marks (#1615) is the catalogue's own answer at that
 *   certificate, which the fill leaves alone too.
 * - **Only that way round**: `plain` is the line at no certificate, and nothing here divides a
 *   certified price back into a plain one.
 * - **No plain figure, nothing derived** — and nothing said about it either, since the percentage is
 *   then not the reason the line is unpriced.
 * - **A status with no percentage derives nothing**, and says so: the derivation comes back with
 *   `percent: null` and no figure.
 *
 * Read only by the bid anchor (`auction-lot-anchors.ts`). The composition's own catalogue value stays
 * exact, so a lot's catalogue column never shows a figure no catalogue printed.
 */
export function deriveCertifiedValue(
  own: Pick<LotLineValue, "unpriced" | "mark">,
  plain: Pick<LotLineValue, "unitValue" | "unpriced" | "unconvertible">,
  percent: number | null
): CertificateDerivation | null {
  if (!own.unpriced || own.mark) return null;
  if (plain.unpriced) return null;
  const plainUnitValue = plain.unconvertible ? null : plain.unitValue;
  return {
    percent,
    plainUnitValue,
    unitValue: percent === null || plainUnitValue === null ? null : (plainUnitValue * percent) / 100,
    unconvertible: plain.unconvertible,
  };
}

/**
 * The same three outcomes for a line whose condition is **not settled** (#1623): valued at each of
 * its possible conditions, and stated as a range from the lowest figure to the highest.
 *
 * `valuations` holds one entry per possible condition — exactly one for a settled line, which then
 * reads exactly as {@link lotLineValueOf} does.
 *
 * A possible condition the catalogue gives no figure for is **left out of the range and counted**
 * (`unpricedConditions`) rather than emptying it: an unknown condition is any of the collection's,
 * and almost every stamp has one the catalogue does not price, so the stricter rule would leave
 * nearly every such line unvalued. Only when none of them is priced is the line unpriced — and
 * marked (#1615) only when every one of them is. Unconvertible is the same fact for every condition,
 * the rate being the sale's.
 */
export function lotLineRangeOf(
  quantity: number,
  valuations: (CatalogueLineValuation | undefined)[],
  rate: number | null,
  unsettled: boolean
): LotLineValue {
  const each = valuations.map((valuation) => lotLineValueOf(quantity, valuation, rate));
  if (!unsettled && each.length === 1) return each[0];
  const unpricedConditions = unsettled ? each.filter((value) => value.unpriced).length : 0;
  const priced = each.filter(
    (value): value is LotLineValue & { unitValue: number } => value.unitValue !== null
  );
  if (priced.length === 0) {
    const unconvertible = each.some((value) => value.unconvertible);
    const marks = each.map((value) => value.mark);
    return {
      quantity,
      unitValue: null,
      unitValueHigh: null,
      unpriced: !unconvertible,
      mark: !unconvertible && marks.length > 0 && marks.every((mark) => mark !== null) ? marks[0] : null,
      unconvertible,
      uncertain: each.some((value) => value.uncertain),
      conditionUnsettled: unsettled,
      unpricedConditions,
    };
  }
  const figures = priced.map((value) => value.unitValue);
  return {
    quantity,
    unitValue: Math.min(...figures),
    unitValueHigh: Math.max(...figures),
    unpriced: false,
    mark: null,
    unconvertible: false,
    uncertain: priced.some((value) => value.uncertain),
    conditionUnsettled: unsettled,
    unpricedConditions,
  };
}

/**
 * Does this lot still need saying what it holds (#442)?
 *
 * Zero lines is the normal state while a lot is merely being watched, so this is not an error — it
 * is the work left, and the flag exists because catalogue value, headroom and everything bid
 * against them follow from the composition and stay blank without it.
 *
 * **Every lot but a cancelled one.** A cancelled lot is not coming back and describing it buys
 * nothing, so flagging it would be pure noise on the historical rows. A *lost* one is flagged
 * deliberately, though it may look equally over: what it held, at what it went for, is a price
 * record — which is most of why the composition is worth entering before the hammer falls. An
 * `observed` lot is the same argument at full strength, since recording the price is the only
 * reason that lot exists at all.
 */
export function lotNeedsComposition(lot: {
  status: AuctionLotStatus;
  lineCount: number;
  notStamps: boolean;
}): boolean {
  // A lot marked *not stamps* (#1624) — a catalogue, literature, an accessory — holds nothing a line
  // could describe, so its empty composition is the whole answer rather than work left.
  return lot.lineCount === 0 && lot.status !== "cancelled" && !lot.notStamps;
}

/** What a lot's composition is worth, and how much of it could be answered. */
export interface LotCompositionValue {
  /** Lines entered. Zero is the normal state while bidding. */
  lineCount: number;
  /** Stamps described, counting quantities — what the lot actually holds. */
  quantity: number;
  /**
   * Sum of `unitValue × quantity` over the lines that carry one, in the sale's currency.
   *
   * **Null when no line carries a value**, rather than `0.00`: a lot whose composition is entered
   * but unpriced is not worth nothing, it is unanswered, and a zero would make every headroom read
   * as a catastrophic overbid.
   */
  catalogValue: string | null;
  /** Lines with no catalogue price. Reported rather than hidden, exactly as the sale summary
   * reports its unvalued lots — a total that silently omits half the lot looks complete. A line
   * whose catalogue gives no price on purpose (#1615) is counted in {@link markedLines} instead. */
  unpricedLines: number;
  /** Lines left out because their catalogue gives no price — *does not exist* or *not determinable*. */
  markedLines: number;
  /** Lines priced in a currency that cannot be expressed in the sale's. */
  unconvertibleLines: number;
  /** Whether any line contributing to the total is a lowest-variant estimate. */
  uncertain: boolean;
  /**
   * The top of the range when a line's condition is not settled (#1623) — the sum of each line's
   * highest figure, where {@link catalogValue} sums the lowest. **Null when the value is one figure**,
   * which is every lot whose lines are settled and any lot whose possible conditions happen to be
   * priced alike; everything compared or summed reads {@link catalogValue}, the cautious end.
   */
  catalogValueHigh: string | null;
  /** Lines whose condition is unknown or one of several — the lot is *condition to settle*. */
  unsettledLines: number;
}

/**
 * Roll a lot's composition up into one catalogue value.
 *
 * Quantity multiplies and nothing else does: a multiple is **never decomposed** (ADR-0020), so a
 * line for a block of four at quantity 2 is two blocks' worth of the block's own price, not eight
 * singles.
 */
export function summarizeLotComposition(lines: LotLineValue[]): LotCompositionValue {
  let quantity = 0;
  let total = 0;
  let valued = 0;
  let unpricedLines = 0;
  let markedLines = 0;
  let unconvertibleLines = 0;
  let uncertain = false;
  let totalHigh = 0;
  let unsettledLines = 0;

  for (const line of lines) {
    const count = Number.isFinite(line.quantity) ? Math.max(0, Math.trunc(line.quantity)) : 0;
    quantity += count;
    if (line.conditionUnsettled) unsettledLines++;
    if (line.unpriced && line.mark) markedLines++;
    else if (line.unpriced) unpricedLines++;
    if (line.unconvertible) unconvertibleLines++;
    if (line.unitValue === null) continue;
    valued++;
    total += line.unitValue * count;
    totalHigh += (line.unitValueHigh ?? line.unitValue) * count;
    if (line.uncertain) uncertain = true;
  }

  const catalogValue = valued > 0 ? money(total) : null;
  const high = valued > 0 ? money(totalHigh) : null;
  return {
    lineCount: lines.length,
    quantity,
    catalogValue,
    unpricedLines,
    markedLines,
    unconvertibleLines,
    uncertain,
    catalogValueHigh: high !== null && high !== catalogValue ? high : null,
    unsettledLines,
  };
}

/** One lot as the aggregation reads it. Carries what {@link lotOutcome} needs rather than an
 * outcome, so the sale's totals and the row's chip can never disagree about how a lot went. */
export interface AuctionLotSummaryRow {
  status: AuctionLotStatus;
  /** The collector's own maximum — absent means they never bid, which is what makes the lot an
   * observation rather than a loss. */
  myBid?: Amount;
  /** Tie-break at equal figures; see {@link lotOutcome}. */
  wonTie?: boolean | null;
  /** The live bid while the lot is open. */
  currentBid?: Amount;
  /** The collector's ceiling **set apart** from the bid — an **all-in** valuation (ADR-0021 §6), not
   * a hammer price. Absent means it follows the bid (#1515); {@link ceilingOf} reads either. Read by
   * {@link AuctionSaleSummary.ceilingTotal}, and against `currentBid` by {@link isOutpriced}. */
  maxBid?: Amount;
  /** What the lot fetched once it closed. Preferred over `currentBid` when present: it is the
   * settled figure, and the last observed bid is only ever an approximation of it. */
  finalPrice?: Amount;
  /** Catalogue value of the lot's composition, when its lines have been entered — the **low** end
   * when a line's condition is not settled (#1623). */
  catalogValue?: Amount;
  /** The lot is *not stamps* (#1624): it has no catalogue value to miss, so it is never counted in
   * {@link AuctionSaleSummary.unvaluedCount}. */
  notStamps?: boolean;
  /** The top of that range, when there is one. Summed beside the total, never into it. */
  catalogValueHigh?: Amount;
}

/** Sale-level totals over the lots that cost money. */
export interface AuctionSaleSummary {
  /** Every lot handed in, whatever became of it. */
  lotCount: number;
  /** Lots by **derived outcome**, so a caller need not re-walk the list to label the sale. */
  pendingCount: number;
  wonCount: number;
  lostCount: number;
  observedCount: number;
  cancelledCount: number;
  /** Lots counted into the totals below: `pending` and `won`. Nothing else is something the
   * collector pays for, so it can only distort what the parcel will cost. An `observed` lot is
   * excluded for the plainest reason of all — no bid was ever placed on it. */
  payableCount: number;
  /** Payable lots with no bid recorded yet — they contribute nothing, and a total that silently
   * omits them would otherwise look complete. */
  unbidCount: number;
  /** Payable lots whose composition has no catalogue value, for the same reason. A lot marked *not
   * stamps* (#1624) is not one of them: it has no catalogue value by nature, not for want of a line. */
  unvaluedCount: number;
  /** Sum of the payable lots' bids, before any fees. */
  bidTotal: string;
  /** {@link bidTotal} plus the premium on every payable lot, plus shipping **once**. A parcel ships
   * once however many lots are in it — that is the whole point of a sale being one settlement with
   * one seller. Shipping is only added when something is actually payable. */
  allInTotal: string;
  /**
   * **What is already owed if everything goes against the collector** (#523) — the budget figure a
   * watchlist is actually worked against.
   *
   * A `pending` lot is costed at `allIn(myBid)` and **not** at what it stands at: `myBid` is a proxy
   * maximum lodged with the platform, so it is the most that lot can take, while `currentBid` is an
   * observation that says nothing about the collector's exposure. A `won` lot is costed at its
   * `finalPrice`, which is no longer worst-case but settled. Shipping once, as everywhere.
   *
   * A lot with no bid placed contributes **nothing**: nothing has been committed to it. That is the
   * whole difference between this figure and {@link ceilingTotal}, and it is why the two are worth
   * having side by side — this one is what has already been risked.
   */
  committedTotal: string;
  /**
   * The same total if every open lot were bid up to its **ceiling** (#523) — what carrying the
   * watchlist through to the end would cost.
   *
   * A `pending` lot is costed at `max(maxBid, allIn(myBid))`. The ceiling is taken **as it stands**,
   * because it is an all-in valuation already (ADR-0021 §6) — running {@link allIn} over it would
   * charge the premium and the shipping a second time. The `max` is what keeps the figure honest
   * when a bid was placed past the ceiling: that bid is money at risk whatever the valuation says,
   * and the row already flags it as `myBidOverCeiling`.
   */
  ceilingTotal: string;
  /** Payable lots carrying neither a bid nor a ceiling — they contribute to neither total, so like
   * {@link unbidCount} the screens say so rather than presenting a figure that looks complete. */
  uncappedCount: number;
  /** Open lots left out of the two exposure totals by {@link isOutpriced} (#600) — the price has
   * run past the ceiling and past the collector's bid, so nothing can come of them until the
   * ceiling is raised. Counted for the same reason every other gap here is: the totals are lower
   * than the lot list is long, and a figure that quietly omits rows reads as complete. */
  outpricedCount: number;
  /** Catalogue value across the payable lots — each at the **low** end of its range when a line's
   * condition is not settled (#1623), the cautious figure the headroom below is taken against. */
  catalogTotal: string;
  /** The same total at the top of every range; null when no payable lot has one. */
  catalogTotalHigh: string | null;
  /** Payable lots whose catalogue value is a range — the screens say the total is their low end. */
  rangeLotCount: number;
  /** `catalogTotal − allInTotal`. Null when nothing in the parcel carries both a bid and a
   * catalogue value, since the comparison would then be between two different sets of lots. */
  headroom: string | null;
}

/** Whether a lot is one the collector would pay for. */
function isPayable(outcome: AuctionLotOutcome): boolean {
  return outcome === "pending" || outcome === "won";
}

/** The figure a lot is costed at: the settled price when it closed, else the last observed bid. */
function lotBid(lot: AuctionLotSummaryRow): number | null {
  return num(lot.finalPrice) ?? num(lot.currentBid);
}

/**
 * Whether an open lot has run **out of the collector's reach at the ceiling they recorded** (#600),
 * and so is worth nothing to the exposure totals.
 *
 * Two conditions, and the figure is wrong without either.
 *
 * The price has to be past the ceiling **all-in**, not raw: a ceiling is an all-in valuation
 * (ADR-0021 §6) while `currentBid` is a hammer price, so the bare `currentBid > maxBid` comparison
 * keeps counting a lot for as long as the premium alone is what carries it over — the very lot the
 * row is already chipping as `over-ceiling`. This is deliberately the same comparison
 * {@link lotHasSignal} makes for that signal, so the chip and the total cannot disagree.
 *
 * And the collector has to be **behind**. A bid placed above the ceiling still wins the lot at what
 * was placed — that is the `myBidOverCeiling` case {@link AuctionSaleSummary.ceilingTotal} exists to
 * keep honest — so money is genuinely on the hook there whatever the valuation says. What cannot
 * happen is winning a lot whose price has passed both the ceiling *and* the bid: that needs a new,
 * higher bid first, which is a decision the collector has not made yet.
 *
 * The morning auction reminder (#1373) leaves the same lots out of its list, by this same rule, so
 * the email and the exposure totals cannot disagree about which lots are still in reach.
 */
export function isOutpriced(
  lot: Pick<AuctionLotSummaryRow, "myBid" | "currentBid" | "maxBid">,
  fees: AuctionFees
): boolean {
  if (bidStanding(lot.myBid, lot.currentBid) === "leading") return false;
  const cost = allIn(lot.currentBid, fees);
  // The ceiling as it is held (#1515): one set apart, else the bid's own all-in — so a lot whose
  // ceiling follows its bid is out of reach exactly when it is outbid.
  const cap = num(ceilingOf(lot, fees));
  return cost !== null && cap !== null && Number(cost) > cap;
}

/**
 * Roll a sale's lots up into what the parcel costs and what it is worth.
 *
 * `fees.shippingCost` is the sale's, added once; the per-lot premium components are applied to
 * every payable lot, which is how a house charging a fixed fee per lot actually bills.
 */
export function summarizeAuctionSale(
  lots: AuctionLotSummaryRow[],
  fees: AuctionFees = {}
): AuctionSaleSummary {
  let pendingCount = 0;
  let wonCount = 0;
  let lostCount = 0;
  let observedCount = 0;
  let cancelledCount = 0;
  let payableCount = 0;
  let unbidCount = 0;
  let unvaluedCount = 0;
  let bidTotal = 0;
  let allInTotal = 0;
  let committedTotal = 0;
  let ceilingTotal = 0;
  let uncappedCount = 0;
  let outpricedCount = 0;
  let catalogTotal = 0;
  let catalogTotalHigh = 0;
  let rangeLotCount = 0;
  // Headroom compares like with like: only lots carrying both a bid and a catalogue value.
  let comparableCount = 0;
  // Every per-lot figure carries the premium and not the shipping; the parcel's shipping is added
  // once at the end.
  const perLotFees: AuctionFees = {
    premiumPercent: fees.premiumPercent,
    premiumFixed: fees.premiumFixed,
  };

  for (const lot of lots) {
    const outcome = lotOutcome(lot);
    if (outcome === "pending") pendingCount++;
    else if (outcome === "won") wonCount++;
    else if (outcome === "lost") lostCount++;
    else if (outcome === "observed") observedCount++;
    else cancelledCount++;

    if (!isPayable(outcome)) continue;
    payableCount++;

    const bid = lotBid(lot);
    const cv = num(lot.catalogValue);
    if (bid === null) unbidCount++;
    if (cv === null && !lot.notStamps) unvaluedCount++;
    if (bid !== null && cv !== null) comparableCount++;

    if (bid !== null) {
      bidTotal += bid;
      // Shipping is deliberately excluded here and added once below.
      allInTotal += allInValue(bid, perLotFees);
    }
    if (cv !== null) {
      catalogTotal += cv;
      const high = num(lot.catalogValueHigh);
      if (high !== null) rangeLotCount++;
      catalogTotalHigh += high ?? cv;
    }

    // Exposure (#523). A won lot is settled money — what it fetched, all-in — and its ceiling has
    // nothing left to say about it, so it enters both totals at the same figure.
    if (outcome === "won") {
      const won = num(lot.finalPrice);
      if (won !== null) {
        const cost = allInValue(won, perLotFees);
        committedTotal += cost;
        ceilingTotal += cost;
      }
      continue;
    }

    // An open lot the price has already left behind (#600) costs nothing either way: it can only be
    // won by raising the ceiling, and until that happens neither figure has anything to say about
    // it. It stays payable and stays on the list — this is a total it drops out of, not a lot.
    if (isOutpriced(lot, perLotFees)) {
      outpricedCount++;
      continue;
    }

    // An open lot: costed at the proxy maximum lodged with the platform, never at what it stands
    // at. The ceiling enters `ceilingTotal` as it stands — it is an all-in valuation already.
    const placed = num(lot.myBid);
    const placedCost = placed === null ? null : allInValue(placed, perLotFees);
    // The ceiling as it is held (#1515) — set apart, else following the bid, when it can only
    // equal `placedCost` and the `max` below changes nothing.
    const ceiling = num(ceilingOf(lot, perLotFees));
    if (placedCost !== null) committedTotal += placedCost;
    if (placedCost === null && ceiling === null) uncappedCount++;
    else ceilingTotal += Math.max(placedCost ?? 0, ceiling ?? 0);
  }

  // Shipping once, on the same condition and for the same reason as `allInTotal`: a parcel ships
  // once however many lots are in it.
  if (payableCount > 0) {
    const shipping = fee(fees.shippingCost);
    allInTotal += shipping;
    committedTotal += shipping;
    ceilingTotal += shipping;
  }

  return {
    lotCount: lots.length,
    pendingCount,
    wonCount,
    lostCount,
    observedCount,
    cancelledCount,
    payableCount,
    unbidCount,
    unvaluedCount,
    bidTotal: money(bidTotal),
    allInTotal: money(allInTotal),
    committedTotal: money(committedTotal),
    ceilingTotal: money(ceilingTotal),
    uncappedCount,
    outpricedCount,
    catalogTotal: money(catalogTotal),
    catalogTotalHigh: rangeLotCount > 0 ? money(catalogTotalHigh) : null,
    rangeLotCount,
    headroom: comparableCount > 0 ? money(catalogTotal - allInTotal) : null,
  };
}
