// A packing supply's stock, costed FIFO (#1897, ADR-0068). Pure — no Prisma, no `server-only` — so
// the order the batches are used in, and what is left of each, are unit-tested rather than read off
// a screen.
//
// Every supply line of a purchase order (or an opening balance) is one **batch**: a quantity bought
// at one cost — its line price plus its share of the order's shipping (`computeSupplyBatchCost`).
// Supplies leave stock **oldest batch first**, each unit at the unit cost of its own batch. No
// averaging across batches, and no typed price anywhere.
//
// Since #1898 sales use them, and **which batch a use took from is recorded** (`SaleSupplyUse`) rather
// than replayed: a line given back returns its units to the batches they came from, at the costs they
// were taken at, and the other sales' figures do not move. `settleSupplyUses` is the one rule that
// writes those records — it takes FIFO, gives back what a batch no longer holds, and covers a
// shortfall the moment stock exists for it — and `supplyStock` reads what they leave on hand.

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
 * What is left of each batch once the units recorded against it have left, and what that is worth.
 * `usedByBatch` is the units taken from each batch (`SaleSupplyUse`, summed); a batch missing from it
 * is whole. More taken than a batch holds leaves it empty rather than negative — `settleSupplyUses`
 * never records that, and this does not trust it either.
 */
export function supplyStock(
  batches: readonly SupplyBatch[],
  usedByBatch: ReadonlyMap<string, number>
): SupplyStock {
  const ordered = fifoOrder(batches).map((batch): SupplyBatchStock => {
    const taken = Math.min(batch.quantity, Math.max(0, usedByBatch.get(batch.id) ?? 0));
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

// ── Taking supplies out of stock (#1898) ─────────────────────────────────────────────────────

/** A batch as settling needs it: what it holds and where it stands in FIFO order. */
export type SettleBatch = Pick<SupplyBatch, "id" | "boughtOn" | "createdAt" | "quantity">;

/** A line that uses the supply — a sale's supply line — and how many units it used. */
export interface SettleLine {
  id: string;
  /** The day the units were used (yyyy-mm-dd) — the sale's date. What "first" means for a shortfall. */
  usedOn: string;
  /** When the line was written (ISO): the tie-breaker between two lines of one day. */
  createdAt: string;
  /** Units used. Always positive. */
  quantity: number;
}

/** Units a line took from one batch — a `SaleSupplyUse` row. */
export interface SupplyTake {
  lineId: string;
  batchId: string;
  quantity: number;
}

/** Lines in the order a shortfall is covered in, and the reverse of the order units are given back
 * in: the earliest use first, then the line written first, then id. */
function lineOrder<T extends Pick<SettleLine, "id" | "usedOn" | "createdAt">>(lines: readonly T[]): T[] {
  return [...lines].sort(
    (a, b) =>
      a.usedOn.localeCompare(b.usedOn) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id)
  );
}

/**
 * One supply's uses, settled: what every line holds from which batch once the stock and the lines
 * as they now stand are reconciled. Given the takes recorded so far, it
 *
 *  1. **drops** a take of a line or a batch that no longer exists (or is not this supply's);
 *  2. **gives back** what a line holds beyond what it used — its newest batches' units first, so it
 *     keeps the ones it took first, at their cost;
 *  3. **gives back** what a batch has handed out beyond what it holds (its quantity was lowered) —
 *     the latest line's units first, so the earliest use keeps its batch;
 *  4. **covers** every line still short, earliest use first, from the batches with units left,
 *     oldest batch first — which is FIFO for a line just written, and is how a purchase recorded
 *     after a parcel went out covers it.
 *
 * Nothing already held is moved between batches: a take that still fits stays exactly where it is,
 * so another sale's figure never shifts because this one changed. Returns the takes to store, each
 * with a positive quantity, at most one per (line, batch).
 */
export function settleSupplyUses(
  batches: readonly SettleBatch[],
  lines: readonly SettleLine[],
  current: readonly SupplyTake[]
): SupplyTake[] {
  const fifo = fifoOrder(batches);
  const fifoRank = new Map(fifo.map((b, i) => [b.id, i]));
  const ordered = lineOrder(lines);
  const lineRank = new Map(ordered.map((l, i) => [l.id, i]));

  // (line, batch) → units, the takes that still name something real.
  const held = new Map<string, Map<string, number>>();
  for (const take of current) {
    if (!lineRank.has(take.lineId) || !fifoRank.has(take.batchId) || take.quantity <= 0) continue;
    const ofLine = held.get(take.lineId) ?? new Map<string, number>();
    ofLine.set(take.batchId, (ofLine.get(take.batchId) ?? 0) + take.quantity);
    held.set(take.lineId, ofLine);
  }

  // 2. A line holds no more than it used: give back from its newest batch first.
  for (const line of ordered) {
    const ofLine = held.get(line.id);
    if (!ofLine) continue;
    let excess = [...ofLine.values()].reduce((s, q) => s + q, 0) - line.quantity;
    const newestFirst = [...ofLine.keys()].sort((a, b) => fifoRank.get(b)! - fifoRank.get(a)!);
    for (const batchId of newestFirst) {
      if (excess <= 0) break;
      const give = Math.min(excess, ofLine.get(batchId)!);
      ofLine.set(batchId, ofLine.get(batchId)! - give);
      excess -= give;
    }
  }

  // 3. A batch hands out no more than it holds: the latest line gives back first.
  for (const batch of fifo) {
    let handedOut = 0;
    for (const ofLine of held.values()) handedOut += ofLine.get(batch.id) ?? 0;
    let excess = handedOut - batch.quantity;
    for (let i = ordered.length - 1; i >= 0 && excess > 0; i--) {
      const ofLine = held.get(ordered[i].id);
      const has = ofLine?.get(batch.id) ?? 0;
      if (has <= 0) continue;
      const give = Math.min(excess, has);
      ofLine!.set(batch.id, has - give);
      excess -= give;
    }
  }

  // 4. Cover what is short, earliest use first, from the oldest batch with units left.
  const onHand = new Map(fifo.map((b) => [b.id, b.quantity]));
  for (const ofLine of held.values()) {
    for (const [batchId, q] of ofLine) onHand.set(batchId, onHand.get(batchId)! - q);
  }
  for (const line of ordered) {
    const ofLine = held.get(line.id) ?? new Map<string, number>();
    let short = line.quantity - [...ofLine.values()].reduce((s, q) => s + q, 0);
    for (const batch of fifo) {
      if (short <= 0) break;
      const left = onHand.get(batch.id)!;
      if (left <= 0) continue;
      const take = Math.min(short, left);
      ofLine.set(batch.id, (ofLine.get(batch.id) ?? 0) + take);
      onHand.set(batch.id, left - take);
      short -= take;
    }
    held.set(line.id, ofLine);
  }

  const takes: SupplyTake[] = [];
  for (const line of ordered) {
    const ofLine = held.get(line.id);
    if (!ofLine) continue;
    for (const batch of fifo) {
      const q = ofLine.get(batch.id) ?? 0;
      if (q > 0) takes.push({ lineId: line.id, batchId: batch.id, quantity: q });
    }
  }
  return takes;
}

// ── What a sale's supplies cost (#1898) ──────────────────────────────────────────────────────

/** A sale's supply line as its cost needs it: what it used, and what it holds from which batch. */
export interface CostedSupplyLine {
  quantity: number;
  uses: readonly {
    quantity: number;
    /** The batch's unit cost in the base currency, or null when its purchase has no rate into it. */
    unitCostBase: number | null;
  }[];
}

/** What a line, or a sale's lines together, cost. */
export interface SuppliesCost {
  /** The units that have a cost, summed — base currency, 2 dp. Never includes a guess for the rest. */
  costBase: number;
  /** Units used that are not in stock: the shortfall, waiting for a purchase. */
  shortUnits: number;
  /** Units taken from a batch whose cost cannot be stated in the base currency. */
  unratedUnits: number;
}

/** Whether a cost leaves units out — the figure is then incomplete, and low by their cost. */
export function suppliesCostIncomplete(cost: SuppliesCost): boolean {
  return cost.shortUnits > 0 || cost.unratedUnits > 0;
}

/** One line's cost: every unit it holds at its own batch's unit cost, rounded once per line. */
export function supplyLineCost(line: CostedSupplyLine): SuppliesCost {
  let cost = 0;
  let held = 0;
  let unratedUnits = 0;
  for (const use of line.uses) {
    held += use.quantity;
    if (use.unitCostBase == null) unratedUnits += use.quantity;
    else cost += use.unitCostBase * use.quantity;
  }
  return { costBase: toCents(cost) / 100, shortUnits: Math.max(0, line.quantity - held), unratedUnits };
}

/** A sale's supplies: its lines' costs added up, in cents, so the total is exactly its lines. */
export function saleSuppliesCost(lines: readonly CostedSupplyLine[]): SuppliesCost {
  let cents = 0;
  let shortUnits = 0;
  let unratedUnits = 0;
  for (const line of lines) {
    const cost = supplyLineCost(line);
    cents += toCents(cost.costBase);
    shortUnits += cost.shortUnits;
    unratedUnits += cost.unratedUnits;
  }
  return { costBase: cents / 100, shortUnits, unratedUnits };
}

/** A unit cost for reading: to the hundredth of a cent, since an envelope costs 0.2345 as easily as
 * 0.23 and the difference adds up over a box. */
export function formatUnitCost(unitCost: number): string {
  return (Math.round(unitCost * 10000) / 10000).toFixed(4);
}
/** Why a supplies cost leaves units out, as a short phrase ("2 units not in stock, 1 bought without
 * a rate"); null when it leaves none out. Read beside the figure it marks as incomplete. */
export function describeUncostedSupplies(
  cost: Pick<SuppliesCost, "shortUnits" | "unratedUnits">
): string | null {
  const parts: string[] = [];
  if (cost.shortUnits > 0) {
    parts.push(`${cost.shortUnits} unit${cost.shortUnits === 1 ? "" : "s"} not in stock`);
  }
  if (cost.unratedUnits > 0) {
    parts.push(
      `${cost.unratedUnits} unit${cost.unratedUnits === 1 ? "" : "s"} bought without a rate into the base currency`
    );
  }
  return parts.length > 0 ? parts.join(", ") : null;
}
