import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildGrowthSeries,
  classifyPurchaseReturns,
  monthKey,
  rollUpAreaCoverage,
  tallyChecklists,
  type ChecklistProgress,
} from "../../src/lib/overview-rules";

describe("buildGrowthSeries", () => {
  const now = new Date(Date.UTC(2026, 7, 27)); // 2026-08-27

  it("fills every month of the window, oldest first, zeroes where nothing happened", () => {
    const series = buildGrowthSeries(
      [{ month: "2026-08", count: 3 }],
      [{ month: "2026-06", count: 1 }],
      3,
      now
    );
    assert.deepEqual(series, [
      { month: "2026-06", copies: 0, issues: 1 },
      { month: "2026-07", copies: 0, issues: 0 },
      { month: "2026-08", copies: 3, issues: 0 },
    ]);
  });

  it("crosses a year boundary without skipping or inventing a month", () => {
    const series = buildGrowthSeries([], [], 3, new Date(Date.UTC(2026, 0, 15)));
    assert.deepEqual(
      series.map((m) => m.month),
      ["2025-11", "2025-12", "2026-01"]
    );
  });

  it("drops buckets outside the window rather than misfiling them", () => {
    const series = buildGrowthSeries([{ month: "2020-01", count: 99 }], [], 2, now);
    assert.equal(series.reduce((sum, m) => sum + m.copies, 0), 0);
  });
});

describe("monthKey", () => {
  it("is the UTC month, not the local one", () => {
    assert.equal(monthKey(new Date(Date.UTC(2026, 11, 31, 23, 59))), "2026-12");
  });
});

describe("tallyChecklists", () => {
  const row = (
    checklistId: string,
    owned: number,
    requiredCount: number
  ): ChecklistProgress => ({ checklistId, issueId: `i-${checklistId}`, name: checklistId, owned, requiredCount });

  it("splits complete, part-done and untouched, skipping empty checklists", () => {
    const tally = tallyChecklists([
      row("done", 5, 5),
      row("half", 2, 5),
      row("none", 0, 5),
      row("empty", 0, 0),
    ]);
    assert.equal(tally.total, 3);
    assert.equal(tally.complete, 1);
    assert.equal(tally.partial, 1);
    assert.equal(tally.untouched, 1);
  });

  it("closest-to-done is the highest fraction below complete", () => {
    const tally = tallyChecklists([row("a", 1, 10), row("b", 4, 5), row("c", 5, 5)]);
    assert.equal(tally.closest?.checklistId, "b");
  });

  it("ties on fraction break to the smaller remaining effort", () => {
    const tally = tallyChecklists([row("big", 8, 16), row("small", 2, 4)]);
    assert.equal(tally.closest?.checklistId, "small");
  });

  it("an untouched-only collection has no closest", () => {
    assert.equal(tallyChecklists([row("a", 0, 3)]).closest, null);
  });
});

describe("rollUpAreaCoverage", () => {
  const areas = [
    { id: "pl", parentId: null, name: "Poland" },
    { id: "gg", parentId: "pl", name: "GG" },
    { id: "de", parentId: null, name: "Germany" },
    { id: "fr", parentId: null, name: "France" },
  ];

  it("attributes an issue to its root area and sums checklists under it", () => {
    const { tracked, untracked } = rollUpAreaCoverage(
      areas,
      [
        { issueId: "i1", areaId: "gg" },
        { issueId: "i2", areaId: "pl" },
        { issueId: "i3", areaId: "de" },
      ],
      [
        { issueId: "i1", owned: 1, requiredCount: 4 },
        { issueId: "i2", owned: 3, requiredCount: 4 },
        { issueId: "i3", owned: 4, requiredCount: 4 },
      ]
    );
    const poland = tracked.find((t) => t.areaId === "pl");
    assert.deepEqual(poland, {
      areaId: "pl",
      name: "Poland",
      owned: 4,
      required: 8,
      checklistCount: 2,
    });
    // Worst-covered first: Poland 4/8 before Germany 4/4.
    assert.deepEqual(
      tracked.map((t) => t.areaId),
      ["pl", "de"]
    );
    assert.deepEqual(untracked, [{ areaId: "fr", name: "France" }]);
  });

  it("an area with checklists never lands in untracked, and empty checklists do not track it", () => {
    const { tracked, untracked } = rollUpAreaCoverage(
      areas,
      [{ issueId: "i1", areaId: "fr" }],
      [{ issueId: "i1", owned: 0, requiredCount: 0 }]
    );
    assert.equal(tracked.length, 0);
    assert.ok(untracked.some((u) => u.areaId === "fr"));
  });

  it("an issue pointing at an unknown area is skipped, not invented", () => {
    const { tracked } = rollUpAreaCoverage(
      areas,
      [{ issueId: "i1", areaId: "ghost" }],
      [{ issueId: "i1", owned: 1, requiredCount: 2 }]
    );
    assert.equal(tracked.length, 0);
  });
});

describe("classifyPurchaseReturns", () => {
  const purchase = (
    netReturn: string,
    totalCostBasis: string,
    realized: string,
    pendingCount = 0
  ) => ({
    realized,
    netReturn,
    spent: { totalCostBasis, knownCount: 1, pendingCount, noneCount: 0 },
  });

  it("splits recouped, outstanding and uncosted", () => {
    const tally = classifyPurchaseReturns([
      purchase("5.00", "10.00", "15.00"),
      purchase("-4.00", "10.00", "6.00"),
      purchase("0.00", "0.00", "0.00"),
    ]);
    assert.equal(tally.measured, 3);
    assert.equal(tally.recouped, 1);
    assert.equal(tally.outstanding, 1);
    assert.equal(tally.uncosted, 1);
    assert.equal(tally.spent, "20.00");
    assert.equal(tally.realized, "21.00");
  });

  it("a purchase that exactly broke even counts as recouped", () => {
    assert.equal(classifyPurchaseReturns([purchase("0.00", "10.00", "10.00")]).recouped, 1);
  });

  it("counts purchases whose spend is not yet final", () => {
    const tally = classifyPurchaseReturns([
      purchase("-2.00", "2.00", "0.00", 3),
      purchase("1.00", "1.00", "2.00"),
    ]);
    assert.equal(tally.pendingCostCount, 1);
  });
});
