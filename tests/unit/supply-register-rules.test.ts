import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  filterSupplyMovements,
  runningSupplyStock,
  supplyMovementTotals,
  supplyMovements,
  supplyMovementsByMonth,
  type RegisterSupplyInput,
} from "../../src/lib/supply-register-rules";

// The register of packing-supply movements (#2196): every batch bought and every use, newest first,
// filtered, totalled, grouped by month, and one supply's running stock. It replaced the *Used outside
// sales* table (#1900), so narrowed to that type and grouped by month it must give that table's
// figures — the last case pins the cases the old table's own test did.

function own(id: string, usedOn: string, quantity: number, costBase: string, shortUnits = 0, unratedUnits = 0) {
  return {
    kind: "own" as const,
    id,
    usedOn,
    recordedAt: `${usedOn}T10:00:00.000Z`,
    quantity,
    note: id === "o1" ? "storage box" : null,
    costBase,
    shortUnits,
    unratedUnits,
  };
}

const envelopes: RegisterSupplyInput = {
  id: "env",
  name: "C6 envelope",
  batches: [
    {
      id: "b1",
      purchase: { id: "p1", purchaseNo: 135, kind: "purchase", name: "NOWANO", purchasedAt: "2026-01-10" },
      quantity: 10,
      recordedAt: "2026-01-10T09:00:00.000Z",
      unitCostBase: "0.2000",
      costBase: "2.00",
    },
    {
      id: "b2",
      purchase: { id: "p2", purchaseNo: 140, kind: "purchase", name: "Foreign shop", purchasedAt: "2026-03-01" },
      quantity: 4,
      recordedAt: "2026-03-01T09:00:00.000Z",
      unitCostBase: null,
      costBase: null,
    },
  ],
  history: [
    {
      kind: "sale",
      id: "sl1",
      usedOn: "2026-02-05",
      recordedAt: "2026-02-05T12:00:00.000Z",
      quantity: 3,
      sale: { id: "s39", saleNo: 39, platformName: "Allegro", buyerName: "Jan Kowalski" },
      costBase: "0.60",
      shortUnits: 0,
      unratedUnits: 0,
    },
    own("o1", "2026-02-05", 2, "0.40"),
  ],
};

const cards: RegisterSupplyInput = {
  id: "card",
  name: "Transport card",
  batches: [],
  history: [own("o2", "2026-03-15", 5, "0.00", 5)],
};

const all = supplyMovements([envelopes, cards]);

describe("supplyMovements", () => {
  it("lists every batch and use, newest first, signed, a day's later write first", () => {
    assert.deepEqual(
      all.map((m) => [m.key, m.date, m.units]),
      [
        ["own:o2", "2026-03-15", -5],
        ["bought:b2", "2026-03-01", 4],
        ["sale:sl1", "2026-02-05", -3],
        ["own:o1", "2026-02-05", -2],
        ["bought:b1", "2026-01-10", 10],
      ]
    );
  });

  it("costs a batch at its cost, and one without a rate as wholly unrated", () => {
    const b1 = all.find((m) => m.key === "bought:b1")!;
    assert.equal(b1.costBase, 2);
    assert.equal(b1.unitCostBase, "0.2000");
    const b2 = all.find((m) => m.key === "bought:b2")!;
    assert.deepEqual([b2.costBase, b2.unratedUnits, b2.unitCostBase], [0, 4, null]);
  });

  it("states a use's unit cost only when every unit has one", () => {
    assert.equal(all.find((m) => m.key === "sale:sl1")!.unitCostBase, "0.2000");
    assert.equal(all.find((m) => m.key === "own:o2")!.unitCostBase, null);
  });
});

describe("filterSupplyMovements", () => {
  const keys = (f: Parameters<typeof filterSupplyMovements>[1]) => filterSupplyMovements(all, f).map((m) => m.key);
  const none = { supplyIds: [], kinds: [] };

  it("narrows nothing with nothing said", () => {
    assert.equal(keys(none).length, all.length);
  });

  it("narrows by supply and by type, several of each", () => {
    assert.deepEqual(keys({ ...none, supplyIds: ["card"] }), ["own:o2"]);
    assert.deepEqual(keys({ ...none, kinds: ["bought", "sale"] }), ["bought:b2", "sale:sl1", "bought:b1"]);
  });

  it("narrows by an inclusive date span", () => {
    assert.deepEqual(keys({ ...none, from: "2026-02-05", to: "2026-03-01" }), ["bought:b2", "sale:sl1", "own:o1"]);
  });

  it("searches documents, suppliers, buyers and notes, without regard to case", () => {
    assert.deepEqual(keys({ ...none, text: "nowano" }), ["bought:b1"]);
    assert.deepEqual(keys({ ...none, text: "#135" }), ["bought:b1"]);
    assert.deepEqual(keys({ ...none, text: "sale #39" }), ["sale:sl1"]);
    assert.deepEqual(keys({ ...none, text: "kowalski" }), ["sale:sl1"]);
    assert.deepEqual(keys({ ...none, text: "STORAGE" }), ["own:o1"]);
  });
});

describe("runningSupplyStock", () => {
  it("is the stock after each movement of one supply, oldest first", () => {
    const running = runningSupplyStock(all, "env");
    assert.deepEqual(
      [...running.entries()],
      [
        ["bought:b1", 10],
        ["own:o1", 8],
        ["sale:sl1", 5],
        ["bought:b2", 9],
      ]
    );
  });

  it("goes below zero by what the supply owes", () => {
    assert.deepEqual([...runningSupplyStock(all, "card").values()], [-5]);
  });
});

describe("supplyMovementTotals", () => {
  it("adds units and cost in and out, counting what the cost leaves out", () => {
    assert.deepEqual(supplyMovementTotals(all), {
      movements: 5,
      unitsIn: 14,
      unitsOut: 10,
      costIn: { costBase: 2, shortUnits: 0, unratedUnits: 4 },
      costOut: { costBase: 1, shortUnits: 5, unratedUnits: 0 },
    });
  });
});

describe("supplyMovementsByMonth", () => {
  it("groups newest month first, each with its own totals", () => {
    assert.deepEqual(
      supplyMovementsByMonth(all).map((m) => [m.key, m.label, m.movements.length, m.totals.unitsIn, m.totals.unitsOut]),
      [
        ["2026-03", "March 2026", 2, 4, 5],
        ["2026-02", "February 2026", 2, 0, 5],
        ["2026-01", "January 2026", 1, 10, 0],
      ]
    );
  });

  it("narrowed to uses outside sales, gives the old monthly table's figures, summed in cents", () => {
    const uses: RegisterSupplyInput = {
      id: "x",
      name: "X",
      batches: [],
      history: [
        own("a", "2026-03-31", 2, "0.40"),
        own("b", "2025-12-01", 1, "1.00"),
        own("c", "2026-03-01", 3, "0.10", 1),
        own("d", "2026-01-15", 5, "0.25", 0, 2),
      ],
    };
    const rows = filterSupplyMovements(supplyMovements([uses]), { supplyIds: [], kinds: ["own"] });
    assert.deepEqual(
      supplyMovementsByMonth(rows).map((m) => [m.key, m.totals.movements, m.totals.unitsOut, m.totals.costOut]),
      [
        ["2026-03", 2, 5, { costBase: 0.5, shortUnits: 1, unratedUnits: 0 }],
        ["2026-01", 1, 5, { costBase: 0.25, shortUnits: 0, unratedUnits: 2 }],
        ["2025-12", 1, 1, { costBase: 1, shortUnits: 0, unratedUnits: 0 }],
      ]
    );
  });
});
