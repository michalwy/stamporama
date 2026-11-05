import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyMarketTrend, marketTrendOf, type MarketTrendValue } from "../../src/lib/market-trend";
import { marketKeyOf } from "../../src/lib/market-value";
import type { BorrowedTrend } from "../../src/lib/realization-ratios";

// One key's results brought to today's money (#2460) — the rule the bid anchor and the offer's
// Market trend row (#2461) share — and one copy as the Market trend row counts it.

const at = (day: string) => new Date(`${day}T00:00:00Z`);
const NOW = at("2026-06-01");

/** The #2460 example: a stamp rising every year, median 9.75. */
const RISING: MarketTrendValue = {
  median: "9.75",
  lots: [
    { amount: "8.00", endsAt: at("2022-06-01") },
    { amount: "9.00", endsAt: at("2023-06-01") },
  ],
  observations: [
    { amount: "10.50", soldOn: at("2024-06-01") },
    { amount: "12.00", soldOn: at("2025-06-01") },
  ],
};
const THIN: MarketTrendValue = { median: "5.00", lots: [{ amount: "5.00", endsAt: at("2025-01-01") }], observations: [] };

const noGroup = { trend: () => null };
const group = (rate: number): { trend: () => BorrowedTrend } => ({
  trend: () => ({
    level: "area-condition",
    fromYear: null,
    toYear: null,
    bucketLabel: "Polska Ludowa, MNH",
    trend: { rate, measuredRate: rate, capped: false, n: 9, earliestAt: at("2021-01-01"), latestAt: at("2025-01-01") },
  }),
});
const subject = { areaId: "area", conditionId: "mnh", issuedYear: 1950 };

describe("marketTrendOf (#2460)", () => {
  it("trends a key on its own results when they are enough", () => {
    const trend = marketTrendOf(RISING, subject, group(0.5), NOW);
    assert.ok(trend);
    assert.equal(trend.borrowed, null);
    assert.ok(Number(trend.fair) > 13.25 && Number(trend.fair) < 14, trend.fair);
  });

  it("borrows the group's when its own are too few, and has none without one", () => {
    const trend = marketTrendOf(THIN, subject, group(0.1), NOW);
    assert.ok(trend);
    assert.deepEqual(trend.borrowed, { level: "area-condition", bucketLabel: "Polska Ludowa, MNH" });
    assert.ok(Number(trend.fair) > 5);
    assert.equal(marketTrendOf(THIN, subject, noGroup, NOW), null);
  });
});

describe("copyMarketTrend (#2461)", () => {
  const key = { stampId: "s1", conditionId: "mnh", certificateStatusId: null, formatId: null };
  const copy = { ...key, candidateStampIds: null, areaId: "area", issuedYear: 1950 };
  const values = new Map([[marketKeyOf(key), RISING]]);
  const same = (amount: number) => amount;

  it("gives the plain median and the trended figure, both lowered for faults the same way", () => {
    const input = copyMarketTrend(copy, values, noGroup, NOW, (amount) => amount / 2);
    assert.ok(input && input.trend);
    assert.equal(input.market, 4.875);
    assert.ok(input.trended > 6.6 && input.trended < 7, String(input.trended));
    assert.equal(input.trend.borrowed, null);
  });

  it("counts a copy with results but no trend at its median", () => {
    const thin = new Map([[marketKeyOf(key), THIN]]);
    assert.deepEqual(copyMarketTrend(copy, thin, noGroup, NOW, same), { market: 5, trended: 5, trend: null });
  });

  it("has nothing for a copy without results, or without a condition", () => {
    assert.equal(copyMarketTrend(copy, new Map(), noGroup, NOW, same), null);
    assert.equal(copyMarketTrend({ ...copy, conditionId: null }, values, noGroup, NOW, same), null);
  });

  it("values a candidate copy at the lowest of its candidates, and at nothing when one has none", () => {
    const other = { ...key, stampId: "s2" };
    const both = new Map([...values, [marketKeyOf(other), THIN]]);
    const candidate = { ...copy, candidateStampIds: ["s1", "s2"] };
    assert.deepEqual(copyMarketTrend(candidate, both, noGroup, NOW, same), { market: 5, trended: 5, trend: null });
    assert.equal(copyMarketTrend(candidate, values, noGroup, NOW, same), null);
  });
});
