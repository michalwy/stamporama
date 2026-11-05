import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeCatalogueSource,
  describeEstimateBasis,
  describeEstimateNote,
  describeEstimateSource,
  describeMarketTrendNote,
  estimateSets,
  formatPriceMargin,
  marginSign,
  marketTrendSets,
  offerPriceFigures,
  offerPriceRows,
  priceMargin,
  type CopyEstimateInput,
  type CopyMarketTrendInput,
  type PriceFigureSet,
} from "../../src/lib/offer-price-table";
import type { TrendStatementInput } from "../../src/lib/price-trend";

// The offer's price table (#1829, made to read without its tooltips in #1839, its notes shrunk in
// #1843): Estimated value per set, the source of its ratio, the notes, the margins, and which rows
// exist at all.

const copy = (over: Partial<CopyEstimateInput> = {}): CopyEstimateInput => ({
  catalogueBase: 100,
  ratio: 0.3,
  level: "area",
  bucketLabel: "Polska Ludowa",
  n: 7,
  catalogueName: "Michel / Online",
  ...over,
});

describe("Estimated value per set", () => {
  it("multiplies each copy's catalogue value by its ratio and averages over the estimated sets", () => {
    const estimate = estimateSets([[copy(), copy({ catalogueBase: 50 })], [copy({ catalogueBase: 20 })]]);
    assert.ok(estimate);
    // (30 + 15) and 6, over two sets.
    assert.equal(estimate.averageBase.toFixed(2), "25.50");
    assert.equal(estimate.valuedSets, 2);
    assert.equal(estimate.copies, 3);
  });

  it("divides by the sets that have an estimate, never by every set", () => {
    // An unpriced set is a gap in the data (#378), not a set worth nothing.
    const estimate = estimateSets([[copy()], []]);
    assert.equal(estimate?.averageBase, 30);
    assert.equal(estimate?.valuedSets, 1);
  });

  it("is null when no copy can be estimated", () => {
    assert.equal(estimateSets([[], []]), null);
    assert.equal(estimateSets([]), null);
  });

  it("names the bucket only when every copy resolved the same one", () => {
    const one = estimateSets([[copy(), copy({ catalogueBase: 10 })]]);
    assert.deepEqual(one?.source, {
      level: "area",
      bucketLabel: "Polska Ludowa",
      bucketCount: 1,
      ratio: 0.3,
      n: 7,
    });
    const two = estimateSets([[copy(), copy({ level: "collection", bucketLabel: "All recorded results", ratio: 0.5 })]]);
    assert.deepEqual(two?.source, { level: null, bucketLabel: null, bucketCount: 2, ratio: null, n: 0 });
  });
});

describe("the estimate's share of the catalogue and its books (#1839)", () => {
  it("is the one ratio when every copy resolved the same bucket", () => {
    assert.equal(estimateSets([[copy(), copy({ catalogueBase: 10 })]])?.ratio, 0.3);
  });

  it("is weighted by catalogue value across several buckets", () => {
    // 100 × 0.3 + 100 × 0.5 over 200 of catalogue.
    const estimate = estimateSets([[copy(), copy({ level: "collection", bucketLabel: "All recorded results", ratio: 0.5 })]]);
    assert.equal(estimate?.ratio, 0.4);
  });

  it("names each book once, sorted, and skips a copy with none", () => {
    const estimate = estimateSets([
      [copy({ catalogueName: "Michel / Online" }), copy({ catalogueName: "Fischer / 2024" })],
      [copy({ catalogueName: "Michel / Online" }), copy({ catalogueName: null })],
    ]);
    assert.deepEqual(estimate?.catalogues, ["Fischer / 2024", "Michel / Online"]);
  });
});

describe("the bracketed notes (#1839)", () => {
  it("leave the catalogue's book to the tooltip, which names it or counts and lists several (#1843)", () => {
    assert.equal(describeCatalogueSource(["Michel / Online"]), "Read in Michel / Online");
    assert.equal(
      describeCatalogueSource(["Fischer / 2024", "Michel / Online"]),
      "Read in 2 catalogues: Fischer / 2024, Michel / Online"
    );
    assert.equal(describeCatalogueSource([]), null);
  });

  it("give the estimate's ratio only", () => {
    assert.equal(describeEstimateNote(0.58), "58% of catalogue");
  });

  it("leave the bucket and its results to the tooltip", () => {
    assert.equal(
      describeEstimateBasis({ level: "area", bucketLabel: "Second Republic", bucketCount: 1, ratio: 0.58, n: 26 }),
      "Second Republic, 26 results"
    );
    assert.equal(
      describeEstimateBasis({ level: "area", bucketLabel: "Second Republic", bucketCount: 1, ratio: 0.58, n: 1 }),
      "Second Republic, 1 result"
    );
    assert.equal(
      describeEstimateBasis({
        level: "catalogue-factor",
        bucketLabel: "Michel / Online — your factor, catalogue ÷ 10",
        bucketCount: 1,
        ratio: 0.1,
        n: 0,
      }),
      "Michel / Online — your factor, catalogue ÷ 10 — your estimate, not evidence"
    );
    assert.equal(
      describeEstimateBasis({ level: null, bucketLabel: null, bucketCount: 2, ratio: null, n: 0 }),
      "2 ratio buckets"
    );
  });
});

describe("the ratio's source", () => {
  it("states a learned bucket with its ratio and n", () => {
    assert.equal(
      describeEstimateSource({ level: "area", bucketLabel: "Polska Ludowa", bucketCount: 1, ratio: 0.34, n: 6 }),
      "Polska Ludowa · 34% · n = 6"
    );
  });

  it("says a manual factor and the fallback are not evidence", () => {
    assert.equal(
      describeEstimateSource({
        level: "catalogue-factor",
        bucketLabel: "Michel / Online — your factor, catalogue ÷ 10",
        bucketCount: 1,
        ratio: 0.1,
        n: 0,
      }),
      "Michel / Online — your factor, catalogue ÷ 10 · 10% · your estimate, not evidence"
    );
    assert.equal(
      describeEstimateSource({ level: "fallback", bucketLabel: "No recorded results", bucketCount: 1, ratio: 0.4, n: 0 }),
      "No recorded results · 40% · policy, not evidence"
    );
  });

  it("counts the buckets when the copies resolved several", () => {
    assert.equal(
      describeEstimateSource({ level: null, bucketLabel: null, bucketCount: 3, ratio: null, n: 0 }),
      "3 ratio buckets"
    );
  });
});

describe("a margin over the cost", () => {
  it("is the difference and that difference as a share of the cost", () => {
    assert.deepEqual(priceMargin(14, 10), { amount: "4.00", percent: 40 });
    assert.deepEqual(priceMargin(9, 10), { amount: "-1.00", percent: -10 });
  });

  it("has no share where the cost is zero", () => {
    assert.deepEqual(priceMargin(5, 0), { amount: "5.00", percent: null });
  });

  it("prints as one figure with its percentage, signed either way (#1839)", () => {
    assert.equal(formatPriceMargin({ amount: "4.00", percent: 40 }), "+4.00 (+40%)");
    assert.equal(formatPriceMargin({ amount: "-0.02", percent: -29 }), "−0.02 (−29%)");
    assert.equal(formatPriceMargin({ amount: "5.00", percent: null }), "+5.00");
  });

  it("says which way it goes, for its colour", () => {
    assert.equal(marginSign({ amount: "-0.02", percent: -29 }), -1);
    assert.equal(marginSign({ amount: "0.00", percent: 0 }), 0);
    assert.equal(marginSign({ amount: "4.00", percent: 40 }), 1);
  });
});

describe("the table's rows", () => {
  it("are in the collector's order, the offer's own price last, each price with its margin", () => {
    const rows = offerPriceRows({
      minimum: "2.00",
      catalogue: "40.00",
      estimated: "12.00",
      market: "10.00",
      cost: "8.00",
      own: "11.00",
    });
    assert.deepEqual(
      rows.map((r) => [r.key, r.amount, r.margin && formatPriceMargin(r.margin)]),
      [
        ["minimum", "2.00", "−6.00 (−75%)"],
        ["catalogue", "40.00", "+32.00 (+400%)"],
        ["estimated", "12.00", "+4.00 (+50%)"],
        ["market", "10.00", "+2.00 (+25%)"],
        ["cost", "8.00", null],
        ["own", "11.00", "+3.00 (+38%)"],
      ]
    );
  });

  it("leave out a figure that does not exist, and a price of zero (#1184), but always draw Minimum, Market, Cost (#2333) and the offer's own price", () => {
    const rows = offerPriceRows({
      minimum: null,
      catalogue: "0.00",
      estimated: "12.00",
      market: null,
      cost: null,
      own: null,
    });
    assert.deepEqual(
      rows.map((r) => [r.key, r.amount]),
      [
        ["minimum", null],
        ["estimated", "12.00"],
        ["market", null],
        ["cost", null],
        ["own", null],
      ]
    );
  });

  it("draw a platform minimum of zero as no minimum (#1843)", () => {
    const rows = offerPriceRows({ minimum: "0.00", catalogue: null, estimated: null, market: null, cost: "5.00", own: null });
    assert.deepEqual(rows[0], { key: "minimum", amount: null, margin: null });
  });

  it("leave out every margin when the cost is unknown", () => {
    const rows = offerPriceRows({
      minimum: "2.00",
      catalogue: "40.00",
      estimated: null,
      market: null,
      cost: null,
      own: "5.00",
    });
    assert.ok(rows.every((r) => r.margin === null));
  });

  it("keep a cost of zero, which is a known cost", () => {
    const rows = offerPriceRows({
      minimum: null,
      catalogue: "40.00",
      estimated: null,
      market: null,
      cost: "0.00",
      own: null,
    });
    assert.deepEqual(
      rows.map((r) => [r.key, r.margin]),
      [
        ["minimum", null],
        ["catalogue", { amount: "40.00", percent: null }],
        ["market", null],
        ["cost", null],
        ["own", null],
      ]
    );
  });
});

// The figures themselves, over an offer's sets (#1894): one function for the offer's own screen and
// the Prepare screen, so the two cannot disagree.
describe("the price table's figures over an offer's sets", () => {
  const set = (over: {
    catalogue?: string;
    priced?: number;
    reduction?: string;
    reduced?: number;
    market?: string;
    marketCopies?: number;
    noEvidence?: number;
    cost?: string | null;
    estimates?: CopyEstimateInput[];
  } = {}): PriceFigureSet => ({
    holdings: {
      pricedCount: over.priced ?? 1,
      totalBaseAmount: over.catalogue ?? "30.00",
      faultReductionBaseAmount: over.reduction ?? "0.00",
      faultReducedCount: over.reduced ?? 0,
      market: {
        valuedCount: over.marketCopies ?? 0,
        totalBaseAmount: over.market ?? "0.00",
        noEvidenceCount: over.noEvidence ?? 0,
      },
    },
    cost: {
      amount: over.cost === undefined ? "10.00" : over.cost,
      knownCount: 1,
      estimatedCount: 0,
      unestimated: [],
      noneCount: 0,
      openingCount: 0,
      noOpeningValueCount: 0,
      notHeld: { notDelivered: 0, damaged: 0, disposed: 0 },
      estimated: false,
      opening: false,
    },
    estimates: over.estimates ?? [copy()],
  });

  it("averages each figure over the sets that carry it, in the offer's currency", () => {
    const figures = offerPriceFigures(
      [
        set({ catalogue: "30.00", market: "12.00", marketCopies: 1, cost: "10.00" }),
        set({ catalogue: "10.00", priced: 1, cost: null, estimates: [] }),
        set({ priced: 0, catalogue: "0.00", cost: "20.00", noEvidence: 1, estimates: [] }),
      ],
      2
    );
    // Catalogue over the two priced sets, ×2.
    assert.equal(figures.catalogPrice, "40.00");
    assert.equal(figures.catalogUnpricedSets, 1);
    // Estimated over the one set with an estimate: 100 × 0.3, ×2.
    assert.equal(figures.suggestedPrice, "60.00");
    assert.equal(figures.marketPrice?.amount, "24.00");
    assert.equal(figures.marketPrice?.noEvidenceCopies, 1);
    // COST over the two costed sets: (10 + 20) / 2, ×2.
    assert.equal(figures.costPrice, "30.00");
    assert.equal(figures.costAverageBase, 15);
  });

  it("names the full catalogue value only where a fault lowered it", () => {
    assert.equal(offerPriceFigures([set()], 1).catalogFullPrice, null);
    const lowered = offerPriceFigures([set({ catalogue: "20.00", reduction: "10.00", reduced: 1 })], 1);
    assert.equal(lowered.catalogFullPrice, "30.00");
    assert.equal(lowered.catalogFaultReducedCount, 1);
  });

  it("states nothing in a currency it has no rate for", () => {
    const figures = offerPriceFigures([set({ market: "12.00", marketCopies: 1 })], null);
    assert.equal(figures.catalogPrice, null);
    assert.equal(figures.suggestedPrice, null);
    assert.equal(figures.suggestedEstimate, null);
    assert.equal(figures.costPrice, null);
    assert.equal(figures.marketPrice, null);
    // Results exist; it is the rate that is missing — the Market row says so.
    assert.equal(figures.marketUnconvertible, true);
    // So does the Cost row (#2436): there is a cost, only no rate into the offer's currency.
    assert.equal(figures.costUnconvertible, true);
  });

  it("calls a missing cost unconvertible only when there is a cost to convert (#2436)", () => {
    assert.equal(offerPriceFigures([set()], 1).costUnconvertible, false);
    assert.equal(offerPriceFigures([set({ cost: null })], null).costUnconvertible, false);
  });
});

// Market trend (#2461): Market's copies, each brought to today by its stamp's price trend.
describe("Market trend per set (#2461)", () => {
  const trend = (over: Partial<TrendStatementInput> = {}): TrendStatementInput => ({
    rate: 0.14,
    measuredRate: 0.14,
    capped: false,
    n: 4,
    earliestAt: new Date("2022-06-01T00:00:00Z"),
    latestAt: new Date("2025-06-01T00:00:00Z"),
    borrowed: null,
    ...over,
  });
  const trended = (market: number, adjusted: number, t: TrendStatementInput | null = trend()): CopyMarketTrendInput => ({
    market,
    trended: adjusted,
    trend: t,
  });

  it("sums each set's trend-adjusted copies, a copy with no trend at its median, over Market's sets", () => {
    const result = marketTrendSets([[trended(10, 14), trended(5, 5, null)], [], [trended(8, 8, null)]]);
    assert.ok(result);
    // (14 + 5) and 8, over the two sets with results — the empty one is not a set worth nothing.
    assert.equal(result.averageBase, 13.5);
    assert.equal(result.valuedSets, 2);
    assert.equal(result.copies, 3);
    assert.equal(result.trendedCopies, 1);
    assert.equal(result.trends.length, 1);
  });

  it("is null when no copy has a trend, so the row is not drawn", () => {
    assert.equal(marketTrendSets([[trended(10, 10, null)]]), null);
    assert.equal(marketTrendSets([]), null);
  });

  it("names the rate, borrowed and capped as such, and a range across copies", () => {
    assert.equal(describeMarketTrendNote([trend()]), "+14%/yr");
    assert.equal(describeMarketTrendNote([trend({ rate: 0.09, borrowed: { bucketLabel: "Polska Ludowa, MNH" } })]), "borrowed, +9%/yr");
    assert.equal(describeMarketTrendNote([trend({ rate: 0.3, measuredRate: 0.45, capped: true })]), "+30%/yr, capped");
    assert.equal(describeMarketTrendNote([trend({ rate: 0.05 }), trend(), trend({ rate: -0.08 })]), "−8%/yr to +14%/yr");
  });

  it("draws Market trend under Market with its profit over cost, and leaves it out with no figure", () => {
    const figures = { minimum: null, catalogue: null, estimated: null, market: "10.00", cost: "8.00", own: null };
    const rows = offerPriceRows({ ...figures, marketTrend: "14.00" });
    assert.deepEqual(
      rows.map((r) => r.key),
      ["minimum", "market", "marketTrend", "cost", "own"]
    );
    assert.deepEqual(rows.find((r) => r.key === "marketTrend")?.margin, { amount: "6.00", percent: 75 });
    assert.deepEqual(
      offerPriceRows(figures).map((r) => r.key),
      ["minimum", "market", "cost", "own"]
    );
  });

  it("converts into the offer's currency and leaves Market as the plain median", () => {
    const set: PriceFigureSet = {
      holdings: {
        pricedCount: 0,
        totalBaseAmount: "0.00",
        faultReductionBaseAmount: "0.00",
        faultReducedCount: 0,
        market: { valuedCount: 1, totalBaseAmount: "10.00", noEvidenceCount: 0 },
      },
      cost: {
        amount: null,
        knownCount: 0,
        estimatedCount: 0,
        unestimated: [],
        noneCount: 1,
        openingCount: 0,
        noOpeningValueCount: 0,
        notHeld: { notDelivered: 0, damaged: 0, disposed: 0 },
        estimated: false,
        opening: false,
      },
      estimates: [],
      marketTrends: [trended(10, 14)],
    };
    const figures = offerPriceFigures([set], 2);
    assert.equal(figures.marketPrice?.amount, "20.00");
    assert.equal(figures.marketTrendPrice?.amount, "28.00");
    assert.equal(offerPriceFigures([set], null).marketTrendPrice, null);
    assert.equal(offerPriceFigures([{ ...set, marketTrends: [trended(10, 10, null)] }], 1).marketTrendPrice, null);
  });
});
