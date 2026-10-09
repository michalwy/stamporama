// Pure cost-allocation engine (ADR-0009 §3). No Prisma / server-only imports, so it is
// unit-testable in isolation (`pnpm test:unit`); the server (#121/#122) assembles the
// inputs from `Purchase`/`PurchaseLot`/`PurchaseExpense`/`Item` and persists the result.
//
// The pipeline, all money in the purchase's transaction currency unless noted:
//
//   1. Shared cost (shipping) is distributed across ALL lines — inventory `PurchaseLot`s
//      and non-inventory `PurchaseExpense`s — proportionally to line price, so an expense
//      absorbs its fair share and does not inflate the stamps.
//   2. A lot's pool = its price + its share of the shared cost.
//   3. The pool is converted to the base currency with the FX rate frozen at the purchase
//      date, then, on lot close, distributed to the lot's items proportionally to the
//      primary-catalog price for each item's condition x certificate (ADR-0006).
//   4. Each item's share is frozen as its base-currency cost-basis snapshot (2 dp).
//
// Delivery axis (ADR-0009 §5):
//   - not_delivered -> item is removed from the lot; its share redistributes to survivors.
//   - damaged       -> item stays and keeps its share (a write-off / P&L loss handled in
//                      reporting, #123); it does NOT make the others cost more.
//
// Rounding: everything reconciles to the cent. Shared-cost shares sum exactly to the
// shipping cost, and per-item snapshots sum exactly to the lot pool, via largest-remainder
// (Hamilton) apportionment done in integer cents.

import type { DeliveryState } from "./delivery-state";

/** A priced line of a purchase — a `PurchaseLot` or a `PurchaseExpense`. */
export interface PurchaseLine {
  id: string;
  /** Line price in the purchase's transaction currency (>= 0). */
  price: number;
}

/** The cost inputs of a whole purchase, in its single transaction currency. */
export interface PurchaseCosts {
  /** Shared cost (shipping/handling) to spread across every line. 0 when none. */
  shippingCost: number;
  /** Inventory lines. */
  lots: PurchaseLine[];
  /** Non-inventory lines (magnifier, etc.). They absorb shared cost but hold no items. */
  expenses: PurchaseLine[];
  /** Base-currency rate frozen at the purchase date; null when base == transaction currency. */
  fxRateToBase: number | null;
}

/** One line with the shared cost apportioned to it (transaction currency). */
export interface LineShare {
  id: string;
  price: number;
  sharedCost: number;
}

/** A lot's resolved pool, before it is distributed to items. */
export interface LotPool {
  lotId: string;
  /** Lot line price (transaction currency). */
  price: number;
  /** This lot's share of the shared cost (transaction currency). */
  sharedCost: number;
  /** price + sharedCost, transaction currency, 2 dp. */
  poolTx: number;
  /** poolTx converted to the base currency at the frozen FX rate, 2 dp. */
  poolBase: number;
}

// The delivery axis vocabulary lives in `./delivery-state`, shared with the domain layer and
// the screens; re-exported here so existing importers of the allocation engine keep working.
export type { DeliveryState };

/** An item participating in a lot close. */
export interface LotItem {
  id: string;
  /**
   * Primary-catalog price for this item's condition x certificate, used as the
   * distribution weight. Must be expressed in a unit consistent across the lot's items
   * (base currency recommended, since areas may price in different currencies). `null`
   * means the item has no matching catalog price, which blocks the close (ADR-0009 §5).
   */
  catalogPrice: number | null;
  deliveryState: DeliveryState;
}

/** A frozen per-item cost-basis snapshot (base currency, 2 dp). */
export interface ItemCostBasis {
  itemId: string;
  costBasis: number;
}

export interface LotAllocation {
  /** Snapshots for items that stay in the lot (delivered / in_transit / damaged). */
  snapshots: ItemCostBasis[];
  /** Items removed from the lot because they were not delivered; cost-basis stays null. */
  notDeliveredItemIds: string[];
}

/** Why a lot close was rejected. */
export type LotCloseBlockReason =
  /** One or more staying items lack a primary-catalog price. */
  | "missing-price"
  /** Every staying item has a zero-price weight, so a positive pool cannot be split. */
  | "zero-weight";

/** Thrown when a lot cannot be closed; carries the offending item ids for the UI. */
export class LotCloseBlockedError extends Error {
  readonly reason: LotCloseBlockReason;
  readonly itemIds: string[];
  constructor(reason: LotCloseBlockReason, itemIds: string[]) {
    super(
      reason === "missing-price"
        ? `Cannot close lot: ${itemIds.length} item(s) lack a primary-catalog price`
        : `Cannot close lot: pool is positive but every item has a zero-price weight`
    );
    this.name = "LotCloseBlockedError";
    this.reason = reason;
    this.itemIds = itemIds;
  }
}

/** Round a money amount to whole cents (2 dp), guarding against binary-float drift. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/**
 * Split `total` (a money amount) across `weights` so the parts sum EXACTLY to `total`
 * at cent granularity (largest-remainder / Hamilton apportionment). Returns 2-dp amounts.
 *
 * - A zero `total` yields all-zero parts regardless of weights (nothing to split).
 * - A positive `total` with a non-positive weight base throws — the caller decides how to
 *   surface that; there is no meaningful proportional split.
 * - Negative weights are treated as zero.
 *
 * Exported because a trade's carried-over pool is split across its receive lines before this
 * engine splits each lot across its copies (#644): two levels of the same pro-rata rule, and a
 * second implementation of "reconcile to the cent" would be a second one to keep in step.
 */
export function apportionMoney(total: number, weights: number[]): number[] {
  const totalCents = toCents(total);
  if (totalCents === 0) return weights.map(() => 0);

  const safe = weights.map((w) => (w > 0 ? w : 0));
  const base = safe.reduce((s, w) => s + w, 0);
  if (base <= 0) throw new Error("apportion: positive total with zero weight base");

  const exact = safe.map((w) => (totalCents * w) / base);
  const floors = exact.map((c) => Math.floor(c));
  let remaining = totalCents - floors.reduce((s, c) => s + c, 0);

  // Hand out the leftover cents to the largest fractional remainders; ties break toward
  // the earlier index so the result is deterministic.
  const order = exact
    .map((c, i) => ({ i, frac: c - Math.floor(c) }))
    .sort((a, b) => b.frac - a.frac || a.i - b.i);

  const cents = floors.slice();
  for (const { i } of order) {
    if (remaining <= 0) break;
    cents[i] += 1;
    remaining -= 1;
  }
  return cents.map((c) => c / 100);
}

/**
 * Distribute the shared cost across every line (lots + expenses) by price (ADR-0009 §3.1).
 * Shares sum exactly to `shippingCost`. Line order is lots first, then expenses.
 */
export function distributeSharedCost(costs: PurchaseCosts): LineShare[] {
  const lines = [...costs.lots, ...costs.expenses];
  const shares = apportionMoney(costs.shippingCost, lines.map((l) => l.price));
  return lines.map((l, i) => ({ id: l.id, price: l.price, sharedCost: shares[i] }));
}

/** Convert a transaction-currency amount to the base currency at the frozen rate (2 dp). */
function toBase(amountTx: number, fxRateToBase: number | null): number {
  if (fxRateToBase == null) return toCents(amountTx) / 100;
  return toCents(amountTx * fxRateToBase) / 100;
}

/**
 * Resolve one lot's pool: its price plus its share of the shared cost (ADR-0009 §3.2),
 * with the base-currency equivalent at the frozen FX rate. Throws if `lotId` is unknown.
 */
export function computeLotPool(costs: PurchaseCosts, lotId: string): LotPool {
  const share = distributeSharedCost(costs).find((s) => s.id === lotId);
  if (!share) throw new Error(`computeLotPool: unknown lot ${lotId}`);
  const poolTx = toCents(share.price + share.sharedCost) / 100;
  return {
    lotId,
    price: share.price,
    sharedCost: share.sharedCost,
    poolTx,
    poolBase: toBase(poolTx, costs.fxRateToBase),
  };
}

/**
 * Distribute a base-currency lot pool to its items by catalog-price weight (ADR-0009 §3.3),
 * applying the delivery rules (§5). Not-delivered items are dropped and redistribute to the
 * rest; damaged items stay and keep their share. Snapshots sum exactly to `poolBase`.
 *
 * @throws {LotCloseBlockedError} `missing-price` if any staying item has a null weight;
 *   `zero-weight` if the pool is positive but every staying item weighs zero.
 */
export function allocateLot(poolBase: number, items: LotItem[]): LotAllocation {
  const staying = items.filter((it) => it.deliveryState !== "not_delivered");
  const notDeliveredItemIds = items
    .filter((it) => it.deliveryState === "not_delivered")
    .map((it) => it.id);

  const missing = staying.filter((it) => it.catalogPrice == null).map((it) => it.id);
  if (missing.length > 0) throw new LotCloseBlockedError("missing-price", missing);

  const weights = staying.map((it) => it.catalogPrice as number);
  const weightBase = weights.reduce((s, w) => s + (w > 0 ? w : 0), 0);
  if (weightBase <= 0 && toCents(poolBase) !== 0) {
    throw new LotCloseBlockedError(
      "zero-weight",
      staying.map((it) => it.id)
    );
  }

  const shares = apportionMoney(poolBase, weights);
  return {
    snapshots: staying.map((it, i) => ({ itemId: it.id, costBasis: shares[i] })),
    notDeliveredItemIds,
  };
}

/** A per-item cost-basis **estimate** for an open lot, computed from whatever data is
 * available right now and never persisted (the real snapshot is frozen on close by
 * `allocateLot`). Unlike `allocateLot` it never throws: not-delivered, unpriced, and
 * zero-weight copies are excluded (a `null` estimate) and the pool is apportioned across the
 * remaining priced copies. When no copy carries a positive weight, every estimate is `null`.
 * When every staying copy is priced, the estimates equal the eventual close snapshots. */
export interface ItemCostEstimate {
  itemId: string;
  /** Estimated base-currency share (2 dp), or null when it can't be estimated yet. */
  costBasis: number | null;
}

export function estimateLot(poolBase: number, items: LotItem[]): ItemCostEstimate[] {
  const included = items.map(
    (it) =>
      it.deliveryState !== "not_delivered" && it.catalogPrice != null && it.catalogPrice > 0
  );
  const weights = items.map((it, i) => (included[i] ? (it.catalogPrice as number) : 0));
  const base = weights.reduce((sum, w) => sum + w, 0);
  if (base <= 0) return items.map((it) => ({ itemId: it.id, costBasis: null }));
  const shares = apportionMoney(poolBase, weights);
  return items.map((it, i) => ({ itemId: it.id, costBasis: included[i] ? shares[i] : null }));
}

/**
 * Convenience end-to-end close of one lot: resolve its pool from the whole-purchase costs,
 * then distribute it to `items`. Equivalent to `allocateLot(computeLotPool(...).poolBase, items)`.
 */
export function closeLot(
  costs: PurchaseCosts,
  lotId: string,
  items: LotItem[]
): LotAllocation {
  return allocateLot(computeLotPool(costs, lotId).poolBase, items);
}

// ── The pool an open lot shows, and a copy's live share of it (#172, #1696) ───────────────────
// The purchase order states each open-lot copy's estimated cost, and the copy's own page, the
// copies list and the Valuation dialog state the same figure (#1696). They are one computation in
// one place, so the screens can never disagree about what a copy is estimated to cost.

/** A purchase's money as the purchase row stores it — Decimals or numbers, nulls where a column
 * is optional — ready for {@link purchaseCostsOf}. */
export interface StoredPurchaseCosts {
  shippingCost: unknown;
  fxRateToBase: unknown;
  lots: readonly { id: string; price: unknown }[];
  expenses: readonly { id: string; price: unknown }[];
}

/** The engine's input off a stored purchase. A lot with no value weighs nothing in the shipping
 * split — and only an opening balance has one, which carries no shipping to split anyway (#1323). */
export function purchaseCostsOf(row: StoredPurchaseCosts): PurchaseCosts {
  return {
    shippingCost: row.shippingCost != null ? Number(row.shippingCost) : 0,
    lots: row.lots.map((l) => ({ id: l.id, price: l.price == null ? 0 : Number(l.price) })),
    expenses: row.expenses.map((e) => ({ id: e.id, price: Number(e.price) })),
    fxRateToBase: row.fxRateToBase != null ? Number(row.fxRateToBase) : null,
  };
}

/** Whether a purchase's amounts can be stated in the base currency: a rate is frozen, or the
 * transaction currency **is** the base currency (an implicit 1:1 rate — `fxRateToBase` is
 * deliberately left null then). Only a genuinely unknown cross-currency rate says no. */
export function canExpressInBase(
  fxRateToBase: number | null,
  currency: string,
  baseCurrency: string
): boolean {
  return fxRateToBase != null || currency === baseCurrency;
}

/** A lot's pool in the base currency, or null when the lot has no value to split (#1323) or the
 * purchase has no rate into the base currency. */
export function lotPoolBase(
  costs: PurchaseCosts,
  lotId: string,
  opts: { valued: boolean; canExpressBase: boolean }
): number | null {
  if (!opts.valued || !opts.canExpressBase) return null;
  return computeLotPool(costs, lotId).poolBase;
}

/** A copy as the live estimate weighs it: its delivery state and its base-currency catalogue
 * value (null when it has none). */
export interface EstimateCopy {
  deliveryState: string;
  weight: number | null;
}

/** The estimate's denominator: Σ positive weight over the lot's staying copies. A property of the
 * **whole** lot, never of a filtered view — or one copy would show a different estimate depending
 * on what else the list was showing. */
export function estimateWeightBase(copies: readonly EstimateCopy[]): number {
  return copies.reduce(
    (sum, c) =>
      c.deliveryState !== "not_delivered" && c.weight != null && c.weight > 0
        ? sum + c.weight
        : sum,
    0
  );
}

/** Why an open-lot copy has no estimate: it was not delivered (it leaves the split, and its share
 * goes to the others), its purchase has no rate into the base currency, or it has no catalogue
 * value to share the pool by. */
export type CostEstimateGap = "not_delivered" | "no_rate" | "no_catalog_value";

export type CostEstimate =
  | { amount: number; gap: null }
  | { amount: null; gap: CostEstimateGap };

/** A copy's live cost-basis estimate for an open lot: its share of the base-currency pool by
 * catalogue weight against the whole lot's {@link estimateWeightBase}, to the cent. Never
 * persisted — the real snapshot is frozen on close (`allocateLot`), and equals this once every
 * staying copy is priced. `poolBase` is null when the purchase has no rate into the base currency. */
export function estimateCopyCost(
  copy: EstimateCopy,
  poolBase: number | null,
  weightBase: number
): CostEstimate {
  if (copy.deliveryState === "not_delivered") return { amount: null, gap: "not_delivered" };
  if (poolBase == null) return { amount: null, gap: "no_rate" };
  const w = copy.weight;
  if (w == null || w <= 0 || weightBase <= 0) return { amount: null, gap: "no_catalog_value" };
  return { amount: Math.round(((poolBase * w) / weightBase) * 100) / 100, gap: null };
}
