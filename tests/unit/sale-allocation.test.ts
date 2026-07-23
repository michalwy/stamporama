import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  distributeSaleShared,
  allocateSaleLine,
  allocateSale,
  itemProfitLoss,
  SaleLineBlockedError,
  type SaleSharedAmounts,
  type SaleLineItemInput,
  type SaleLineWithItems,
} from "../../src/lib/sale-allocation";

// Helpers -------------------------------------------------------------------

const NO_SHARED: Omit<SaleSharedAmounts, "fxRateToBase"> = {
  buyerHandling: 0,
  shippingBase: 0,
  commission: 0,
};

function lineItem(id: string, catalogPrice: number | null): SaleLineItemInput {
  return { id, catalogPrice };
}

/** Sum of money amounts in whole cents (avoids float compares). */
function sumCents(values: number[]): number {
  return values.reduce((s, v) => s + Math.round(v * 100), 0);
}

// Shared-amount distribution (ADR-0012 §6.1) --------------------------------

describe("distributeSaleShared", () => {
  it("splits shared amounts by sale price; buyer-side net in tx, shipping deducted in base", () => {
    const shared: SaleSharedAmounts = {
      buyerHandling: 5,
      shippingBase: 4, // already base; fxRateToBase null → base == transaction (rate 1)
      commission: 3,
      fxRateToBase: null,
    };
    const nets = distributeSaleShared(shared, [
      { id: "a", price: 60 },
      { id: "b", price: 30 },
      { id: "c", price: 10 },
    ]);

    // Each shared amount ties out exactly to its total.
    assert.equal(sumCents(nets.map((n) => n.handlingShare)), 500);
    assert.equal(sumCents(nets.map((n) => n.shippingBaseShare)), 400);
    assert.equal(sumCents(nets.map((n) => n.commissionShare)), 300);

    // Buyer-side net (tx) excludes shipping. Line A (60%): 60 + 3.00 − 1.80 → 61.20.
    assert.deepEqual(
      nets.map((n) => [n.id, n.netTx]),
      [
        ["a", 61.2],
        ["b", 30.6],
        ["c", 10.2],
      ]
    );
    // Base net subtracts my shipping share. Line A: 61.20 − 2.40 → 58.80.
    assert.deepEqual(
      nets.map((n) => [n.id, n.netBase]),
      [
        ["a", 58.8],
        ["b", 29.4],
        ["c", 9.8],
      ]
    );
    // Whole-sale base net = total price + handling − commission − shipping = 100 + 5 − 3 − 4 = 98.
    assert.equal(sumCents(nets.map((n) => n.netBase)), 9800);
  });

  it("applies the frozen FX rate to the base-currency net", () => {
    const shared: SaleSharedAmounts = { ...NO_SHARED, fxRateToBase: 4 };
    const [net] = distributeSaleShared(shared, [{ id: "a", price: 12.5 }]);
    assert.equal(net.netTx, 12.5);
    assert.equal(net.netBase, 50);
  });

  it("a line's base net can go negative when costs exceed its price", () => {
    const shared: SaleSharedAmounts = {
      buyerHandling: 0,
      shippingBase: 5,
      commission: 5,
      fxRateToBase: null,
    };
    const [net] = distributeSaleShared(shared, [{ id: "a", price: 8 }]);
    assert.equal(net.netTx, 3); // buyer-side: 8 − 5 commission
    assert.equal(net.netBase, -2); // − 5 shipping (base)
  });

  it("distributes leftover cents by largest remainder and ties out exactly", () => {
    const shared: SaleSharedAmounts = {
      buyerHandling: 10,
      shippingBase: 0,
      commission: 0,
      fxRateToBase: null,
    };
    const nets = distributeSaleShared(shared, [
      { id: "a", price: 1 },
      { id: "b", price: 1 },
      { id: "c", price: 1 },
    ]);
    // 10 / 3 = 3.33 each with one leftover cent → 3.34, 3.33, 3.33.
    assert.deepEqual(
      nets.map((n) => n.handlingShare),
      [3.34, 3.33, 3.33]
    );
    assert.equal(sumCents(nets.map((n) => n.handlingShare)), 1000);
  });
});

// Per-item proceeds split (ADR-0012 §6.3) -----------------------------------

describe("allocateSaleLine", () => {
  it("gives the whole net to a single item regardless of catalog price", () => {
    assert.deepEqual(allocateSaleLine(42.5, [lineItem("i1", null)]), [
      { itemId: "i1", proceeds: 42.5 },
    ]);
  });

  it("splits a komplet's net across items by catalog-price weight, exact to the cent", () => {
    const items = [lineItem("i1", 30), lineItem("i2", 10)];
    const shares = allocateSaleLine(100, items);
    assert.deepEqual(shares, [
      { itemId: "i1", proceeds: 75 },
      { itemId: "i2", proceeds: 25 },
    ]);
    assert.equal(sumCents(shares.map((s) => s.proceeds)), 10000);
  });

  it("splits a negative net (a loss line) across items and ties out exactly", () => {
    const items = [lineItem("i1", 2), lineItem("i2", 1)];
    const shares = allocateSaleLine(-3, items);
    assert.deepEqual(shares, [
      { itemId: "i1", proceeds: -2 },
      { itemId: "i2", proceeds: -1 },
    ]);
    assert.equal(sumCents(shares.map((s) => s.proceeds)), -300);
  });

  it("blocks a multi-item line when an item lacks a catalog price", () => {
    try {
      allocateSaleLine(50, [lineItem("i1", 10), lineItem("i2", null)]);
      assert.fail("expected SaleLineBlockedError");
    } catch (err) {
      assert.ok(err instanceof SaleLineBlockedError);
      assert.equal(err.reason, "missing-price");
      assert.deepEqual(err.itemIds, ["i2"]);
    }
  });

  it("blocks a multi-item line with a non-zero net but all-zero weights", () => {
    try {
      allocateSaleLine(50, [lineItem("i1", 0), lineItem("i2", 0)]);
      assert.fail("expected SaleLineBlockedError");
    } catch (err) {
      assert.ok(err instanceof SaleLineBlockedError);
      assert.equal(err.reason, "zero-weight");
      assert.deepEqual(err.itemIds, ["i1", "i2"]);
    }
  });

  it("a zero net with all-zero weights splits to zeros without blocking", () => {
    assert.deepEqual(allocateSaleLine(0, [lineItem("i1", 0), lineItem("i2", 0)]), [
      { itemId: "i1", proceeds: 0 },
      { itemId: "i2", proceeds: 0 },
    ]);
  });
});

// Whole-sale allocation (ADR-0012 §6) ---------------------------------------

describe("allocateSale", () => {
  it("single-line, single-item sale attributes the full net to the copy", () => {
    const lines: SaleLineWithItems[] = [
      { id: "l1", price: 20, items: [lineItem("i1", null)] },
    ];
    const shared: SaleSharedAmounts = {
      buyerHandling: 3,
      shippingBase: 2,
      commission: 1,
      fxRateToBase: null,
    };
    assert.deepEqual(allocateSale(shared, lines), [
      { itemId: "i1", lineId: "l1", proceeds: 20 },
    ]);
  });

  it("multi-line sale keeps lines independent (partial quantity-lot sale)", () => {
    // A quantity lot sold partially: two sub-lots go, each its own line, each a single copy.
    const lines: SaleLineWithItems[] = [
      { id: "sub-1", price: 15, items: [lineItem("i1", null)] },
      { id: "sub-2", price: 5, items: [lineItem("i2", null)] },
    ];
    const shared: SaleSharedAmounts = {
      buyerHandling: 0,
      shippingBase: 4,
      commission: 0,
      fxRateToBase: null,
    };
    const results = allocateSale(shared, lines);
    // Shipping 4 split 15:5 → 3 and 1; nets 12 and 4.
    assert.deepEqual(results, [
      { itemId: "i1", lineId: "sub-1", proceeds: 12 },
      { itemId: "i2", lineId: "sub-2", proceeds: 4 },
    ]);
    assert.equal(sumCents(results.map((r) => r.proceeds)), 1600);
  });

  it("multi-line with a multi-item komplet line splits by catalog weight", () => {
    const lines: SaleLineWithItems[] = [
      { id: "solo", price: 40, items: [lineItem("i1", null)] },
      { id: "komplet", price: 60, items: [lineItem("i2", 20), lineItem("i3", 10)] },
    ];
    const shared: SaleSharedAmounts = { ...NO_SHARED, fxRateToBase: null };
    const results = allocateSale(shared, lines);
    assert.deepEqual(results, [
      { itemId: "i1", lineId: "solo", proceeds: 40 },
      { itemId: "i2", lineId: "komplet", proceeds: 40 },
      { itemId: "i3", lineId: "komplet", proceeds: 20 },
    ]);
  });

  it("applies the frozen FX rate end to end", () => {
    const lines: SaleLineWithItems[] = [
      { id: "l1", price: 10, items: [lineItem("i1", null)] },
    ];
    const shared: SaleSharedAmounts = { ...NO_SHARED, fxRateToBase: 4.2 };
    assert.deepEqual(allocateSale(shared, lines), [
      { itemId: "i1", lineId: "l1", proceeds: 42 },
    ]);
  });
});

// Profit / loss (ADR-0012 §6.4) ---------------------------------------------

describe("itemProfitLoss", () => {
  it("is proceeds minus cost-basis", () => {
    assert.equal(itemProfitLoss(50, 30), 20);
    assert.equal(itemProfitLoss(30, 50), -20);
  });

  it("is null when the cost-basis is pending", () => {
    assert.equal(itemProfitLoss(50, null), null);
  });

  it("rounds to the cent", () => {
    assert.equal(itemProfitLoss(10.1, 3.05), 7.05);
  });
});
