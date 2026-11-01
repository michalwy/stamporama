import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lotGroupSummary, lotInBase, type GroupSummaryLot } from "../../src/lib/lot-group-summary-rules";

// The summary of a proposal's or a post's lots (#2326): the lots' price tables summed, withdrawn lots
// left out, and a line for what the sold lots brought in.

function lot(over: Partial<GroupSummaryLot> & { id: string }): GroupSummaryLot {
  return {
    state: "preparing",
    listingType: "fixed",
    price: "0.00",
    startingPrice: null,
    currency: "PLN",
    catalogPrice: null,
    suggestedPrice: null,
    marketPrice: null,
    costPrice: null,
    setCount: 1,
    itemCount: 1,
    sold: null,
    ...over,
  };
}

const column = (summary: ReturnType<typeof lotGroupSummary>, key: string) =>
  summary.asking.columns.find((c) => c.key === key)!;

describe("lotGroupSummary", () => {
  it("sums the saved prices and the figures, and weighs the prices against the cost as profit", () => {
    const summary = lotGroupSummary(
      [
        lot({ id: "a", price: "10.00", catalogPrice: "20.00", costPrice: "4.00", itemCount: 2 }),
        lot({ id: "b", price: "6.00", catalogPrice: "8.00", costPrice: "8.00" }),
        lot({ id: "c", catalogPrice: "5.00" }),
      ],
      "PLN"
    );
    assert.equal(summary.asking.price, "16.00");
    assert.equal(summary.asking.lotCount, 3);
    assert.equal(summary.unpriced, 1);
    assert.equal(summary.sets, 3);
    assert.equal(summary.copies, 4);
    assert.equal(column(summary, "catalogue").amount, "33.00");
    assert.equal(column(summary, "cost").amount, "12.00");
    assert.deepEqual(column(summary, "cost").margin, { amount: "4.00", percent: 33 });
    assert.equal(column(summary, "market").amount, null);
    assert.equal(summary.sold, null);
  });

  it("leaves withdrawn lots out of every figure and count", () => {
    const summary = lotGroupSummary(
      [lot({ id: "a", price: "10.00" }), lot({ id: "b", state: "withdrawn", price: "99.00", costPrice: "1.00" })],
      "PLN"
    );
    assert.equal(summary.asking.price, "10.00");
    assert.equal(summary.asking.lotCount, 1);
    assert.equal(column(summary, "cost").amount, null);
  });

  it("counts a lot left in another currency apart", () => {
    const summary = lotGroupSummary([lot({ id: "a", price: "10.00" }), lot({ id: "b", price: "3.00", currency: "EUR" })], "PLN");
    assert.equal(summary.asking.price, "10.00");
    assert.equal(summary.asking.otherCurrency, 1);
    assert.equal(summary.sets, 1);
  });

  it("says what the sold lots brought in against the cost of the sets sold", () => {
    const summary = lotGroupSummary(
      [
        lot({ id: "a", state: "sold", price: "10.00", costPrice: "4.00", sold: { sets: 1, amount: "12.00" } }),
        lot({ id: "b", state: "active", price: "5.00", costPrice: "2.00", setCount: 3, sold: { sets: 2, amount: "9.00" } }),
        lot({ id: "c", price: "7.00" }),
      ],
      "PLN"
    );
    assert.deepEqual(summary.sold, {
      lots: 2,
      amount: "21.00",
      unconvertible: 0,
      cost: "8.00",
      costLots: 2,
      profit: { amount: "13.00", percent: 163 },
      profitLots: 2,
    });
    // The asking figures stay beside it, every lot not withdrawn at its price.
    assert.equal(summary.asking.price, "22.00");
  });

  it("leaves a sale with no rate out of what was brought in, and a lot with no cost out of the profit", () => {
    const summary = lotGroupSummary(
      [
        lot({ id: "a", state: "sold", price: "10.00", sold: { sets: 1, amount: null } }),
        lot({ id: "b", state: "sold", price: "10.00", sold: { sets: 1, amount: "11.00" } }),
      ],
      "PLN"
    );
    assert.equal(summary.sold!.amount, "11.00");
    assert.equal(summary.sold!.unconvertible, 1);
    assert.equal(summary.sold!.cost, null);
    assert.equal(summary.sold!.profit, null);
  });
});

describe("lotInBase", () => {
  it("carries the prices and every figure into the base currency", () => {
    const converted = lotInBase(
      lot({
        id: "a",
        currency: "EUR",
        price: "10.00",
        catalogPrice: "5.00",
        marketPrice: { amount: "2.50" },
        costPrice: "0.00",
      }),
      "PLN",
      4.25
    );
    assert.equal(converted.currency, "PLN");
    assert.equal(converted.price, "42.50");
    assert.equal(converted.catalogPrice, "21.25");
    assert.equal(converted.marketPrice!.amount, "10.63");
    assert.equal(converted.costPrice, "0.00");
    assert.equal(converted.suggestedPrice, null);
  });

  it("leaves a lot with no rate in its own currency", () => {
    const own = lot({ id: "a", currency: "EUR", price: "10.00" });
    assert.equal(lotInBase(own, "PLN", null), own);
  });
});
