import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeCopySaleProfit,
  computeSaleProfit,
  copiesNeedingWeights,
  describeEstimated,
  describeLeftOut,
  leftOutTotal,
  saleRateMissing,
  sumProfitFigures,
  type SaleProfitCopy,
  type SaleProfitLine,
} from "../../src/lib/sale-profit";

// Profit and loss on a sale, its units and its copies (#168): the arithmetic is ADR-0012 §6, and
// what these cases pin down is the rule for a figure that cannot be had — left out and counted,
// never valued at zero.

function known(id: string, cost: string, catalogPrice: number | null = 1): SaleProfitCopy {
  return { id, costBasis: cost, lotId: "lot", lotStatus: "closed", lotValued: true, catalogPrice };
}
function pending(id: string, catalogPrice: number | null = 1): SaleProfitCopy {
  return { id, costBasis: null, lotId: "lot", lotStatus: "open", lotValued: true, catalogPrice };
}
/** A pending copy the sale screen has an estimate for (#1814). */
function estimated(id: string, estimate: number | null, catalogPrice: number | null = 1): SaleProfitCopy {
  return { ...pending(id, catalogPrice), estimate };
}
function noCost(id: string, catalogPrice: number | null = 1): SaleProfitCopy {
  return { id, costBasis: null, lotId: null, lotStatus: null, lotValued: null, catalogPrice };
}
/** A copy from an opening balance's lot stated without a value (#1323): cost not applicable. */
function noOpeningValue(id: string, catalogPrice: number | null = 1): SaleProfitCopy {
  return { id, costBasis: null, lotId: "opening-lot", lotStatus: "closed", lotValued: false, catalogPrice };
}
function line(id: string, netBase: number, copies: SaleProfitCopy[]): SaleProfitLine {
  return { id, netBase, copies };
}

describe("computeSaleProfit", () => {
  it("takes every unit whole when every cost is known", () => {
    const profit = computeSaleProfit(
      [line("l1", 45, [known("a", "10.00"), known("b", "10.00")]), line("l2", 8.5, [known("c", "12.00")])],
      false
    );
    assert.equal(profit.copyCount, 3);
    assert.equal(profit.countedCount, 3);
    assert.equal(profit.proceeds, "53.50");
    assert.equal(profit.cost, "32.00");
    assert.equal(profit.profit, "21.50");
    assert.deepEqual(profit.units.map((u) => u.profit), ["25.00", "-3.50"]);
    assert.deepEqual(profit.units.map((u) => u.cost), ["20.00", "12.00"]);
  });

  it("does not need a catalogue price to take a wholly countable unit", () => {
    const profit = computeSaleProfit(
      [line("l1", 30, [known("a", "5.00", null), known("b", "5.00", null)])],
      false
    );
    assert.equal(profit.profit, "20.00");
  });

  it("leaves a whole sale out when it has no exchange rate, and gives no figure", () => {
    const profit = computeSaleProfit([line("l1", 45, [known("a", "10.00"), known("b", "10.00")])], true);
    assert.equal(profit.countedCount, 0);
    assert.equal(profit.leftOut.noRate, 2);
    assert.equal(profit.proceeds, null);
    assert.equal(profit.cost, null);
    assert.equal(profit.profit, null);
    assert.equal(profit.units[0].profit, null);
    assert.equal(profit.units[0].leftOut.noRate, 2);
  });

  it("counts a partly countable unit's known copies by their catalogue share", () => {
    // 100.00 split 1:3 — the known copy's quarter is 25.00 against its 10.00 cost.
    const profit = computeSaleProfit(
      [line("l1", 100, [known("a", "10.00", 1), pending("b", 3)])],
      false
    );
    assert.equal(profit.countedCount, 1);
    assert.equal(profit.leftOut.costPending, 1);
    assert.equal(profit.proceeds, "25.00");
    assert.equal(profit.cost, "10.00");
    assert.equal(profit.profit, "15.00");
    // The unit itself has no figure: its net is against the cost of all its copies.
    assert.equal(profit.units[0].profit, null);
    assert.equal(profit.units[0].cost, null);
    assert.equal(profit.units[0].leftOut.costPending, 1);
  });

  it("leaves a known copy out as unsplittable when its unit's net cannot be split", () => {
    const profit = computeSaleProfit(
      [
        line("l1", 100, [known("a", "10.00", 1), noCost("b", null)]),
        line("l2", 20, [known("c", "5.00")]),
      ],
      false
    );
    assert.equal(profit.copyCount, 3);
    assert.equal(profit.countedCount, 1);
    assert.deepEqual(profit.leftOut, { costPending: 0, noCost: 1, noOpeningValue: 0, noRate: 0, unsplittable: 1 });
    assert.equal(profit.profit, "15.00");
    assert.equal(profit.units[0].leftOut.unsplittable, 0);
  });

  it("gives no figure, never zero, when no copy can be counted", () => {
    const profit = computeSaleProfit([line("l1", 20, [pending("a")]), line("l2", 5, [noCost("b")])], false);
    assert.equal(profit.profit, null);
    assert.deepEqual(profit.leftOut, { costPending: 1, noCost: 1, noOpeningValue: 0, noRate: 0, unsplittable: 0 });
  });

  // #1324: an opening value is a cost basis like a purchase cost — profit is measured against it.
  it("measures profit against an opening value exactly as against a purchase cost", () => {
    const profit = computeSaleProfit([line("l1", 50, [known("a", "12.00")])], false);
    assert.equal(profit.profit, "38.00");
  });

  // #1324: without an opening value the copy has no cost, never a zero one — so no profit figure,
  // which a zero would inflate to the whole price, and a reason of its own.
  it("gives no figure for a copy from an opening balance with no value, and says why", () => {
    const profit = computeSaleProfit([line("l1", 50, [noOpeningValue("a")])], false);
    assert.equal(profit.profit, null);
    assert.equal(profit.proceeds, null);
    assert.deepEqual(profit.leftOut, { costPending: 0, noCost: 0, noOpeningValue: 1, noRate: 0, unsplittable: 0 });
    assert.equal(profit.units[0].profit, null);
    assert.deepEqual(describeLeftOut(profit.leftOut), ["1 from an opening balance with no value"]);
    assert.equal(sumProfitFigures([profit]).leftOut.noOpeningValue, 1);
  });

  it("states a loss when fees exceed the price", () => {
    const profit = computeSaleProfit([line("l1", -2.5, [known("a", "1.00")])], false);
    assert.equal(profit.profit, "-3.50");
  });
});

// #1814: the sale's own screen counts a copy on an open lot at its estimated cost, and says so.
describe("computeSaleProfit with open-lot estimates", () => {
  it("counts a pending copy at its estimate and marks the unit and the sale", () => {
    const profit = computeSaleProfit(
      [line("l1", 45, [known("a", "10.00"), estimated("b", 7.5)]), line("l2", 20, [known("c", "5.00")])],
      false
    );
    assert.equal(profit.countedCount, 3);
    assert.equal(profit.estimatedCount, 1);
    assert.equal(leftOutTotal(profit.leftOut), 0);
    assert.equal(profit.cost, "22.50");
    assert.equal(profit.profit, "42.50");
    assert.deepEqual(profit.units.map((u) => [u.profit, u.cost, u.estimatedCount]), [
      ["27.50", "17.50", 1],
      ["15.00", "5.00", 0],
    ]);
  });

  it("still leaves out a pending copy with no estimate, and splits by catalogue for the rest", () => {
    // 100.00 split 1:1:2 — the known and the estimated copy take a quarter each.
    const profit = computeSaleProfit(
      [line("l1", 100, [known("a", "10.00", 1), estimated("b", 4, 1), estimated("c", null, 2)])],
      false
    );
    assert.equal(profit.countedCount, 2);
    assert.equal(profit.estimatedCount, 1);
    assert.equal(profit.leftOut.costPending, 1);
    assert.equal(profit.proceeds, "50.00");
    assert.equal(profit.cost, "14.00");
    assert.equal(profit.profit, "36.00");
    assert.equal(profit.units[0].profit, null);
    assert.equal(profit.units[0].estimatedCount, 0);
  });

  it("reads the frozen cost once the lot closes, whatever estimate is passed", () => {
    const profit = computeSaleProfit([line("l1", 30, [{ ...known("a", "12.00"), estimate: 9 }])], false);
    assert.equal(profit.profit, "18.00");
    assert.equal(profit.estimatedCount, 0);
    assert.equal(profit.units[0].estimatedCount, 0);
  });

  it("counts no estimate on a sale with no exchange rate", () => {
    const profit = computeSaleProfit([line("l1", 30, [estimated("a", 9)])], true);
    assert.equal(profit.profit, null);
    assert.equal(profit.estimatedCount, 0);
  });

  it("asks for weights only where an unestimated copy still splits a unit", () => {
    assert.deepEqual(
      copiesNeedingWeights([
        line("whole", 1, [known("a", "1.00"), estimated("b", 1)]),
        line("part", 1, [estimated("c", 1), estimated("d", null)]),
      ]),
      ["c", "d"]
    );
  });

  it("describes the estimate, and nothing when there is none", () => {
    assert.equal(describeEstimated(0), null);
    assert.match(describeEstimated(1)!, /^~ 1 copy counted at its estimated cost/);
    assert.match(describeEstimated(3)!, /^~ 3 copies counted at their estimated cost/);
  });
});

describe("copiesNeedingWeights", () => {
  it("asks only for the copies of a partly countable unit", () => {
    assert.deepEqual(
      copiesNeedingWeights([
        line("whole", 1, [known("a", "1.00"), known("b", "1.00")]),
        line("none", 1, [pending("c"), noCost("d")]),
        line("part", 1, [known("e", "1.00"), pending("f")]),
      ]),
      ["e", "f"]
    );
  });
});

describe("sumProfitFigures", () => {
  it("is the sales added up, with the uncountable ones still counted", () => {
    const a = computeSaleProfit([line("l1", 45, [known("a", "10.00")])], false);
    const b = computeSaleProfit([line("l2", 30, [known("b", "40.00")])], true);
    const c = computeSaleProfit([line("l3", 100, [known("c", "10.00", 1), pending("d", 3)])], false);
    const total = sumProfitFigures([a, b, c]);
    assert.equal(total.copyCount, 4);
    assert.equal(total.countedCount, 2);
    assert.deepEqual(total.leftOut, { costPending: 1, noCost: 0, noOpeningValue: 0, noRate: 1, unsplittable: 0 });
    assert.equal(total.proceeds, "70.00");
    assert.equal(total.cost, "20.00");
    assert.equal(total.profit, "50.00");
  });

  it("is zero over no sold copies, and no figure when every copy is left out", () => {
    assert.equal(sumProfitFigures([]).profit, "0.00");
    const out = computeSaleProfit([line("l1", 5, [pending("a")])], false);
    assert.equal(sumProfitFigures([out]).profit, null);
  });
});

describe("computeCopySaleProfit", () => {
  it("gives a copy on a unit of one the whole net", () => {
    const copy = computeCopySaleProfit(line("l1", 45, [known("a", "10.00", null)]), "a", false);
    assert.equal(copy.share, "45.00");
    assert.equal(copy.profit, "35.00");
  });

  it("splits a set's net by catalogue weight, whatever the other copies' costs", () => {
    const set = line("l1", 100, [known("a", "10.00", 1), pending("b", 3)]);
    const a = computeCopySaleProfit(set, "a", false);
    assert.equal(a.share, "25.00");
    assert.equal(a.profit, "15.00");
    const b = computeCopySaleProfit(set, "b", false);
    assert.equal(b.share, "75.00");
    assert.equal(b.cost.state, "pending");
    assert.equal(b.profit, null);
  });

  it("says why a share is missing", () => {
    const blocked = line("l1", 100, [known("a", "10.00", 1), known("b", "10.00", null)]);
    assert.equal(computeCopySaleProfit(blocked, "a", false).shareGap, "unsplittable");
    assert.equal(computeCopySaleProfit(blocked, "a", false).profit, null);
    const noRate = computeCopySaleProfit(line("l2", 10, [known("c", "1.00")]), "c", true);
    assert.equal(noRate.shareGap, "no-rate");
    assert.equal(noRate.share, null);
  });
});

describe("saleRateMissing", () => {
  const base = {
    baseCurrency: "PLN",
    currency: "PLN",
    fxRateToBase: null,
    shippingCost: null,
    shippingCurrency: null,
    shippingFxRateToBase: null,
  };
  it("needs no rate for a sale in the base currency", () => {
    assert.equal(saleRateMissing(base), false);
  });
  it("misses a rate for a foreign sale or foreign shipping without one", () => {
    assert.equal(saleRateMissing({ ...base, currency: "EUR" }), true);
    assert.equal(saleRateMissing({ ...base, currency: "EUR", fxRateToBase: "4.3" }), false);
    assert.equal(saleRateMissing({ ...base, shippingCost: "5", shippingCurrency: "EUR" }), true);
    assert.equal(
      saleRateMissing({ ...base, shippingCost: "5", shippingCurrency: "EUR", shippingFxRateToBase: "4.3" }),
      false
    );
  });
});

describe("describeLeftOut", () => {
  it("names each reason with its count and drops the zeros", () => {
    assert.deepEqual(describeLeftOut({ costPending: 2, noCost: 0, noOpeningValue: 0, noRate: 0, unsplittable: 1 }), [
      "2 with cost pending",
      "1 whose share cannot be split",
    ]);
  });
});
