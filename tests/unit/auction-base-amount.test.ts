import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  baseValue,
  formatBase,
  fromBase,
} from "../../src/app/c/[collectionSlug]/auctions/auction-format";

// The base-currency reading of an auction amount (#498). Pure formatting, but it is what decides
// whether a second line is drawn at all — and "no rate" and "no amount" must both mean *nothing on
// screen*, never a `0.00` or a bare `≈`.

describe("formatBase (#498)", () => {
  it("converts an amount at the lot's own rate", () => {
    assert.equal(formatBase("100.00", 0.25, "EUR"), "≈ 25.00 EUR");
    // Rounded to the cent like every other figure on the screen, never to the rate's precision.
    assert.equal(formatBase("33.33", 0.2325, "EUR"), "≈ 7.75 EUR");
  });

  it("says nothing where there is nothing to say", () => {
    assert.equal(formatBase(null, 0.25, "EUR"), null, "an unrecorded amount");
    assert.equal(formatBase("100.00", null, "EUR"), null, "base currency, or no rate to be had");
    assert.equal(formatBase("—", 0.25, "EUR"), null, "a dash is not a figure");
  });

  it("converts zero rather than treating it as absent — a headroom of nil is a result", () => {
    assert.equal(formatBase("0.00", 0.25, "EUR"), "≈ 0.00 EUR");
  });

  it("keeps a negative headroom negative", () => {
    assert.equal(formatBase("-40.00", 0.25, "EUR"), "≈ -10.00 EUR");
  });
});

// The other direction: a ceiling stated in the collector's own currency (#498). What is stored is
// still the sale's — this is a second way of typing one figure, as `bid ↔ all-in` already is.

describe("fromBase (#498)", () => {
  it("stores the sale-currency amount a base-currency figure comes to", () => {
    assert.equal(fromBase("25.00", 0.25), "100.00");
    // Typed as it would be spoken, comma and all — the same leniency `formatAmountInput` has.
    assert.equal(fromBase(" 25,5 ", 0.25), "102.00");
  });

  it("round-trips against formatBase, which is what makes the pair one figure", () => {
    const stored = fromBase("25.00", 0.25);
    assert.equal(formatBase(stored, 0.25, "EUR"), "≈ 25.00 EUR");
  });

  it("treats a blank as clearing the amount, not as zero", () => {
    assert.equal(fromBase("", 0.25), "");
    assert.equal(fromBase("   ", 0.25), "");
  });

  it("has nothing to store where the figure or the rate cannot be read", () => {
    assert.equal(fromBase("abc", 0.25), null);
    assert.equal(fromBase("-5", 0.25), null, "a negative bid is not a bid");
    assert.equal(fromBase("25.00", null), null, "no rate — the field reverts");
    assert.equal(fromBase("25.00", 0), null, "and a zero rate divides by nothing");
  });
});

describe("baseValue (#498)", () => {
  it("is the bare figure the editable line puts in its input — no ≈, no currency", () => {
    assert.equal(baseValue("100.00", 0.25), "25.00");
  });

  it("is blank where there is nothing to amend", () => {
    assert.equal(baseValue(null, 0.25), "");
    assert.equal(baseValue("100.00", null), "");
  });
});
