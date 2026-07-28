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

/** A lot's outcome. `watching` is still running; the other three are terminal. */
export type AuctionLotStatus = "watching" | "won" | "lost" | "cancelled";

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
 * - `won-pending` — it closed with your bid ahead, and the outcome has not been recorded yet.
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
  maxBid?: Amount;
  fees?: AuctionFees;
}

/**
 * Whether a lot carries a signal, at the instant `now`.
 *
 * Signals only apply while a lot is `watching`: once an outcome is recorded there is nothing to
 * decide, and the status says it plainly. `won-pending` is the exception in appearance only — it is
 * about a lot still marked `watching` whose moment has gone by, which is precisely the case the
 * collector has to come back and close.
 */
export function lotHasSignal(signal: LotSignal, lot: LotSignalInput, now: Date): boolean {
  if (lot.status !== "watching") return false;
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
      const cap = num(lot.maxBid);
      return cost !== null && cap !== null && Number(cost) > cap;
    }
    case "bid-possible": {
      if (ended) return false;
      // Room is measured against the *hammer* price, since that is what a bid box takes: the most
      // that fits inside the ceiling has to be above both what the lot stands at and what has
      // already been placed, or there is nothing left to do here.
      const room = maxBidWithin(lot.maxBid, lot.fees);
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
  /** Priced, but in a currency with no rate to the sale's. It exists and cannot be counted, which
   * is a different fact from having no price, and reporting it as unpriced would send the collector
   * off to enter a value that is already there. */
  unconvertible: boolean;
  /** The figure came from the cheapest variant child of an unknown-variant umbrella (#238) — an
   * estimate, rendered with the same `~` + italics vocabulary the issue list uses. */
  uncertain: boolean;
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
   * reports its unvalued lots — a total that silently omits half the lot looks complete. */
  unpricedLines: number;
  /** Lines priced in a currency that cannot be expressed in the sale's. */
  unconvertibleLines: number;
  /** Whether any line contributing to the total is a lowest-variant estimate. */
  uncertain: boolean;
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
  let unconvertibleLines = 0;
  let uncertain = false;

  for (const line of lines) {
    const count = Number.isFinite(line.quantity) ? Math.max(0, Math.trunc(line.quantity)) : 0;
    quantity += count;
    if (line.unpriced) unpricedLines++;
    if (line.unconvertible) unconvertibleLines++;
    if (line.unitValue === null) continue;
    valued++;
    total += line.unitValue * count;
    if (line.uncertain) uncertain = true;
  }

  return {
    lineCount: lines.length,
    quantity,
    catalogValue: valued > 0 ? money(total) : null,
    unpricedLines,
    unconvertibleLines,
    uncertain,
  };
}

/** One lot as the aggregation reads it. */
export interface AuctionLotSummaryRow {
  status: AuctionLotStatus;
  /** The live bid while watching. */
  currentBid?: Amount;
  /** What the lot fetched once it closed. Preferred over `currentBid` when present: it is the
   * settled figure, and the last observed bid is only ever an approximation of it. */
  finalPrice?: Amount;
  /** Catalogue value of the lot's composition, when its lines have been entered. */
  catalogValue?: Amount;
}

/** Sale-level totals over the lots that cost money. */
export interface AuctionSaleSummary {
  /** Every lot handed in, whatever its status. */
  lotCount: number;
  /** Lots by status, so a caller need not re-walk the list to label the sale. */
  watchingCount: number;
  wonCount: number;
  lostCount: number;
  cancelledCount: number;
  /** Lots counted into the totals below: `watching` and `won`. A lost or cancelled lot is not
   * something the collector pays for, so it can only distort what the parcel will cost. */
  payableCount: number;
  /** Payable lots with no bid recorded yet — they contribute nothing, and a total that silently
   * omits them would otherwise look complete. */
  unbidCount: number;
  /** Payable lots whose composition has no catalogue value, for the same reason. */
  unvaluedCount: number;
  /** Sum of the payable lots' bids, before any fees. */
  bidTotal: string;
  /** {@link bidTotal} plus the premium on every payable lot, plus shipping **once**. A parcel ships
   * once however many lots are in it — that is the whole point of a sale being one settlement with
   * one seller. Shipping is only added when something is actually payable. */
  allInTotal: string;
  /** Catalogue value across the payable lots. */
  catalogTotal: string;
  /** `catalogTotal − allInTotal`. Null when nothing in the parcel carries both a bid and a
   * catalogue value, since the comparison would then be between two different sets of lots. */
  headroom: string | null;
}

/** Whether a lot is one the collector would pay for. */
function isPayable(status: AuctionLotStatus): boolean {
  return status === "watching" || status === "won";
}

/** The figure a lot is costed at: the settled price when it closed, else the last observed bid. */
function lotBid(lot: AuctionLotSummaryRow): number | null {
  return num(lot.finalPrice) ?? num(lot.currentBid);
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
  let watchingCount = 0;
  let wonCount = 0;
  let lostCount = 0;
  let cancelledCount = 0;
  let payableCount = 0;
  let unbidCount = 0;
  let unvaluedCount = 0;
  let bidTotal = 0;
  let allInTotal = 0;
  let catalogTotal = 0;
  // Headroom compares like with like: only lots carrying both a bid and a catalogue value.
  let comparableCount = 0;

  for (const lot of lots) {
    if (lot.status === "watching") watchingCount++;
    else if (lot.status === "won") wonCount++;
    else if (lot.status === "lost") lostCount++;
    else cancelledCount++;

    if (!isPayable(lot.status)) continue;
    payableCount++;

    const bid = lotBid(lot);
    const cv = num(lot.catalogValue);
    if (bid === null) unbidCount++;
    if (cv === null) unvaluedCount++;
    if (bid !== null && cv !== null) comparableCount++;

    if (bid !== null) {
      bidTotal += bid;
      // Shipping is deliberately excluded here and added once below.
      allInTotal += allInValue(bid, {
        premiumPercent: fees.premiumPercent,
        premiumFixed: fees.premiumFixed,
      });
    }
    if (cv !== null) catalogTotal += cv;
  }

  if (payableCount > 0) allInTotal += fee(fees.shippingCost);

  return {
    lotCount: lots.length,
    watchingCount,
    wonCount,
    lostCount,
    cancelledCount,
    payableCount,
    unbidCount,
    unvaluedCount,
    bidTotal: money(bidTotal),
    allInTotal: money(allInTotal),
    catalogTotal: money(catalogTotal),
    headroom: comparableCount > 0 ? money(catalogTotal - allInTotal) : null,
  };
}
