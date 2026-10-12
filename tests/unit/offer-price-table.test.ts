import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeCatalogueSource,
  describeEstimateBasis,
  describeEstimateNote,
  describeEstimateSource,
  estimateSets,
  formatPriceMargin,
  marginSign,
  offerPriceRows,
  priceMargin,
  type CopyEstimateInput,
} from "../../src/lib/offer-price-table";

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

  it("leave out a figure that does not exist, and a price of zero (#1184), but always draw Minimum, Market and the offer's own price", () => {
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
