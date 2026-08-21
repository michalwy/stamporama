import { apportionMoney } from "./purchase-allocation";
import { resolveCostBasis, type CostBasisInput } from "./cost-basis";
import {
  isCommittingFulfillment,
  isRealisedFulfillment,
  readTradeFulfillment,
} from "./trade-realisation-rules";
import { nameFew } from "./trade-rules";

// **What closing a trade does to the books** (#644; ADR-0039 §12) — the pure half, with no database,
// no React and no `server-only`, beside `trade-intake.ts` exactly as `trade-realisation-rules.ts`
// sits beside `trade-realisation.ts`.
//
// The decision everything here follows from is **carry-over, not fair value**. Treating an exchange
// as a purchase *and* a sale at the agreed figure balances in cash — X in, X out — but not in the
// result: copies whose cost basis is 30 "sold" for 300 book 270 of profit that never reached an
// account, the incoming material then enters at 300, and its eventual real sale at 200 books a loss
// of 100 despite a total gain of 170. The result would be invented in both directions and displaced
// in time, and #168 would read it literally at exactly the moment it matters.
//
// So: the outgoing copies leave **at their cost basis**, and the sum of those becomes the cost pool
// of the incoming material. No revenue, no profit, no cash. Value changes form — the same money now
// sits in different stamps — and the profit appears, truthfully, on a real sale later. This is also
// the standard treatment of a non-monetary exchange: at carrying amount, no gain recognised.
//
// Two levels of one pro-rata rule, both reconciling to the cent through `apportionMoney`:
//
//   1. the pool is split across the **receive lines** by their frozen own valuation × quantity —
//      one `PurchaseLot` per line, which is what gives the intake apparatus a line to bind a tile to;
//   2. each lot is then split across the copies identified into it by catalogue price, which is the
//      split `PurchaseLot` has always performed (ADR-0009 §3).
//
// The only real cash in the whole operation is postage, and it has a home already: `shippingCost` on
// the purchase, distributed over the incoming copies by the engine that distributes every other
// shared cost. Nothing here invents it.

/** One give line as the carry-over reads it: what became of it, and what the copy cost. */
export interface GivenCopy extends CostBasisInput {
  itemId: string;
  /** The stored verdict, unparsed — this module reads it through the one judgement that decides it. */
  fulfillment: string;
}

/**
 * What the outgoing side is worth, at cost.
 *
 * **Everything that left counts**, which is `isCommittingFulfillment` — every verdict but
 * `withdrawn`. A withdrawn line's copy never went in the envelope and is back on the shelf (#642),
 * so it has nothing to carry; a `missing` one's went and was lost in the post, and dropping its
 * basis would make value evaporate from the books with no loss recorded anywhere. Carrying it is the
 * only treatment under which the books still add up.
 *
 * A copy with **no** cost basis at all (added by hand, or from a channel that recorded no cost)
 * contributes nothing and blocks nothing: there is genuinely no cost to carry. A copy whose lot is
 * still **open** is different in kind — its share exists and is simply not final yet — so it is
 * counted apart, and it is what holds the incoming lot open (see {@link isCarryOverSettled}).
 */
export interface CarryOverPool {
  /** Base-currency total of the frozen cost bases, 2 dp. */
  total: number;
  /** Copies whose basis is frozen and in the total. */
  knownCount: number;
  /** Copies still on an open purchase lot — the total is provisional while any of these stand. */
  pendingItemIds: string[];
  /** Copies with no cost recorded at all. Counted so the screen can say so, never a blocker. */
  noneCount: number;
}

export const EMPTY_CARRY_OVER_POOL: CarryOverPool = {
  total: 0,
  knownCount: 0,
  pendingItemIds: [],
  noneCount: 0,
};

export function carryOverPool(given: readonly GivenCopy[]): CarryOverPool {
  const pool: CarryOverPool = { ...EMPTY_CARRY_OVER_POOL, pendingItemIds: [] };
  let cents = 0;
  for (const copy of given) {
    if (!isCommittingFulfillment(readTradeFulfillment(copy.fulfillment))) continue;
    const resolved = resolveCostBasis(copy);
    if (resolved.state === "known") {
      pool.knownCount += 1;
      cents += Math.round(Number(resolved.amount) * 100);
    } else if (resolved.state === "pending") {
      pool.pendingItemIds.push(copy.itemId);
    } else {
      pool.noneCount += 1;
    }
  }
  pool.total = cents / 100;
  return pool;
}

/** Whether the pool is final — nothing it is made of is still waiting on a lot of its own. */
export function isCarryOverSettled(pool: CarryOverPool): boolean {
  return pool.pendingItemIds.length === 0;
}

/** One receive line as the split reads it: what it is worth per piece and how many pieces. */
export interface IncomingLine {
  lineId: string;
  /** The stored verdict, unparsed. */
  fulfillment: string;
  /** The frozen **own** valuation per piece, base currency, or null where the line carries none. */
  ownValue: number | null;
  quantity: number;
}

/** What one receive line's lot is priced at. */
export interface IncomingLineShare {
  lineId: string;
  /** Base-currency lot price, 2 dp. Sums exactly to the pool across the lines. */
  price: number;
}

/**
 * Which receive lines brought material at all.
 *
 * `isRealisedFulfillment`, the same judgement the realised balance is summed on: a line the partner
 * withdrew or one that never arrived brought nothing, so it has no lot to hold. (`pending` cannot
 * occur here — `closed` refuses while any line has no verdict — but it counts as realised for that
 * function's own reason and needs no exception.)
 */
export function arrivedLines(lines: readonly IncomingLine[]): IncomingLine[] {
  return lines.filter((line) => isRealisedFulfillment(readTradeFulfillment(line.fulfillment)));
}

/**
 * Split the pool across the lines that brought material, pro-rata by own value × quantity.
 *
 * **It never refuses.** The exchange happened, and a trade that could not be closed because the
 * arithmetic had nothing to weigh by would be the app arguing with the parcel on the desk. So the
 * weights fall back in order: the frozen own valuation, then the piece count, then one share each.
 * Both fallbacks are reached only where every line is worth nothing on record, which the valuation
 * gate makes rare and does not make impossible (a catalogue that prices a stamp at zero, or a figure
 * whose rate could not be had).
 */
export function splitCarryOverPool(
  total: number,
  lines: readonly IncomingLine[]
): IncomingLineShare[] {
  const arrived = arrivedLines(lines);
  if (arrived.length === 0) return [];

  const byValue = arrived.map((l) => Math.max(0, l.ownValue ?? 0) * Math.max(0, l.quantity));
  const byPieces = arrived.map((l) => Math.max(0, l.quantity));
  const positive = (weights: number[]) => weights.some((w) => w > 0);
  const weights = positive(byValue)
    ? byValue
    : positive(byPieces)
      ? byPieces
      : arrived.map(() => 1);

  const shares = apportionMoney(total, weights);
  return arrived.map((line, i) => ({ lineId: line.lineId, price: shares[i] }));
}

/**
 * What a receive line promised against what actually turned up (#642, shipped here).
 *
 * The line says what was agreed and the copy created from the scan tile says what came, so a
 * substitution is nothing more than the two disagreeing — **derived, never stored**. A second column
 * saying it would be a second version of the truth, and the one that goes stale the first time a
 * copy is reassigned to another variant (#656).
 */
export interface SubstitutedArrival {
  lineId: string;
  itemId: string;
  promisedStampId: string;
  arrivedStampId: string;
}

/** One copy on a trade's lot, as the substitution read sees it. */
export interface ArrivedCopy {
  lineId: string;
  itemId: string;
  /** The stamp the line promised. */
  promisedStampId: string | null;
  /** The stamp the copy turned out to be. */
  arrivedStampId: string;
}

export function findSubstitutions(copies: readonly ArrivedCopy[]): SubstitutedArrival[] {
  const out: SubstitutedArrival[] = [];
  for (const copy of copies) {
    if (!copy.promisedStampId) continue;
    if (copy.promisedStampId === copy.arrivedStampId) continue;
    out.push({
      lineId: copy.lineId,
      itemId: copy.itemId,
      promisedStampId: copy.promisedStampId,
      arrivedStampId: copy.arrivedStampId,
    });
  }
  return out;
}

/**
 * Why this trade's lot may not be closed yet, or null.
 *
 * A lot closes at the moment its pool is distributed, and this pool is the cost basis of copies that
 * may themselves still be waiting on a lot of their own — a large auction lot is intaken over weeks,
 * and its copies are tradeable long before it closes. So the trigger changes and nothing else does:
 * the lot stays `open` while any source copy is `pending`, exactly as `resolveCostBasis` already has
 * it, and the incoming copies report `pending` of their own accord meanwhile.
 *
 * Refused **by name**, like every other refusal in this part of the app: a collector told *waiting on
 * order #123* knows where to go, where a bare "cannot close" sends them hunting. Chains resolve
 * themselves — traded material can be traded on, and a copy that has been given away cannot be given
 * away again, so the dependencies always point into the past.
 */
export function tradeLotPendingMessage(purchaseLabels: readonly string[]): string | null {
  if (purchaseLabels.length === 0) return null;
  const one = purchaseLabels.length === 1;
  return `${
    one ? "A copy" : "Some of the copies"
  } that went the other way ${one ? "is" : "are"} still waiting on ${
    one ? "an order" : "orders"
  } of ${one ? "its" : "their"} own: ${nameFew([...purchaseLabels])}. Close ${
    one ? "that lot" : "those lots"
  } first — what this material cost is what the copies that left cost.`;
}

/** The same fact for a copy that came from no order at all, which blocks nothing. Null when there
 *  are none: a reassurance drawn on every trade is a line a collector stops reading. */
export function tradeUnrecordedCostNote(pool: CarryOverPool): string | null {
  if (pool.noneCount === 0) return null;
  const one = pool.noneCount === 1;
  return `${
    one ? "One of the copies" : `${pool.noneCount} of the copies`
  } that went the other way ${one ? "has" : "have"} no purchase cost recorded, so ${
    one ? "it carries" : "they carry"
  } nothing into this pool.`;
}
