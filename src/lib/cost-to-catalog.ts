// What a purchase cost as a fraction of its copies' catalogue value (#1395) — the question the
// collector asks of every parcel, *what fraction of catalogue did I pay?* Pure, so the cases it keeps
// apart are pinned by `pnpm test:unit`; the server gathers each lot's copies into a
// `LotCatalogBasis`, and the screen reads it against the lot's pool, which comes from the same read
// model the live cost estimate already uses (`LotSummary.poolBase`).
//
// Everything is in the collection's base currency: a frozen cost basis is stored in it, a lot's
// pool is converted into it at the order's frozen rate (#852), and a copy's catalogue value is
// valued into it. A lot whose pool cannot be stated in it has no figure — it is never compared
// across two currencies.
//
// Three rules, settled with the collector on 2026-09-26:
//
//  - **Only the copies the cost is split over count.** A not-delivered copy's share went to the
//    others (ADR-0009 §5), so it is out of both sides; a damaged or since-disposed one stays in,
//    the money having been spent on it.
//  - **An open lot is an estimate** — its cost has not been frozen onto copies yet. Where some of its
//    copies have no catalogue value, the whole pool against the value of the rest is an **upper
//    bound**, not a figure: pricing the others can only bring it down. Such a lot says so, and the
//    order leaves it out of its own figure, which then says how many copies it is over.
//  - **A copy's own figure is shown only where it differs from its lot's.** The pool is split by the
//    very catalogue value this compares against, so every copy of a lot shares its lot's figure by
//    construction; one only drifts from it when its catalogue value has changed since the lot was
//    closed.
//
// No catalogue value at all is **no figure**, never `0%` or `∞` (#1184).

/** What a lot's copies contribute, gathered server-side over the **whole** lot whatever the list is
 * filtered to. All amounts are base currency. */
export interface LotCatalogBasis {
  /** Copies the lot's cost is split over — every copy but the not-delivered ones. */
  copyCount: number;
  /** Of those, the ones with no catalogue value in the base currency. */
  unpricedCount: number;
  /** Σ catalogue value over those that have one — what an open lot's pool is split by. */
  pricedValue: number;
  /** Copies with both a frozen cost basis and a catalogue value — what a closed lot is read over. */
  frozenCount: number;
  /** Σ frozen cost basis over those copies. */
  frozenCost: number;
  /** Σ catalogue value over those copies. */
  frozenValue: number;
}

/** One copy as the basis reads it. */
export interface CatalogBasisCopy {
  deliveryState: string;
  /** Frozen cost basis, base currency, or null while its lot is open. */
  costBasis: number | null;
  /** Catalogue value in the base currency, or null when it has none. */
  catalogValue: number | null;
}

export const EMPTY_LOT_CATALOG_BASIS: LotCatalogBasis = {
  copyCount: 0,
  unpricedCount: 0,
  pricedValue: 0,
  frozenCount: 0,
  frozenCost: 0,
  frozenValue: 0,
};

/** A negative value weighs nothing, as it does in the pool split (`apportionMoney`). */
function weight(value: number): number {
  return value > 0 ? value : 0;
}

export function lotCatalogBasis(copies: CatalogBasisCopy[]): LotCatalogBasis {
  const basis = { ...EMPTY_LOT_CATALOG_BASIS };
  for (const c of copies) {
    if (c.deliveryState === "not_delivered") continue;
    basis.copyCount += 1;
    if (c.catalogValue == null) {
      basis.unpricedCount += 1;
      continue;
    }
    basis.pricedValue += weight(c.catalogValue);
    if (c.costBasis != null) {
      basis.frozenCount += 1;
      basis.frozenCost += c.costBasis;
      basis.frozenValue += weight(c.catalogValue);
    }
  }
  return basis;
}

/**
 * - `settled` — frozen cost against catalogue value.
 * - `estimate` — an open lot's pool against the catalogue value of copies that are all priced; it is
 *   what closing now would freeze.
 * - `at_most` — an open lot with unpriced copies: an upper bound, which pricing them can only lower.
 */
export type CostToCatalogKind = "settled" | "estimate" | "at_most";

export interface CostToCatalog {
  kind: CostToCatalogKind;
  /** Base-currency cost behind the figure. */
  cost: number;
  /** Base-currency catalogue value behind the figure (always > 0). */
  value: number;
  /** Copies behind the figure. */
  coveredCount: number;
  /** Copies in scope — equal to `coveredCount` when the figure is over all of them. */
  copyCount: number;
  /** Copies in scope with no catalogue value. */
  unpricedCount: number;
}

/** A lot as the figure needs it, beside its copies' basis. */
export interface CostToCatalogLot {
  open: boolean;
  /** False on a lot with no value to split (#1323) — it has no cost to compare. */
  valued: boolean;
  /** The lot's pool in the base currency, or null when it cannot be stated in it. */
  poolBase: number | null;
  basis: LotCatalogBasis;
}

export function lotCostToCatalog(lot: CostToCatalogLot): CostToCatalog | null {
  const { basis } = lot;
  if (!lot.valued) return null;
  if (lot.open) {
    if (lot.poolBase == null || basis.pricedValue <= 0) return null;
    return {
      kind: basis.unpricedCount > 0 ? "at_most" : "estimate",
      cost: lot.poolBase,
      value: basis.pricedValue,
      coveredCount: basis.copyCount - basis.unpricedCount,
      copyCount: basis.copyCount,
      unpricedCount: basis.unpricedCount,
    };
  }
  if (basis.frozenValue <= 0) return null;
  return {
    kind: "settled",
    cost: basis.frozenCost,
    value: basis.frozenValue,
    coveredCount: basis.frozenCount,
    copyCount: basis.copyCount,
    unpricedCount: basis.unpricedCount,
  };
}

/** The order's figure: every lot's that is a figure, summed. A lot whose own is only an upper bound
 * — or that has none — is left out, and its copies are what `coveredCount` then falls short by. An
 * order with any open lot behind the figure is an estimate. */
export function orderCostToCatalog(lots: CostToCatalogLot[]): CostToCatalog | null {
  let cost = 0;
  let value = 0;
  let coveredCount = 0;
  let copyCount = 0;
  let unpricedCount = 0;
  let estimate = false;
  for (const lot of lots) {
    copyCount += lot.basis.copyCount;
    unpricedCount += lot.basis.unpricedCount;
    const r = lotCostToCatalog(lot);
    if (!r || r.kind === "at_most") continue;
    cost += r.cost;
    value += r.value;
    coveredCount += r.coveredCount;
    if (r.kind === "estimate") estimate = true;
  }
  if (value <= 0) return null;
  return {
    kind: estimate ? "estimate" : "settled",
    cost,
    value,
    coveredCount,
    copyCount,
    unpricedCount,
  };
}

/** Cost as a percentage of catalogue value, unrounded. */
export function costPercent(r: Pick<CostToCatalog, "cost" | "value">): number {
  return (r.cost / r.value) * 100;
}

/** A whole percent, the precision the question needs. A cost that rounds to nothing but is not
 * nothing reads `<1%` — a real `0%` is a lot that cost nothing. */
export function formatCostPercent(percent: number): string {
  if (percent > 0 && percent < 0.5) return "<1%";
  return `${Math.round(percent)}%`;
}

/**
 * A copy's own percentage, **only where it differs from its lot's** — otherwise null.
 *
 * Only a closed lot's copy can differ: an open lot's estimate is its pool split by the very value
 * this compares against. Two guards keep rounding from reading as a difference — the frozen share
 * is within a cent of the exact one (`apportionMoney`), so a copy within a cent of its lot's rate has
 * not moved; and a difference that rounds to the same whole percent is not one the screen can show.
 */
export function divergentCopyPercent(
  copy: { costBasis: number | null; catalogValue: number | null },
  lot: CostToCatalog | null
): number | null {
  if (!lot || lot.kind !== "settled") return null;
  if (copy.costBasis == null || copy.catalogValue == null || copy.catalogValue <= 0) return null;
  const lotRate = lot.cost / lot.value;
  if (Math.abs(copy.costBasis - copy.catalogValue * lotRate) <= 0.01) return null;
  const own = (copy.costBasis / copy.catalogValue) * 100;
  if (formatCostPercent(own) === formatCostPercent(lotRate * 100)) return null;
  return own;
}
