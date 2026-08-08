import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  aggregateMarketDatapoints,
  extractMarketDatapoints,
  marketConfidence,
  marketKeyOf,
  realizationRatio,
  valuateMarket,
  type MarketAggregate,
  type MarketLotInput,
  type MarketLotLineInput,
} from "../../src/lib/market-value";

// Market valuation from recorded auction results (#455; ADR-0022). Everything here is arithmetic on
// figures the caller has already resolved, which is the whole reason the module is pure.

const NOW = new Date("2026-06-01T00:00:00Z");
const RECENT = new Date("2026-01-15T00:00:00Z");

let seq = 0;

/** One line, with the parts a test does not care about filled in. */
function line(overrides: Partial<MarketLotLineInput> = {}): MarketLotLineInput {
  return {
    lineId: `line-${++seq}`,
    stampId: "stamp-a",
    conditionId: "mnh",
    certificateStatusId: null,
    formatId: null,
    quantity: 1,
    unitCatalogueValue: null,
    ...overrides,
  };
}

/** A closed lot in the base currency, which is the ordinary case. */
function lot(finalPrice: string | null, lines: MarketLotLineInput[], overrides: Partial<MarketLotInput> = {}): MarketLotInput {
  return {
    lotId: `lot-${++seq}`,
    status: "closed",
    endsAt: RECENT,
    finalPrice,
    fxRateToBase: null,
    inBaseCurrency: true,
    lines,
    ...overrides,
  };
}

// Extraction (§2, §3) --------------------------------------------------------

describe("extractMarketDatapoints", () => {
  it("takes a single-line lot whole, per unit, with no catalogue price needed", () => {
    const points = extractMarketDatapoints([lot("120.00", [line({ quantity: 3 })])]);
    assert.equal(points.length, 1);
    assert.equal(points[0].amount, 40);
    assert.equal(points[0].split, false);
    // The date of the datapoint is the lot's own closing time, not today.
    assert.equal(points[0].at.getTime(), RECENT.getTime());
  });

  it("counts won, lost and observed lots alike — the derived outcome is not consulted", () => {
    // The three differ only in `myBid` / `wonTie`, which this module is not even given: all that
    // reaches it is a closed lot with a price, which is what a market result is.
    const points = extractMarketDatapoints([
      lot("10.00", [line()]),
      lot("20.00", [line()]),
      lot("30.00", [line()]),
    ]);
    assert.deepEqual(points.map((p) => p.amount), [10, 20, 30]);
  });

  it("yields nothing from an open, cancelled or price-less lot", () => {
    assert.deepEqual(extractMarketDatapoints([lot("10.00", [line()], { status: "open" })]), []);
    assert.deepEqual(extractMarketDatapoints([lot("10.00", [line()], { status: "cancelled" })]), []);
    // A closed lot that simply vanished from view is an absent observation, not an error.
    assert.deepEqual(extractMarketDatapoints([lot(null, [line()])]), []);
    assert.deepEqual(extractMarketDatapoints([lot("10.00", [])]), []);
  });

  it("converts at the rate frozen at the close, not at today's", () => {
    const points = extractMarketDatapoints([
      lot("100.00", [line()], { fxRateToBase: "0.23", inBaseCurrency: false }),
    ]);
    assert.equal(points.length, 1);
    assert.equal(points[0].amount, 23);
  });

  it("drops a foreign-currency lot with no frozen rate", () => {
    // It has a price and no way to state it in the base currency, so it is not comparable with the
    // datapoints that are — quite different from a base-currency lot, whose null rate means "none
    // was needed".
    assert.deepEqual(
      extractMarketDatapoints([lot("100.00", [line()], { fxRateToBase: null, inBaseCurrency: false })]),
      []
    );
  });

  it("splits a mixed lot pro-rata by each line's total catalogue value", () => {
    const points = extractMarketDatapoints([
      lot("100.00", [
        line({ stampId: "rare", unitCatalogueValue: 60 }),
        // Two of a cheaper stamp: the weight is the line's total, so 2 × 20 = 40 against 60.
        line({ stampId: "common", unitCatalogueValue: 20, quantity: 2 }),
      ]),
    ]);
    assert.equal(points.length, 2);
    assert.equal(points[0].amount, 60);
    assert.equal(points[0].split, true);
    // 100 × 40/100 = 40, then ÷ 2 for the per-unit figure.
    assert.equal(points[1].amount, 20);
    assert.equal(points[1].split, true);
  });

  it("skips the whole mixed lot when one line has no catalogue value", () => {
    // A partial split would silently hand the missing line's share to its neighbours.
    assert.deepEqual(
      extractMarketDatapoints([
        lot("100.00", [
          line({ stampId: "rare", unitCatalogueValue: 60 }),
          line({ stampId: "unpriced", unitCatalogueValue: null }),
        ]),
      ]),
      []
    );
  });

  it("skips a mixed lot whose catalogue values come to zero", () => {
    assert.deepEqual(
      extractMarketDatapoints([
        lot("100.00", [
          line({ stampId: "a", unitCatalogueValue: 0 }),
          line({ stampId: "b", unitCatalogueValue: 0 }),
        ]),
      ]),
      []
    );
  });

  it("ignores a line with no units, and the lot with it when nothing is left", () => {
    const points = extractMarketDatapoints([
      lot("100.00", [line({ stampId: "real", quantity: 1 }), line({ stampId: "none", quantity: 0 })]),
    ]);
    // One usable line left, so the lot is a single-line one and needs no catalogue value at all.
    assert.equal(points.length, 1);
    assert.equal(points[0].key.stampId, "real");
    assert.equal(points[0].split, false);
    assert.deepEqual(extractMarketDatapoints([lot("100.00", [line({ quantity: 0 })])]), []);
  });

  it("keys on the full stamp × condition × certificate × format tuple, nulls exact", () => {
    const points = extractMarketDatapoints([
      lot("10.00", [line()]),
      lot("90.00", [line({ certificateStatusId: "attest" })]),
      lot("40.00", [line({ formatId: "pair" })]),
      lot("20.00", [line({ conditionId: "used" })]),
    ]);
    assert.equal(new Set(points.map((p) => marketKeyOf(p.key))).size, 4);
  });
});

// Aggregation (§4) -----------------------------------------------------------

describe("aggregateMarketDatapoints", () => {
  it("shows a value from a single result", () => {
    const [agg] = aggregateMarketDatapoints(extractMarketDatapoints([lot("12.00", [line()])]));
    assert.equal(agg.n, 1);
    assert.equal(agg.median, 12);
    assert.equal(agg.min, 12);
    assert.equal(agg.max, 12);
    assert.equal(agg.splitCount, 0);
    assert.equal(agg.wholeCount, 1);
  });

  it("takes the middle value on an odd sample and the middle pair's mean on an even one", () => {
    const odd = aggregateMarketDatapoints(
      ["8", "40", "11", "14", "12"].map((p) => ({
        key: { stampId: "s", conditionId: "c", certificateStatusId: null, formatId: null },
        lotId: "l",
        lineId: `x${p}`,
        amount: Number(p),
        at: RECENT,
        split: false,
      }))
    )[0];
    // 8 · 11 · 12 · 14 · 40 — the median ignores the wild one the mean is dragged by.
    assert.equal(odd.median, 12);
    assert.equal(odd.mean, 17);

    const even = aggregateMarketDatapoints(
      [10, 20, 30, 50].map((amount, i) => ({
        key: { stampId: "s", conditionId: "c", certificateStatusId: null, formatId: null },
        lotId: "l",
        lineId: `y${i}`,
        amount,
        at: RECENT,
        split: false,
      }))
    )[0];
    assert.equal(even.median, 25);
  });

  it("spans the dates and counts the splits", () => {
    const old = new Date("2020-03-01T00:00:00Z");
    const [agg] = aggregateMarketDatapoints(
      extractMarketDatapoints([
        lot("10.00", [line()], { endsAt: old }),
        lot("30.00", [
          line({ unitCatalogueValue: 5 }),
          line({ stampId: "other", unitCatalogueValue: 5 }),
        ]),
      ])
    );
    assert.equal(agg.n, 2);
    assert.equal(agg.splitCount, 1);
    assert.equal(agg.wholeCount, 1);
    assert.equal(agg.earliestAt.getTime(), old.getTime());
    assert.equal(agg.latestAt.getTime(), RECENT.getTime());
  });
});

// Confidence (§5) ------------------------------------------------------------

/** An aggregate with everything a score reads, defaulted to a perfect one. */
function aggregate(overrides: Partial<MarketAggregate> = {}): MarketAggregate {
  return {
    key: { stampId: "s", conditionId: "c", certificateStatusId: null, formatId: null },
    median: 10,
    mean: 10,
    min: 10,
    max: 10,
    n: 5,
    latestAt: RECENT,
    earliestAt: RECENT,
    splitCount: 0,
    wholeCount: 5,
    datapoints: [],
    ...overrides,
  };
}

describe("marketConfidence", () => {
  it("scores a full, recent, tight, whole sample at 100", () => {
    const c = marketConfidence(aggregate(), NOW);
    assert.deepEqual(
      [c.sample, c.recency, c.agreement, c.purity],
      [1, 1, 1, 1]
    );
    assert.equal(c.score, 100);
    assert.equal(c.badge, "high");
  });

  it("saturates the sample component at five results", () => {
    assert.equal(marketConfidence(aggregate({ n: 1, wholeCount: 1 }), NOW).sample, 0.2);
    assert.equal(marketConfidence(aggregate({ n: 5, wholeCount: 5 }), NOW).sample, 1);
    assert.equal(marketConfidence(aggregate({ n: 40, wholeCount: 40 }), NOW).sample, 1);
  });

  it("steps recency at one and three years", () => {
    const at = (iso: string) => marketConfidence(aggregate({ latestAt: new Date(iso) }), NOW).recency;
    assert.equal(at("2026-05-01T00:00:00Z"), 1.0);
    assert.equal(at("2024-06-01T00:00:00Z"), 0.6);
    assert.equal(at("2020-01-01T00:00:00Z"), 0.3);
  });

  it("reads a spread of twice the median as no agreement at all", () => {
    assert.equal(marketConfidence(aggregate({ median: 10, min: 5, max: 15 }), NOW).agreement, 0.5);
    assert.equal(marketConfidence(aggregate({ median: 10, min: 0, max: 20 }), NOW).agreement, 0);
    // Beyond that it clamps rather than going negative.
    assert.equal(marketConfidence(aggregate({ median: 10, min: 0, max: 100 }), NOW).agreement, 0);
    // A zero median leaves the spread nothing to be a proportion of.
    assert.equal(marketConfidence(aggregate({ median: 0, min: 0, max: 0 }), NOW).agreement, 0);
  });

  it("counts a split datapoint as half a whole one", () => {
    assert.equal(marketConfidence(aggregate({ n: 4, wholeCount: 4, splitCount: 0 }), NOW).purity, 1);
    assert.equal(marketConfidence(aggregate({ n: 4, wholeCount: 2, splitCount: 2 }), NOW).purity, 0.75);
    assert.equal(marketConfidence(aggregate({ n: 4, wholeCount: 0, splitCount: 4 }), NOW).purity, 0.5);
  });

  it("buckets the badge at 40 and 70", () => {
    // One old, split result with no spread to speak of: 0.4×0.2 + 0.25×0.3 + 0.2×1 + 0.15×0.5.
    const thin = marketConfidence(
      aggregate({ n: 1, wholeCount: 0, splitCount: 1, latestAt: new Date("2019-01-01T00:00:00Z") }),
      NOW
    );
    assert.equal(thin.score, 43);
    assert.equal(thin.badge, "medium");

    const bare = marketConfidence(
      aggregate({ n: 1, wholeCount: 1, median: 10, min: 2, max: 30, latestAt: new Date("2019-01-01T00:00:00Z") }),
      NOW
    );
    assert.ok(bare.score < 40);
    assert.equal(bare.badge, "low");
  });
});

describe("valuateMarket", () => {
  it("runs extraction, aggregation and the score in one pass", () => {
    const values = valuateMarket(
      [lot("10.00", [line()]), lot("20.00", [line()]), lot("30.00", [line({ conditionId: "used" })])],
      NOW
    );
    assert.equal(values.length, 2);
    const mnh = values.find((v) => v.key.conditionId === "mnh")!;
    assert.equal(mnh.median, 15);
    assert.equal(mnh.n, 2);
    // Two results a third apart: 0.4×0.4 + 0.25×1 + 0.2×(1 − (10/15)/2) + 0.15×1 — one short of
    // `high`, which is the point of scoring a thin sample rather than hiding it.
    assert.equal(mnh.confidence.score, 69);
    assert.equal(mnh.confidence.badge, "medium");
  });
});

// Realization ratio (§6) -----------------------------------------------------

describe("realizationRatio", () => {
  it("is the median over the catalogue value", () => {
    assert.equal(realizationRatio(12, 50), 0.24);
  });

  it("is null when either side is missing or the catalogue value is zero", () => {
    assert.equal(realizationRatio(null, 50), null);
    assert.equal(realizationRatio(12, null), null);
    // Not an enormous ratio — a ratio to nothing says nothing.
    assert.equal(realizationRatio(12, 0), null);
  });
});
