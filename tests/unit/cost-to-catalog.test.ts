import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_LOT_CATALOG_BASIS,
  costPercent,
  divergentCopyPercent,
  formatCostPercent,
  lotCatalogBasis,
  lotCostToCatalog,
  orderCostToCatalog,
  type CatalogBasisCopy,
  type CostToCatalogLot,
} from "../../src/lib/cost-to-catalog";

// What a purchase cost as a share of its copies' catalogue value (#1395). The cases pinned here are
// the ones a reader could not tell apart on screen: a partly priced scope said over only its priced
// copies, an unpriced one with no figure at all, an open lot with unpriced copies stated as an upper
// bound and kept out of the order's figure, and a copy's own figure appearing only where it differs.

const copy = (
  catalogValue: number | null,
  costBasis: number | null = null,
  deliveryState = "delivered"
): CatalogBasisCopy => ({ deliveryState, costBasis, catalogValue });

describe("lotCatalogBasis", () => {
  it("leaves a not-delivered copy out of both sides", () => {
    const basis = lotCatalogBasis([copy(10), copy(30, null, "not_delivered"), copy(null)]);
    assert.deepEqual(basis, {
      copyCount: 2,
      unpricedCount: 1,
      pricedValue: 10,
      frozenCount: 0,
      frozenCost: 0,
      frozenValue: 0,
    });
  });

  it("counts a damaged copy, which keeps its share", () => {
    const basis = lotCatalogBasis([copy(10, 2), copy(30, 6, "damaged")]);
    assert.equal(basis.copyCount, 2);
    assert.equal(basis.frozenCost, 8);
    assert.equal(basis.frozenValue, 40);
  });
});

const openLot = (poolBase: number | null, copies: CatalogBasisCopy[]): CostToCatalogLot => ({
  open: true,
  valued: true,
  poolBase,
  basis: lotCatalogBasis(copies),
});
const closedLot = (copies: CatalogBasisCopy[]): CostToCatalogLot => ({
  open: false,
  valued: true,
  poolBase: null,
  basis: lotCatalogBasis(copies),
});

describe("lotCostToCatalog", () => {
  it("is an estimate for an open lot whose copies are all priced", () => {
    const r = lotCostToCatalog(openLot(25, [copy(40), copy(60)]));
    assert.equal(r?.kind, "estimate");
    assert.equal(formatCostPercent(costPercent(r!)), "25%");
    assert.equal(r?.coveredCount, 2);
    assert.equal(r?.copyCount, 2);
  });

  it("is an upper bound for an open lot with unpriced copies", () => {
    const r = lotCostToCatalog(openLot(25, [copy(50), copy(null), copy(null)]));
    assert.equal(r?.kind, "at_most");
    assert.equal(formatCostPercent(costPercent(r!)), "50%");
    assert.equal(r?.unpricedCount, 2);
    assert.equal(r?.coveredCount, 1);
  });

  it("has no figure when no copy is priced, never 0% or ∞", () => {
    assert.equal(lotCostToCatalog(openLot(25, [copy(null), copy(null)])), null);
    assert.equal(lotCostToCatalog(closedLot([copy(null, 5)])), null);
    assert.equal(lotCostToCatalog(openLot(25, [])), null);
    assert.equal(lotCostToCatalog(openLot(25, [copy(0)])), null);
  });

  it("has no figure for an open lot whose pool cannot be stated in the base currency", () => {
    assert.equal(lotCostToCatalog(openLot(null, [copy(40)])), null);
  });

  it("has no figure for a lot with no value to split", () => {
    assert.equal(
      lotCostToCatalog({ ...closedLot([copy(40, 10)]), valued: false }),
      null
    );
  });

  it("reads a closed lot over the frozen cost of its priced copies only", () => {
    // A copy whose catalogue value has gone since the close is out of both sides, never the whole
    // cost against the value that is left.
    const r = lotCostToCatalog(closedLot([copy(40, 10), copy(60, 15), copy(null, 25)]));
    assert.equal(r?.kind, "settled");
    assert.equal(r?.cost, 25);
    assert.equal(r?.value, 100);
    assert.equal(r?.coveredCount, 2);
    assert.equal(r?.copyCount, 3);
    assert.equal(r?.unpricedCount, 1);
  });

  it("states a free lot as a real zero", () => {
    const r = lotCostToCatalog(openLot(0, [copy(40)]));
    assert.equal(formatCostPercent(costPercent(r!)), "0%");
  });
});

describe("orderCostToCatalog", () => {
  it("sums its lots' figures, and is an estimate while any is open", () => {
    const r = orderCostToCatalog([closedLot([copy(100, 30)]), openLot(10, [copy(100)])]);
    assert.equal(r?.kind, "estimate");
    assert.equal(formatCostPercent(costPercent(r!)), "20%");
    assert.equal(r?.coveredCount, 2);
    assert.equal(r?.copyCount, 2);
  });

  it("is settled once every lot behind it is closed", () => {
    const r = orderCostToCatalog([closedLot([copy(100, 30)]), closedLot([copy(50, 5)])]);
    assert.equal(r?.kind, "settled");
    assert.equal(formatCostPercent(costPercent(r!)), "23%");
  });

  it("leaves out a lot whose own figure is only an upper bound, and says how many copies it covers", () => {
    const r = orderCostToCatalog([
      closedLot([copy(100, 30)]),
      openLot(500, [copy(10), copy(null)]),
    ]);
    assert.equal(r?.kind, "settled");
    assert.equal(r?.cost, 30);
    assert.equal(r?.value, 100);
    assert.equal(r?.coveredCount, 1);
    assert.equal(r?.copyCount, 3);
  });

  it("has no figure when no lot has one", () => {
    assert.equal(orderCostToCatalog([openLot(25, [copy(null)])]), null);
    assert.equal(orderCostToCatalog([]), null);
    assert.equal(
      orderCostToCatalog([{ open: true, valued: true, poolBase: 5, basis: EMPTY_LOT_CATALOG_BASIS }]),
      null
    );
  });
});

describe("formatCostPercent", () => {
  it("rounds to a whole percent", () => {
    assert.equal(formatCostPercent(23.4), "23%");
    assert.equal(formatCostPercent(23.5), "24%");
    assert.equal(formatCostPercent(150), "150%");
  });

  it("does not round a cost that is not nothing down to 0%", () => {
    assert.equal(formatCostPercent(0.2), "<1%");
    assert.equal(formatCostPercent(0), "0%");
  });
});

describe("divergentCopyPercent", () => {
  // Frozen at 25% of catalogue: 10 against 40, 15 against 60.
  const lot = lotCostToCatalog(closedLot([copy(40, 10), copy(60, 15)]));

  it("is null for a copy that shares its lot's figure", () => {
    assert.equal(divergentCopyPercent({ costBasis: 10, catalogValue: 40 }, lot), null);
  });

  it("is null where only a cent of rounding separates it from its lot's rate", () => {
    // 0.03 against 0.10 is 30%, but 25% of 0.10 is 0.025 — the split cannot land nearer.
    assert.equal(divergentCopyPercent({ costBasis: 0.03, catalogValue: 0.1 }, lot), null);
  });

  it("is the copy's own figure once its catalogue value has moved since the close", () => {
    const own = divergentCopyPercent({ costBasis: 10, catalogValue: 20 }, lot);
    assert.equal(own, 50);
  });

  it("is null on an open lot, whose estimate is split by the very value it is read against", () => {
    const open = lotCostToCatalog(openLot(25, [copy(40), copy(60)]));
    assert.equal(divergentCopyPercent({ costBasis: 10, catalogValue: 20 }, open), null);
  });

  it("is null for a copy with no catalogue value, never ∞", () => {
    assert.equal(divergentCopyPercent({ costBasis: 10, catalogValue: null }, lot), null);
    assert.equal(divergentCopyPercent({ costBasis: 10, catalogValue: 0 }, lot), null);
  });
});
