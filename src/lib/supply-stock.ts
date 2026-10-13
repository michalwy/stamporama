// A packing supply's stock, costed FIFO (#1897, ADR-0068). Pure — no Prisma, no `server-only` — so
// the order the batches are used in, and what is left of each, are unit-tested rather than read off
// a screen.
//
// Every supply line of a purchase order (or an opening balance) is one **batch**: a quantity bought
// at one cost — its line price plus its share of the order's shipping (`computeSupplyBatchCost`).
// Supplies leave stock **oldest batch first**, each unit at the unit cost of its own batch. The
// value of what is on hand is therefore the newest batches' cost, which is what FIFO means here and
// all it means: no averaging across batches, and no typed price anywhere.
//
// Nothing uses supplies yet — taking them onto a sale's shipping is #1898 — so `used` is 0 today.
// The rule that spends it is written now, beside the stock it spends, so that the screen showing
// what is on hand and the sale that takes from it can never disagree about which batch went first.

/** One batch as the stock needs it. */
export interface SupplyBatch {
  id: string;
  /** The date of the purchase the batch was bought on (yyyy-mm-dd) — what "oldest" means. */
  boughtOn: string;
  /** When the line was written (ISO): the tie-breaker between two batches of one day. */
  createdAt: string;
  /** Units the batch brought in. Always positive. */
  quantity: number;
  /** The whole batch's cost in the base currency, or null when its purchase has no rate into it. */
  costBase: number | null;
}

/** A batch with what is left of it. */
export interface SupplyBatchStock extends SupplyBatch {
  /** Units of this batch still on hand. */
  onHand: number;
  /** One unit's cost in the base currency, unrounded; null when the batch's cost is unknown. */
  unitCostBase: number | null;
  /** What is left of the batch at its own unit cost, base currency, 2 dp; null when unknown. */
  valueBase: number | null;
}

/** A supply's stock: its batches oldest first, and their sums. */
export interface SupplyStock {
  batches: SupplyBatchStock[];
  /** Units on hand across every batch. */
  onHand: number;
  /**
   * What is on hand is worth at FIFO cost, base currency, 2 dp. **Null when any batch with units
   * left has no rate into the base currency** — a sum that quietly left a batch out would be worse
   * than no sum (#1184). A batch used up does not count against it: nothing of it is left to value.
   */
  valueBase: number | null;
  /** Batches with units left whose cost cannot be stated in the base currency. */
  unvaluedBatches: number;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** The order supplies leave stock in: oldest purchase first, then the line written first, then id
 * so two lines of one moment still have one order. */
export function fifoOrder<T extends Pick<SupplyBatch, "id" | "boughtOn" | "createdAt">>(
  batches: readonly T[]
): T[] {
  return [...batches].sort(
    (a, b) =>
      a.boughtOn.localeCompare(b.boughtOn) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  );
}

/**
 * What is left of each batch once `used` units have left stock oldest first, and what that is
 * worth. `used` beyond the whole stock leaves every batch empty rather than any negative; refusing
 * to use more than is held is the job of whatever does the using.
 */
export function fifoSupplyStock(batches: readonly SupplyBatch[], used: number): SupplyStock {
  let toTake = Math.max(0, Math.floor(used));
  const ordered = fifoOrder(batches).map((batch): SupplyBatchStock => {
    const taken = Math.min(batch.quantity, toTake);
    toTake -= taken;
    const onHand = batch.quantity - taken;
    const unitCostBase = batch.costBase == null ? null : batch.costBase / batch.quantity;
    // The batch's own cost scaled to what is left, rounded once, so an untouched batch is worth
    // exactly what it cost rather than its unit cost × quantity a cent away.
    const valueBase =
      batch.costBase == null ? null : toCents((batch.costBase * onHand) / batch.quantity) / 100;
    return { ...batch, onHand, unitCostBase, valueBase };
  });

  const holding = ordered.filter((b) => b.onHand > 0);
  const unvaluedBatches = holding.filter((b) => b.valueBase == null).length;
  const valueCents = holding.reduce((sum, b) => sum + toCents(b.valueBase ?? 0), 0);
  return {
    batches: ordered,
    onHand: holding.reduce((sum, b) => sum + b.onHand, 0),
    valueBase: unvaluedBatches > 0 ? null : valueCents / 100,
    unvaluedBatches,
  };
}

/** A unit cost for reading: to the hundredth of a cent, since an envelope costs 0.2345 as easily as
 * 0.23 and the difference adds up over a box. */
export function formatUnitCost(unitCost: number): string {
  return (Math.round(unitCost * 10000) / 10000).toFixed(4);
}
