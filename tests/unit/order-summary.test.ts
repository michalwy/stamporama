import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { orderSummarySetOrder, orderSummaryTotals, sortCopiesInSetOrder } from "../../src/lib/order-summary";

describe("orderSummaryTotals (#2512)", () => {
  it("adds the sets and the handling the buyer paid", () => {
    assert.deepEqual(
      orderSummaryTotals({ setPrices: ["25.00", "12.50"], buyerHandling: "8.90", buyerPaidTotal: null }),
      { items: "37.50", sets: 2, shipping: "8.90", total: "46.40" }
    );
  });

  it("prints shipping as zero when none is recorded", () => {
    assert.deepEqual(orderSummaryTotals({ setPrices: ["10.00"], buyerHandling: null, buyerPaidTotal: null }), {
      items: "10.00",
      sets: 1,
      shipping: "0.00",
      total: "10.00",
    });
  });

  it("derives shipping from a recorded total, held at zero", () => {
    assert.deepEqual(
      orderSummaryTotals({ setPrices: ["0.10", "0.20"], buyerHandling: null, buyerPaidTotal: "5.30" }),
      { items: "0.30", sets: 2, shipping: "5.00", total: "5.30" }
    );
    assert.equal(
      orderSummaryTotals({ setPrices: ["10.00"], buyerHandling: null, buyerPaidTotal: "8.00" }).shipping,
      "0.00"
    );
  });
});

describe("orderSummarySetOrder (#2512)", () => {
  it("keeps an offer's sets together and puts the free extras last", () => {
    const order = orderSummarySetOrder([
      { id: "free", offerId: null, freeExtra: true },
      { id: "a1", offerId: "A", freeExtra: false },
      { id: "b1", offerId: "B", freeExtra: false },
      { id: "a2", offerId: "A", freeExtra: false },
    ]);
    assert.deepEqual(
      [...order.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id),
      ["a1", "a2", "b1", "free"]
    );
  });
});

describe("sortCopiesInSetOrder (#2512)", () => {
  it("follows the hand order, then catalogue order, unknown copies last", () => {
    const copies = [{ id: "x" }, { id: "cat2" }, { id: "hand1" }, { id: "cat1" }, { id: "hand0" }];
    const order = new Map([
      ["hand0", { sortOrder: 0, catalogSortKey: "9" }],
      ["hand1", { sortOrder: 1, catalogSortKey: "1" }],
      ["cat1", { sortOrder: null, catalogSortKey: "00000001" }],
      ["cat2", { sortOrder: null, catalogSortKey: "00000002" }],
    ]);
    assert.deepEqual(
      sortCopiesInSetOrder(copies, order).map((c) => c.id),
      ["hand0", "hand1", "cat1", "cat2", "x"]
    );
  });
});
