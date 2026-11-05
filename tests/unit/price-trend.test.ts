import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  bringToToday,
  formatTrendRate,
  priceTrendOf,
  TREND_CAP,
  trendAdjustedMedian,
  trendStatement,
  type TrendPoint,
} from "../../src/lib/price-trend";
import { resolveGroupTrend, type RatioObservation } from "../../src/lib/realization-ratio";

// A bid's fair follows the stamp's price trend (#2460): each result brought to today's money by the
// median of the yearly rates of change between every pair of results, and the median taken of those.

const at = (day: string) => new Date(`${day}T00:00:00Z`);
const point = (value: number, day: string): TrendPoint => ({ value, at: at(day) });

/** The issue's own example: a stamp rising every year. */
const RISING = [point(8, "2022-06-01"), point(9, "2023-06-01"), point(10.5, "2024-06-01"), point(12, "2025-06-01")];
const NOW = at("2026-06-01");

describe("priceTrendOf (#2460)", () => {
  it("measures a rising stamp's yearly trend as the median of its pairwise rates", () => {
    const trend = priceTrendOf(RISING);
    assert.ok(trend);
    assert.ok(trend.rate > 0.13 && trend.rate < 0.16, `rate ${trend.rate}`);
    assert.equal(trend.capped, false);
    assert.equal(trend.n, 4);
    assert.equal(trend.earliestAt.getUTCFullYear(), 2022);
    assert.equal(trend.latestAt.getUTCFullYear(), 2025);
  });

  it("brings the example to a fair of about 13.50 against a median of 9.75", () => {
    const trend = priceTrendOf(RISING)!;
    const fair = trendAdjustedMedian(RISING, trend.rate, NOW)!;
    assert.ok(fair > 13.25 && fair < 14, `fair ${fair}`);
    assert.equal(trendAdjustedMedian(RISING, 0, NOW), 9.75);
  });

  it("works both ways: a stamp getting cheaper gets a fair below its median", () => {
    const falling = [point(12, "2022-06-01"), point(10.5, "2023-06-01"), point(9, "2024-06-01"), point(8, "2025-06-01")];
    const trend = priceTrendOf(falling)!;
    assert.ok(trend.rate < 0);
    const fair = trendAdjustedMedian(falling, trend.rate, NOW)!;
    assert.ok(fair < 9.75, `fair ${fair}`);
  });

  it("needs four results", () => {
    assert.equal(priceTrendOf(RISING.slice(1)), null);
  });

  it("needs them spread over twelve months", () => {
    const season = [
      point(8, "2025-01-01"),
      point(9, "2025-04-01"),
      point(10, "2025-08-01"),
      point(11, "2025-12-30"),
    ];
    assert.equal(priceTrendOf(season), null);
    assert.ok(priceTrendOf([...season.slice(0, 3), point(11, "2026-01-01")]));
  });

  it("is held within ±30% a year, and says so", () => {
    const steep = [point(1, "2022-01-01"), point(2, "2023-01-01"), point(4, "2024-01-01"), point(8, "2025-01-01")];
    const trend = priceTrendOf(steep)!;
    assert.equal(trend.rate, TREND_CAP);
    assert.equal(trend.capped, true);
    assert.ok(trend.measuredRate > 0.9);
    const crash = steep.map((p, i) => ({ ...p, value: 8 / 2 ** i }));
    assert.equal(priceTrendOf(crash)!.rate, -TREND_CAP);
  });

  it("is moved by one wild result no further than the median is", () => {
    const flat = [point(10, "2022-01-01"), point(10, "2023-01-01"), point(10, "2024-01-01"), point(10, "2025-01-01")];
    const wild = [...flat.slice(0, 3), point(80, "2025-01-01"), point(10, "2025-06-01")];
    assert.equal(priceTrendOf(flat)!.rate, 0);
    assert.ok(Math.abs(priceTrendOf(wild)!.rate) < 0.01);
  });

  it("leaves out pairs sold at the same moment and results that are not a price", () => {
    const sameDay = [...RISING, point(9, "2023-06-01"), point(0, "2024-01-01"), point(Number.NaN, "2024-02-01")];
    const trend = priceTrendOf(sameDay)!;
    assert.equal(trend.n, 5);
    assert.ok(Number.isFinite(trend.rate));
  });
});

describe("bringToToday (#2460)", () => {
  it("compounds over the years since the result", () => {
    assert.ok(Math.abs(bringToToday(10, at("2024-06-01"), 0.1, at("2026-06-01")) - 12.1) < 0.01);
    assert.equal(bringToToday(10, NOW, 0.3, NOW), 10);
  });
});

describe("trendStatement (#2460)", () => {
  it("states a stamp's own trend with its results and years", () => {
    const trend = priceTrendOf(RISING)!;
    assert.match(trendStatement({ ...trend, borrowed: null }), /^trend \+1[45]%\/yr, 4 results 2022–2025$/);
  });

  it("names a borrowed trend as borrowed, and a capped one as capped", () => {
    assert.equal(
      trendStatement({
        rate: 0.3,
        measuredRate: 0.45,
        capped: true,
        n: 9,
        earliestAt: "2021-03-01T00:00:00.000Z",
        latestAt: "2025-09-01T00:00:00.000Z",
        borrowed: { bucketLabel: "Polska Ludowa, MNH, 1948–1952" },
      }),
      "trend +30%/yr, capped — measured +45%/yr, borrowed from Polska Ludowa, MNH, 1948–1952 (9 results 2021–2025)"
    );
  });

  it("prints a falling rate with a minus and no rate as nought", () => {
    assert.equal(formatTrendRate(-0.08), "−8%/yr");
    assert.equal(formatTrendRate(0.001), "0%/yr");
  });
});

describe("resolveGroupTrend (#2460)", () => {
  let seq = 0;
  const obs = (ratio: number, day: string, overrides: Partial<RatioObservation> = {}): RatioObservation => ({
    source: { kind: "lot", lotId: `lot-${++seq}`, lineId: `line-${seq}` },
    split: false,
    ratio,
    at: at(day),
    areaId: "poland",
    conditionId: "mnh",
    issuedYear: 1950,
    catalogNameId: null,
    ...overrides,
  });
  const subject = { areaId: "poland", conditionId: "mnh", issuedYear: 1950 };
  const rising = (overrides: Partial<RatioObservation> = {}) => [
    obs(0.4, "2022-01-01", overrides),
    obs(0.45, "2023-01-01", overrides),
    obs(0.5, "2024-01-01", overrides),
    obs(0.56, "2025-01-01", overrides),
  ];

  it("reads the group's results as shares of catalogue and takes the period bucket first", () => {
    const group = resolveGroupTrend(subject, rising())!;
    assert.equal(group.level, "area-condition-period");
    assert.equal(group.fromYear, 1948);
    assert.equal(group.toYear, 1952);
    assert.ok(group.trend.rate > 0.1);
  });

  it("falls back to area × condition when the period has too few", () => {
    const group = resolveGroupTrend(subject, rising({ issuedYear: 1970 }))!;
    assert.equal(group.level, "area-condition");
    assert.equal(group.fromYear, null);
  });

  it("borrows nothing from another area, another condition or a stamp with no area", () => {
    assert.equal(resolveGroupTrend(subject, rising({ areaId: "germany" })), null);
    assert.equal(resolveGroupTrend(subject, rising({ conditionId: "used" })), null);
    assert.equal(resolveGroupTrend({ ...subject, areaId: null }, rising()), null);
  });

  it("counts a split lot once", () => {
    const split = rising().map((o) => ({ ...o, split: true, source: { kind: "lot" as const, lotId: "one", lineId: o.source.kind === "lot" ? o.source.lineId : "" } }));
    assert.equal(resolveGroupTrend(subject, split), null);
  });
});
