import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  fifoOrder,
  formatUnitCost,
  saleSuppliesCost,
  settleSupplyUses,
  suppliesCostIncomplete,
  supplyLineCost,
  supplyStock,
  type SettleLine,
  type SupplyBatch,
  type SupplyTake,
} from "../../src/lib/supply-stock";

// A packing supply's stock, costed FIFO (#1897, ADR-0068), and what sales take from it (#1898).

function batch(
  id: string,
  boughtOn: string,
  quantity: number,
  costBase: number | null,
  createdAt = `${boughtOn}T10:00:00.000Z`
): SupplyBatch {
  return { id, boughtOn, createdAt, quantity, costBase };
}

describe("fifoOrder", () => {
  it("puts the oldest purchase first, then the line written first, then the id", () => {
    const ordered = fifoOrder([
      batch("c", "2026-03-01", 1, 1),
      batch("b", "2026-01-01", 1, 1, "2026-01-01T12:00:00.000Z"),
      batch("a", "2026-01-01", 1, 1, "2026-01-01T09:00:00.000Z"),
      batch("e", "2026-02-01", 1, 1, "2026-02-01T09:00:00.000Z"),
      batch("d", "2026-02-01", 1, 1, "2026-02-01T09:00:00.000Z"),
    ]);
    assert.deepEqual(
      ordered.map((b) => b.id),
      ["a", "b", "d", "e", "c"]
    );
  });
});

describe("supplyStock", () => {
  const batches = [
    batch("new", "2026-05-01", 50, 15),
    batch("old", "2026-01-01", 100, 20),
  ];

  it("with nothing used, holds every batch whole at exactly what it cost", () => {
    const stock = supplyStock(batches, new Map());
    assert.equal(stock.onHand, 150);
    assert.equal(stock.valueBase, 35);
    assert.deepEqual(
      stock.batches.map((b) => [b.id, b.onHand, b.unitCostBase, b.valueBase]),
      [
        ["old", 100, 0.2, 20],
        ["new", 50, 0.3, 15],
      ]
    );
  });

  it("takes what was recorded against each batch, each unit at its own batch's cost", () => {
    const stock = supplyStock(batches, new Map([["old", 100], ["new", 20]]));
    assert.deepEqual(
      stock.batches.map((b) => [b.id, b.onHand, b.valueBase]),
      [
        ["old", 0, 0],
        ["new", 30, 9],
      ]
    );
    assert.equal(stock.onHand, 30);
    assert.equal(stock.valueBase, 9);
  });

  it("never goes below empty", () => {
    const stock = supplyStock(batches, new Map([["old", 1000], ["new", 1000]]));
    assert.equal(stock.onHand, 0);
    assert.equal(stock.valueBase, 0);
  });

  it("states no value when a batch with units left has no base cost, and counts it", () => {
    const stock = supplyStock([batch("old", "2026-01-01", 10, 2), batch("eur", "2026-02-01", 10, null)], new Map());
    assert.equal(stock.valueBase, null);
    assert.equal(stock.unvaluedBatches, 1);
    assert.equal(stock.batches[1].unitCostBase, null);
  });

  it("does not hold a used-up batch without a base cost against the value", () => {
    const stock = supplyStock([batch("eur", "2026-01-01", 10, null), batch("pln", "2026-02-01", 10, 3)], new Map([["eur", 10]]));
    assert.equal(stock.valueBase, 3);
    assert.equal(stock.unvaluedBatches, 0);
  });

  it("rounds what is left of a batch once, from the batch's own cost", () => {
    // 3 units for 1.00: a third of a cent per unit would drift if each unit were rounded.
    const stock = supplyStock([batch("x", "2026-01-01", 3, 1)], new Map([["x", 1]]));
    assert.equal(stock.valueBase, 0.67);
  });

  it("holds nothing and is worth nothing with no batches", () => {
    assert.deepEqual(supplyStock([], new Map()), { batches: [], onHand: 0, valueBase: 0, unvaluedBatches: 0 });
  });
});

describe("supplyStock after a return", () => {
  it("holds an older batch's units given back while a newer one is spent — no replay", () => {
    const stock = supplyStock(
      [batch("old", "2026-01-01", 10, 2), batch("new", "2026-02-01", 10, 3)],
      new Map([["old", 8], ["new", 4]])
    );
    assert.deepEqual(
      stock.batches.map((b) => [b.id, b.onHand]),
      [
        ["old", 2],
        ["new", 6],
      ]
    );
    assert.equal(stock.valueBase, 2.2);
  });
});

function line(id: string, usedOn: string, quantity: number, createdAt = `${usedOn}T10:00:00.000Z`): SettleLine {
  return { id, usedOn, createdAt, quantity };
}

function takes(result: SupplyTake[]): string[] {
  return result.map((t) => `${t.lineId}:${t.batchId}:${t.quantity}`);
}

describe("settleSupplyUses", () => {
  const old = batch("old", "2026-01-01", 3, 0.6);
  const mid = batch("mid", "2026-02-01", 2, 0.5);

  it("takes a new line's units oldest batch first", () => {
    assert.deepEqual(takes(settleSupplyUses([mid, old], [line("a", "2026-03-01", 4)], [])), [
      "a:old:3",
      "a:mid:1",
    ]);
  });

  it("leaves a line short when the stock runs out, holding what there was", () => {
    assert.deepEqual(takes(settleSupplyUses([old], [line("a", "2026-03-01", 5)], [])), ["a:old:3"]);
  });

  it("holds nothing at all for a supply never bought", () => {
    assert.deepEqual(settleSupplyUses([], [line("a", "2026-03-01", 2)], []), []);
  });

  it("keeps every take that still fits exactly where it is", () => {
    // `b` took from mid while old still had units — a return to old must not move it.
    const current = [
      { lineId: "a", batchId: "old", quantity: 1 },
      { lineId: "b", batchId: "mid", quantity: 2 },
    ];
    assert.deepEqual(
      takes(settleSupplyUses([old, mid], [line("a", "2026-03-01", 1), line("b", "2026-03-02", 2)], current)),
      ["a:old:1", "b:mid:2"]
    );
  });

  it("gives back a lowered line's newest units first, so it keeps the cost it took first", () => {
    const current = [
      { lineId: "a", batchId: "old", quantity: 3 },
      { lineId: "a", batchId: "mid", quantity: 1 },
    ];
    assert.deepEqual(takes(settleSupplyUses([old, mid], [line("a", "2026-03-01", 2)], current)), ["a:old:2"]);
  });

  it("covers a short line from new stock — the purchase recorded after the parcel went out", () => {
    const current = [{ lineId: "a", batchId: "old", quantity: 3 }];
    assert.deepEqual(takes(settleSupplyUses([old, mid], [line("a", "2026-03-01", 5)], current)), [
      "a:old:3",
      "a:mid:2",
    ]);
  });

  it("covers the earliest use first when stock arrives for several short lines", () => {
    const lines = [line("late", "2026-04-01", 2), line("early", "2026-03-01", 2)];
    assert.deepEqual(takes(settleSupplyUses([mid], lines, [])), ["early:mid:2"]);
  });

  it("covers a short line from units another line gave back", () => {
    const current = [{ lineId: "b", batchId: "old", quantity: 3 }];
    // `a` was deleted (absent), `b` holds old, `c` was short.
    const lines = [line("b", "2026-03-01", 1), line("c", "2026-03-02", 2)];
    assert.deepEqual(takes(settleSupplyUses([old], lines, current)), ["b:old:1", "c:old:2"]);
  });

  it("gives back the latest line's units when a batch is lowered, and covers them elsewhere", () => {
    const current = [
      { lineId: "a", batchId: "old", quantity: 2 },
      { lineId: "b", batchId: "old", quantity: 1 },
    ];
    const lowered = batch("old", "2026-01-01", 2, 0.4);
    assert.deepEqual(
      takes(settleSupplyUses([lowered, mid], [line("a", "2026-03-01", 2), line("b", "2026-03-02", 1)], current)),
      ["a:old:2", "b:mid:1"]
    );
  });

  it("drops takes from a batch that is gone and re-covers them from the rest", () => {
    const current = [{ lineId: "a", batchId: "gone", quantity: 2 }];
    assert.deepEqual(takes(settleSupplyUses([old], [line("a", "2026-03-01", 2)], current)), ["a:old:2"]);
  });

  it("drops takes of a line that is gone, returning the units", () => {
    const current = [{ lineId: "gone", batchId: "old", quantity: 3 }];
    assert.deepEqual(settleSupplyUses([old], [], current), []);
  });
});

describe("supplyLineCost and saleSuppliesCost", () => {
  it("costs each unit at its own batch's unit cost, rounded once per line", () => {
    const cost = supplyLineCost({
      quantity: 3,
      uses: [
        { quantity: 2, unitCostBase: 1 / 3 },
        { quantity: 1, unitCostBase: 0.25 },
      ],
    });
    assert.deepEqual(cost, { costBase: 0.92, shortUnits: 0, unratedUnits: 0 });
    assert.equal(suppliesCostIncomplete(cost), false);
  });

  it("counts a shortfall and units without a rate, and costs them at nothing", () => {
    const cost = supplyLineCost({
      quantity: 5,
      uses: [
        { quantity: 2, unitCostBase: 0.5 },
        { quantity: 1, unitCostBase: null },
      ],
    });
    assert.deepEqual(cost, { costBase: 1, shortUnits: 2, unratedUnits: 1 });
    assert.equal(suppliesCostIncomplete(cost), true);
  });

  it("adds a sale's lines up exactly, and a sale with none costs nothing", () => {
    assert.deepEqual(
      saleSuppliesCost([
        { quantity: 1, uses: [{ quantity: 1, unitCostBase: 0.333 }] },
        { quantity: 2, uses: [{ quantity: 2, unitCostBase: 0.2 }] },
      ]),
      { costBase: 0.73, shortUnits: 0, unratedUnits: 0 }
    );
    assert.deepEqual(saleSuppliesCost([]), { costBase: 0, shortUnits: 0, unratedUnits: 0 });
  });
});

describe("formatUnitCost", () => {
  it("states a unit cost to the hundredth of a cent", () => {
    assert.equal(formatUnitCost(22 / 100), "0.2200");
    assert.equal(formatUnitCost(1 / 3), "0.3333");
  });
});
