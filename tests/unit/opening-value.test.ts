import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { resolveOpeningValue } from "../../src/lib/opening-value";

// The lead line of an opening balance's summary panel (#1325). What can go wrong is silent: a lot
// with no value read as `0.00` (#1184), and a sum over some lots passed off as a sum over all.

const DOC = { currency: "PLN", baseCurrency: "EUR", fxRateToBase: 0.23 };

describe("resolveOpeningValue", () => {
  it("sums the lots' opening values in both currencies", () => {
    const ov = resolveOpeningValue({ ...DOC, scope: "order", lotPrices: [120, 14.5] });
    assert.deepEqual(ov.value, { tx: "134.50", base: "30.94" });
    assert.equal(ov.lotCount, 2);
    assert.equal(ov.unvaluedLotCount, 0);
    assert.equal(ov.scope, "order");
  });

  it("skips lots without a value and counts them", () => {
    const ov = resolveOpeningValue({ ...DOC, scope: "order", lotPrices: [100, null, null] });
    assert.deepEqual(ov.value, { tx: "100.00", base: "23.00" });
    assert.equal(ov.lotCount, 3);
    assert.equal(ov.unvaluedLotCount, 2);
  });

  it("states no value at all when no lot has one — never 0.00", () => {
    const ov = resolveOpeningValue({ ...DOC, scope: "order", lotPrices: [null, null] });
    assert.equal(ov.value, null);
    assert.equal(ov.unvaluedLotCount, 2);
  });

  it("states no value for a document with no lots yet", () => {
    const ov = resolveOpeningValue({ ...DOC, scope: "order", lotPrices: [] });
    assert.equal(ov.value, null);
    assert.equal(ov.unvaluedLotCount, 0);
  });

  it("keeps a lot valued at zero as a value", () => {
    const ov = resolveOpeningValue({ ...DOC, scope: "lot", lotPrices: [0] });
    assert.deepEqual(ov.value, { tx: "0.00", base: "0.00" });
    assert.equal(ov.unvaluedLotCount, 0);
  });

  it("sums in cents rather than drifting in binary floats", () => {
    const ov = resolveOpeningValue({
      scope: "order",
      lotPrices: [0.1, 0.2],
      currency: "EUR",
      baseCurrency: "EUR",
      fxRateToBase: null,
    });
    assert.deepEqual(ov.value, { tx: "0.30", base: "0.30" });
  });

  it("has no base figure when the document is foreign and carries no rate", () => {
    const ov = resolveOpeningValue({ ...DOC, fxRateToBase: null, scope: "lot", lotPrices: [50] });
    assert.deepEqual(ov.value, { tx: "50.00", base: null });
  });
});
