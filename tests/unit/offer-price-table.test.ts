import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeEstimateSource,
  estimateSets,
  formatPriceMargin,
  offerPriceRows,
  priceMargin,
  type CopyEstimateInput,
} from "../../src/lib/offer-price-table";

// The offer's price table (#1829): Estimated value per set, the source of its ratio, the margins,
// and which rows exist at all.

const copy = (over: Partial<CopyEstimateInput> = {}): CopyEstimateInput => ({
  catalogueBase: 100,
  ratio: 0.3,
  level: "area",
  bucketLabel: "Polska Ludowa",
  n: 7,
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

  it("prints with a sign either way", () => {
    assert.equal(formatPriceMargin({ amount: "4.00", percent: 40 }), "+4.00 · +40%");
    assert.equal(formatPriceMargin({ amount: "-1.00", percent: -10 }), "−1.00 · −10%");
    assert.equal(formatPriceMargin({ amount: "5.00", percent: null }), "+5.00");
  });
});

describe("the table's rows", () => {
  it("are in the collector's order, each price with its margin over the cost", () => {
    const rows = offerPriceRows({
      minimum: "2.00",
      catalogue: "40.00",
      estimated: "12.00",
      market: "10.00",
      cost: "8.00",
    });
    assert.deepEqual(
      rows.map((r) => [r.key, r.amount, r.margin && formatPriceMargin(r.margin)]),
      [
        ["minimum", "2.00", "−6.00 · −75%"],
        ["catalogue", "40.00", "+32.00 · +400%"],
        ["estimated", "12.00", "+4.00 · +50%"],
        ["market", "10.00", "+2.00 · +25%"],
        ["cost", "8.00", null],
      ]
    );
  });

  it("leave out a figure that does not exist, and a price of zero (#1184)", () => {
    const rows = offerPriceRows({ minimum: "0.00", catalogue: null, estimated: "12.00", market: null, cost: null });
    assert.deepEqual(
      rows.map((r) => r.key),
      ["estimated"]
    );
  });

  it("leave out every margin when the cost is unknown", () => {
    const rows = offerPriceRows({ minimum: "2.00", catalogue: "40.00", estimated: null, market: null, cost: null });
    assert.ok(rows.every((r) => r.margin === null));
  });

  it("keep a cost of zero, which is a known cost", () => {
    const rows = offerPriceRows({ minimum: null, catalogue: "40.00", estimated: null, market: null, cost: "0.00" });
    assert.deepEqual(
      rows.map((r) => [r.key, r.margin]),
      [
        ["catalogue", { amount: "40.00", percent: null }],
        ["cost", null],
      ]
    );
  });
});
