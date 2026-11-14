import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { pickPricingTab } from "../../src/lib/offer-pricing-tab";

const market = (over: Partial<{ present: boolean; empty: boolean }> = {}) => ({
  key: "colnect-market",
  present: true,
  empty: false,
  ...over,
});
const earlier = (over: Partial<{ present: boolean; empty: boolean }> = {}) => ({
  key: "earlier-offers",
  present: true,
  empty: false,
  ...over,
});

describe("pickPricingTab (#2522)", () => {
  it("is null when no tab applies — the price table takes the whole panel", () => {
    assert.equal(pickPricingTab([market({ present: false }), earlier({ present: false })], null), null);
    assert.equal(pickPricingTab([], "colnect-market"), null);
  });

  it("takes the first tab with content when nothing is remembered", () => {
    assert.equal(pickPricingTab([market(), earlier()], null)?.key, "colnect-market");
  });

  it("keeps the remembered tab when it has content", () => {
    assert.equal(pickPricingTab([market(), earlier()], "earlier-offers")?.key, "earlier-offers");
  });

  it("skips a tab that does not apply to this offer", () => {
    assert.equal(pickPricingTab([market({ present: false }), earlier()], "colnect-market")?.key, "earlier-offers");
  });

  it("passes over an empty tab to the next with content, even when it was remembered", () => {
    assert.equal(pickPricingTab([market({ empty: true }), earlier()], null)?.key, "earlier-offers");
    assert.equal(pickPricingTab([market({ empty: true }), earlier()], "colnect-market")?.key, "earlier-offers");
  });

  it("shows an empty tab when nothing else has content — its own button is what fills it", () => {
    assert.equal(pickPricingTab([market({ empty: true })], null)?.key, "colnect-market");
    assert.equal(pickPricingTab([market({ empty: true }), earlier({ empty: true })], "earlier-offers")?.key, "earlier-offers");
  });

  it("ignores a remembered key no tab carries", () => {
    assert.equal(pickPricingTab([market()], "gone")?.key, "colnect-market");
  });
});
