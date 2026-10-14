import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ownUseCostByPeriod,
  ownUseCostTotal,
  type OwnUseCostEntry,
} from "../../src/lib/supply-own-use-rules";

// What packing supplies used without a sale cost, by period (#1900, ADR-0068 §9).

function use(usedOn: string, quantity: number, costBase: number, shortUnits = 0, unratedUnits = 0): OwnUseCostEntry {
  return { usedOn, quantity, costBase, shortUnits, unratedUnits };
}

describe("ownUseCostByPeriod", () => {
  const uses = [
    use("2026-03-31", 2, 0.4),
    use("2025-12-01", 1, 1),
    use("2026-03-01", 3, 0.1, 1),
    use("2026-01-15", 5, 0.25, 0, 2),
  ];

  it("groups by month, oldest first, summing in cents and counting what is left out", () => {
    assert.deepEqual(ownUseCostByPeriod(uses, "month"), [
      { key: "2025-12", label: "December 2025", uses: 1, quantity: 1, costBase: 1, shortUnits: 0, unratedUnits: 0 },
      { key: "2026-01", label: "January 2026", uses: 1, quantity: 5, costBase: 0.25, shortUnits: 0, unratedUnits: 2 },
      { key: "2026-03", label: "March 2026", uses: 2, quantity: 5, costBase: 0.5, shortUnits: 1, unratedUnits: 0 },
    ]);
  });

  it("groups by year", () => {
    assert.deepEqual(
      ownUseCostByPeriod(uses, "year").map((p) => [p.key, p.label, p.uses, p.quantity, p.costBase]),
      [
        ["2025", "2025", 1, 1, 1],
        ["2026", "2026", 3, 10, 0.75],
      ]
    );
  });

  it("puts a use on the last day of a month in that month, whatever the clock's zone", () => {
    assert.deepEqual(
      ownUseCostByPeriod([use("2026-01-31", 1, 0.1)], "month").map((p) => p.key),
      ["2026-01"]
    );
  });

  it("adds figures in cents, so 0.1 + 0.2 is 0.3", () => {
    assert.equal(ownUseCostTotal([use("2026-01-01", 1, 0.1), use("2026-01-02", 1, 0.2)]).costBase, 0.3);
  });

  it("lists no period, and totals nothing, without uses", () => {
    assert.deepEqual(ownUseCostByPeriod([], "month"), []);
    assert.deepEqual(ownUseCostTotal([]), { costBase: 0, quantity: 0, shortUnits: 0, unratedUnits: 0 });
  });
});
