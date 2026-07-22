import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  SELLABLE_OFFER_STATES,
  isSellableOfferState,
  parsePrice,
  parseAmount,
  parseSaleDate,
} from "../../src/lib/sale-rules";

// Sellable offer states ------------------------------------------------------

describe("isSellableOfferState", () => {
  it("accepts active and paused only", () => {
    assert.deepEqual([...SELLABLE_OFFER_STATES].sort(), ["active", "paused"]);
    assert.equal(isSellableOfferState("active"), true);
    assert.equal(isSellableOfferState("paused"), true);
    assert.equal(isSellableOfferState("sold"), false);
    assert.equal(isSellableOfferState("withdrawn"), false);
  });
});

// parsePrice (required, non-negative) ---------------------------------------

describe("parsePrice", () => {
  it("normalises a valid price to 2 dp", () => {
    assert.deepEqual(parsePrice("10"), { ok: true, value: "10.00" });
    assert.deepEqual(parsePrice("  3.5 "), { ok: true, value: "3.50" });
    assert.deepEqual(parsePrice("0"), { ok: true, value: "0.00" });
  });
  it("rejects blank, non-numeric, and negative", () => {
    assert.equal(parsePrice("").ok, false);
    assert.equal(parsePrice("abc").ok, false);
    assert.equal(parsePrice("-1").ok, false);
  });
});

// parseAmount (optional, non-negative) --------------------------------------

describe("parseAmount", () => {
  it("treats blank as null (not recorded)", () => {
    assert.deepEqual(parseAmount("", "Commission"), { ok: true, value: null });
    assert.deepEqual(parseAmount("   ", "Commission"), { ok: true, value: null });
  });
  it("normalises a valid amount to 2 dp", () => {
    assert.deepEqual(parseAmount("2.5", "Shipping"), { ok: true, value: "2.50" });
  });
  it("rejects non-numeric and negative with a labelled message", () => {
    const bad = parseAmount("-1", "Shipping");
    assert.equal(bad.ok, false);
    if (!bad.ok) assert.match(bad.message, /Shipping/);
    assert.equal(parseAmount("x", "Commission").ok, false);
  });
});

// parseSaleDate --------------------------------------------------------------

describe("parseSaleDate", () => {
  it("parses a valid YYYY-MM-DD to a UTC midnight date", () => {
    const d = parseSaleDate("2026-07-22");
    assert.ok(d);
    assert.equal(d!.toISOString(), "2026-07-22T00:00:00.000Z");
  });
  it("rejects malformed and impossible dates", () => {
    assert.equal(parseSaleDate(""), null);
    assert.equal(parseSaleDate("2026-7-2"), null);
    assert.equal(parseSaleDate("22/07/2026"), null);
    assert.equal(parseSaleDate("2026-02-31"), null); // rolls over → rejected
  });
});
