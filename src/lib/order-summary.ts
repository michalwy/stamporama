import { compareSetItems, type SetItemOrderRow } from "./offer-set-order";
import { packingSetOrder } from "./packing-list";

// The buyer's order summary (#2512): a sale's sets and what they came to, printed for the buyer.
// Pure (no React / Prisma) so the printout's arithmetic and order are unit-testable; the page reads
// the sale and hands the pieces in.
//
// It is **not** the packing list: nothing on it belongs to the collector — no location, tick box,
// ref, copy number, packed count, cost or profit. What the two share is how a set is named and the
// descriptive columns of a copy row, which is why the rows still come from `buildPackingList`.

/** A sold set as the summary orders it: the sale line, its offer, and whether it is the free extras. */
export interface OrderSummaryLineOrder {
  id: string;
  offerId: string | null;
  freeExtra: boolean;
}

/**
 * Where each set prints: the packing list's set order (#2187) — the sale's line order, an offer's sets
 * kept together — with the free extras (#2408) after every set the buyer bought, since they are not
 * part of what was ordered.
 */
export function orderSummarySetOrder(lines: readonly OrderSummaryLineOrder[]): Map<string, number> {
  const bought = packingSetOrder(lines.filter((l) => !l.freeExtra));
  const free = lines.filter((l) => l.freeExtra);
  const positions = new Map(bought);
  free.forEach((l, i) => positions.set(l.id, bought.size + i));
  return positions;
}

/**
 * A sold set's copies in the set's own order — the order of the offer's set (#306): the collector's
 * hand order where there is one, else catalogue order — rather than the shelf order the packing list
 * walks. A copy the map does not know trails, in the order it came.
 */
export function sortCopiesInSetOrder<T extends { id: string }>(
  copies: readonly T[],
  order: ReadonlyMap<string, Omit<SetItemOrderRow, "itemId">>
): T[] {
  const known = copies.filter((c) => order.has(c.id));
  const unknown = copies.filter((c) => !order.has(c.id));
  const row = (c: T): SetItemOrderRow => ({ itemId: c.id, ...order.get(c.id)! });
  return [...known.sort((a, b) => compareSetItems(row(a), row(b))), ...unknown];
}

/** What the totals block is computed from, as the sale stores it. Amounts are decimal strings. */
export interface OrderSummaryTotalsInput {
  /** The price of each set the buyer bought — the free extras left out. */
  setPrices: readonly string[];
  /** The handling the buyer paid, as stored — read only when the sale is not anchored on a total. */
  buyerHandling: string | null;
  /** What the buyer paid in total, when the sale is anchored on it (#205), else null. */
  buyerPaidTotal: string | null;
}

export interface OrderSummaryTotals {
  /** Σ the sets' prices. */
  items: string;
  /** How many sets {@link items} is. */
  sets: number;
  /** The buyer's shipping and handling. */
  shipping: string;
  /** What the buyer paid. */
  total: string;
}

/**
 * The summary's totals, in the sale's currency, as the sale screen reads them: items are the sets'
 * prices; on a sale anchored on what the buyer paid (#205) shipping is that total less the items,
 * held at zero, and the total is the one recorded; otherwise shipping is the handling recorded and
 * the total their sum. In cents, so the printed figures add up.
 *
 * Computed from the sets rather than the sale's derived gross, so a cancelled sale (#2500) — whose
 * sets are kept as a record and whose gross is nothing — prints what the buyer had ordered.
 */
export function orderSummaryTotals(input: OrderSummaryTotalsInput): OrderSummaryTotals {
  const items = input.setPrices.reduce((sum, p) => sum + cents(p), 0);
  let shipping: number;
  let total: number;
  if (input.buyerPaidTotal != null) {
    total = cents(input.buyerPaidTotal);
    shipping = Math.max(0, total - items);
  } else {
    shipping = input.buyerHandling == null ? 0 : cents(input.buyerHandling);
    total = items + shipping;
  }
  return { items: fmt(items), sets: input.setPrices.length, shipping: fmt(shipping), total: fmt(total) };
}

function cents(amount: string): number {
  const n = Number(amount);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

function fmt(cents: number): string {
  return (cents / 100).toFixed(2);
}
