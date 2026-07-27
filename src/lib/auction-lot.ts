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

/** A lot's outcome. `watching` is still running; the other three are terminal. */
export type AuctionLotStatus = "watching" | "won" | "lost" | "cancelled";

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
