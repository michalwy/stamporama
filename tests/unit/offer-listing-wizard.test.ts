import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  hasItemGaps,
  itemGapSummary,
  listingItemGaps,
  type WizardCopy,
  type WizardItem,
} from "../../src/lib/offer-listing-wizard";

const item = (over: Partial<WizardItem> = {}): WizardItem => ({
  stampId: "s1",
  conditionId: "c1",
  catalogUrl: "https://colnect.com/item/1",
  unpricedVariantStampId: null,
  ...over,
});

const copy = (over: Partial<WizardCopy> = {}): WizardCopy => ({
  stampId: "s1",
  conditionId: "c1",
  value: { unpriced: false },
  ...over,
});

describe("listingItemGaps", () => {
  it("reports nothing to fix when every row is matched and priced", () => {
    const gaps = listingItemGaps([item(), item({ stampId: "s2" })], [copy(), copy({ stampId: "s2" })]);
    assert.deepEqual(gaps, { unlinked: 0, unpriced: 0, total: 2 });
    assert.equal(hasItemGaps(gaps), false);
    assert.equal(itemGapSummary(gaps), null);
  });

  it("counts a row with no catalogue page behind it as unmatched", () => {
    const gaps = listingItemGaps([item({ catalogUrl: null }), item({ stampId: "s2" })], []);
    assert.equal(gaps.unlinked, 1);
  });

  it("counts a row whose stamp x condition has an unpriced copy", () => {
    const gaps = listingItemGaps(
      [item(), item({ stampId: "s2" })],
      [copy({ value: { unpriced: true } }), copy({ stampId: "s2" })]
    );
    assert.equal(gaps.unpriced, 1);
    assert.equal(itemGapSummary(gaps), "1 without a catalog value");
  });

  it("keys the value on the condition too, not on the stamp alone (#720)", () => {
    // The same stamp in two grades is two rows, and only the grade with no figure is a gap.
    const gaps = listingItemGaps(
      [item(), item({ conditionId: "c2" })],
      [copy(), copy({ conditionId: "c2", value: { unpriced: true } })]
    );
    assert.equal(gaps.unpriced, 1);
  });

  it("leaves an unpriced variant tree out of the count (#617)", () => {
    // Pricing the umbrella closes nothing there — the rollup reads the variants — so the card offers
    // the variant price grid instead of `+ CV`, and the wizard must not claim work `+ CV` can do.
    const gaps = listingItemGaps(
      [item({ unpricedVariantStampId: "s1" })],
      [copy({ value: { unpriced: true } })]
    );
    assert.equal(gaps.unpriced, 0);
  });

  it("names both gaps in one line, matched first", () => {
    const gaps = listingItemGaps(
      [item({ catalogUrl: null }), item({ stampId: "s2" })],
      [copy({ stampId: "s2", value: { unpriced: true } })]
    );
    assert.equal(hasItemGaps(gaps), true);
    assert.equal(itemGapSummary(gaps), "1 not matched · 1 without a catalog value");
  });
});
