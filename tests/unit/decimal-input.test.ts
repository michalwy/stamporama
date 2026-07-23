import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { normalizeDecimalInput, sanitizeDecimalInput } from "../../src/lib/decimal-input";

describe("normalizeDecimalInput", () => {
  it("turns a comma decimal separator into a period", () => {
    assert.equal(normalizeDecimalInput("12,50"), "12.50");
  });

  it("leaves a period separator untouched", () => {
    assert.equal(normalizeDecimalInput("12.50"), "12.50");
  });

  it("passes through a blank string", () => {
    assert.equal(normalizeDecimalInput(""), "");
  });

  it("does not attempt to parse — Number() rejects a doubly-separated value", () => {
    assert.equal(Number.isNaN(Number(normalizeDecimalInput("1,234.56"))), true);
  });

  it("both separators parse to the same number", () => {
    assert.equal(Number(normalizeDecimalInput("3,14")), Number(normalizeDecimalInput("3.14")));
  });
});

describe("sanitizeDecimalInput", () => {
  it("normalises a comma to a period", () => {
    assert.equal(sanitizeDecimalInput("12,50"), "12.50");
  });

  it("keeps only the first decimal separator", () => {
    assert.equal(sanitizeDecimalInput("1.2.3"), "1.23");
    assert.equal(sanitizeDecimalInput("1,2,3"), "1.23");
  });

  it("strips letters and other symbols", () => {
    assert.equal(sanitizeDecimalInput("$1a2.5x"), "12.5");
  });

  it("drops a negative sign", () => {
    assert.equal(sanitizeDecimalInput("-5"), "5");
  });

  it("preserves a trailing separator while typing", () => {
    assert.equal(sanitizeDecimalInput("1,"), "1.");
  });

  it("returns empty for a value with no digits or separators", () => {
    assert.equal(sanitizeDecimalInput("abc"), "");
  });
});
