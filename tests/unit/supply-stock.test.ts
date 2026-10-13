import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fifoOrder, fifoSupplyStock, formatUnitCost, type SupplyBatch } from "../../src/lib/supply-stock";

// A packing supply's stock, costed FIFO (#1897, ADR-0068).

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

describe("fifoSupplyStock", () => {
  const batches = [
    batch("new", "2026-05-01", 50, 15),
    batch("old", "2026-01-01", 100, 20),
  ];

  it("with nothing used, holds every batch whole at exactly what it cost", () => {
    const stock = fifoSupplyStock(batches, 0);
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

  it("uses the oldest batch first, each unit at its own batch's cost", () => {
    const stock = fifoSupplyStock(batches, 120);
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
    const stock = fifoSupplyStock(batches, 1000);
    assert.equal(stock.onHand, 0);
    assert.equal(stock.valueBase, 0);
  });

  it("states no value when a batch with units left has no base cost, and counts it", () => {
    const stock = fifoSupplyStock([batch("old", "2026-01-01", 10, 2), batch("eur", "2026-02-01", 10, null)], 0);
    assert.equal(stock.valueBase, null);
    assert.equal(stock.unvaluedBatches, 1);
    assert.equal(stock.batches[1].unitCostBase, null);
  });

  it("does not hold a used-up batch without a base cost against the value", () => {
    const stock = fifoSupplyStock([batch("eur", "2026-01-01", 10, null), batch("pln", "2026-02-01", 10, 3)], 10);
    assert.equal(stock.valueBase, 3);
    assert.equal(stock.unvaluedBatches, 0);
  });

  it("rounds what is left of a batch once, from the batch's own cost", () => {
    // 3 units for 1.00: a third of a cent per unit would drift if each unit were rounded.
    const stock = fifoSupplyStock([batch("x", "2026-01-01", 3, 1)], 1);
    assert.equal(stock.valueBase, 0.67);
  });

  it("holds nothing and is worth nothing with no batches", () => {
    assert.deepEqual(fifoSupplyStock([], 0), { batches: [], onHand: 0, valueBase: 0, unvaluedBatches: 0 });
  });
});

describe("formatUnitCost", () => {
  it("states a unit cost to the hundredth of a cent", () => {
    assert.equal(formatUnitCost(22 / 100), "0.2200");
    assert.equal(formatUnitCost(1 / 3), "0.3333");
  });
});
