import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildProfitAndLoss,
  dateRangeBounds,
  describeWriteOffLeftOut,
  parseDateRange,
  periodKey,
  periodLabel,
  summarizeWriteOffs,
  type SaleFigureInput,
  type WriteOffCopy,
} from "../../src/lib/profit-and-loss-rules";
import type { ProfitFigures } from "../../src/lib/sale-profit";

// The profit and loss screen's grouping (#1305): each sale arrives with its own figure (#168), and
// what these cases pin down is how periods, platforms and write-offs add up — and that a copy that
// cannot be counted stays counted apart rather than read as zero.

const NONE = { costPending: 0, noCost: 0, noRate: 0, unsplittable: 0 };

function figures(proceeds: string, cost: string, copies = 1): ProfitFigures {
  return {
    copyCount: copies,
    countedCount: copies,
    leftOut: NONE,
    proceeds,
    cost,
    profit: (Number(proceeds) - Number(cost)).toFixed(2),
  };
}

const NO_RATE: ProfitFigures = {
  copyCount: 2,
  countedCount: 0,
  leftOut: { ...NONE, noRate: 2 },
  proceeds: null,
  cost: null,
  profit: null,
};

function sale(soldAt: string, platform: string, profit: ProfitFigures): SaleFigureInput {
  return { soldAt, platformId: platform, platformName: platform.toUpperCase(), profit };
}

function writeOff(disposedAt: string, costBasis: string | null, lotStatus = "closed"): WriteOffCopy {
  return { disposedAt, costBasis, lotId: "lot", lotStatus };
}

describe("date range", () => {
  it("keeps real calendar days and drops anything else", () => {
    assert.deepEqual(parseDateRange("2026-02-01", "2026-02-28"), { from: "2026-02-01", to: "2026-02-28" });
    assert.deepEqual(parseDateRange("2026-02-30", "garbage"), { from: null, to: null });
    assert.deepEqual(parseDateRange(null, undefined), { from: null, to: null });
  });

  it("ends the range at the midnight after its last day", () => {
    const bounds = dateRangeBounds({ from: "2026-01-01", to: "2026-01-31" });
    assert.equal(bounds.gte!.toISOString(), "2026-01-01T00:00:00.000Z");
    assert.equal(bounds.lt!.toISOString(), "2026-02-01T00:00:00.000Z");
    assert.deepEqual(dateRangeBounds({ from: null, to: null }), {});
  });
});

describe("periods", () => {
  it("buckets by UTC month and year, and names them", () => {
    assert.equal(periodKey("2026-03-31T23:59:59.000Z", "month"), "2026-03");
    assert.equal(periodKey(new Date("2026-03-01"), "year"), "2026");
    assert.equal(periodLabel("2026-03"), "March 2026");
    assert.equal(periodLabel("2026"), "2026");
  });
});

describe("write-offs", () => {
  it("sums known cost and counts pending and unrecorded copies apart", () => {
    const summary = summarizeWriteOffs([
      writeOff("2026-01-10", "4.00"),
      writeOff("2026-01-11", "1.50"),
      writeOff("2026-01-12", null, "open"),
      { costBasis: null, lotId: null, lotStatus: null },
    ]);
    assert.deepEqual(summary, { copyCount: 4, countedCount: 2, costPending: 1, noCost: 1, cost: "5.50" });
    assert.deepEqual(describeWriteOffLeftOut(summary), ["1 with cost pending", "1 with no cost recorded"]);
  });
});

describe("buildProfitAndLoss", () => {
  const sales = [
    sale("2026-01-05", "delcampe", figures("30.00", "10.00", 2)),
    sale("2026-01-20", "allegro", figures("5.00", "8.00")),
    sale("2026-03-01", "delcampe", NO_RATE),
    sale("2025-12-31", "allegro", figures("12.00", "2.00")),
  ];
  const writeOffs = [
    writeOff("2026-01-31T22:00:00.000Z", "4.00"),
    writeOff("2026-02-14T10:00:00.000Z", null, "open"),
  ];

  it("totals the sales as their own figures added up, less the write-off cost", () => {
    const { total } = buildProfitAndLoss(sales, writeOffs, "month");
    assert.equal(total.saleCount, 4);
    assert.equal(total.sales.proceeds, "47.00");
    assert.equal(total.sales.cost, "20.00");
    assert.equal(total.sales.profit, "27.00");
    assert.equal(total.sales.leftOut.noRate, 2);
    assert.equal(total.writeOff.cost, "4.00");
    assert.equal(total.writeOff.costPending, 1);
    assert.equal(total.result, "23.00");
  });

  it("puts each sale and write-off in its own month, oldest first", () => {
    const { periods } = buildProfitAndLoss(sales, writeOffs, "month");
    assert.deepEqual(
      periods.map((p) => [p.key, p.saleCount, p.sales.profit, p.writeOff.cost, p.result]),
      [
        ["2025-12", 1, "10.00", "0.00", "10.00"],
        ["2026-01", 2, "17.00", "4.00", "13.00"],
        // A write-off with its cost pending adds no loss, and a month with nothing else counted in
        // it has no result — its one copy is left out, and zero would claim a figure.
        ["2026-02", 0, "0.00", "0.00", null],
        // A month whose one sale has no rate has no figure at all — never a zero.
        ["2026-03", 1, null, "0.00", null],
      ]
    );
    assert.equal(periods[2].writeOff.costPending, 1);
  });

  it("adds the months up to the years", () => {
    const { periods } = buildProfitAndLoss(sales, writeOffs, "year");
    assert.deepEqual(
      periods.map((p) => [p.label, p.saleCount, p.sales.profit, p.result]),
      [
        ["2025", 1, "10.00", "10.00"],
        ["2026", 3, "17.00", "13.00"],
      ]
    );
  });

  it("groups sales by platform, by name, and leaves write-offs out of every platform", () => {
    const { platforms } = buildProfitAndLoss(sales, writeOffs, "month");
    assert.deepEqual(
      platforms.map((p) => [p.platformName, p.saleCount, p.sales.profit, p.sales.leftOut.noRate]),
      [
        ["ALLEGRO", 2, "7.00", 0],
        ["DELCAMPE", 2, "20.00", 2],
      ]
    );
  });

  it("states a result from the write-offs alone when no sale can be counted", () => {
    const { total } = buildProfitAndLoss([sale("2026-03-01", "delcampe", NO_RATE)], [writeOff("2026-03-02", "3.00")], "month");
    assert.equal(total.sales.profit, null);
    assert.equal(total.result, "-3.00");
  });

  it("is an empty zero over an empty scope", () => {
    const empty = buildProfitAndLoss([], [], "month");
    assert.equal(empty.total.result, "0.00");
    assert.deepEqual(empty.periods, []);
    assert.deepEqual(empty.platforms, []);
  });
});
