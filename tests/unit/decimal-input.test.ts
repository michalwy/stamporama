import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAmountExpression,
  normalizeDecimalInput,
  sanitizeDecimalInput,
} from "../../src/lib/decimal-input";

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

  it("evaluates an arithmetic expression", () => {
    assert.equal(normalizeDecimalInput("1+2"), "3");
    assert.equal(normalizeDecimalInput("12,50*3"), "37.5");
    assert.equal(normalizeDecimalInput("(4,20+1,80)/2"), "3");
  });

  it("leaves an unparseable expression as typed, for the caller to reject", () => {
    assert.equal(normalizeDecimalInput("1+"), "1+");
    assert.equal(Number.isNaN(Number(normalizeDecimalInput("1+"))), true);
  });
});

describe("evaluateAmountExpression", () => {
  it("applies operator precedence and parentheses", () => {
    assert.equal(evaluateAmountExpression("2+3*4"), 14);
    assert.equal(evaluateAmountExpression("(2+3)*4"), 20);
  });

  it("ignores spaces around operators", () => {
    assert.equal(evaluateAmountExpression("12.50 + 7.50"), 20);
  });

  it("reads a plain number", () => {
    assert.equal(evaluateAmountExpression("12.50"), 12.5);
  });

  it("takes a comma separator inside an operand", () => {
    assert.equal(evaluateAmountExpression("1,5*2"), 3);
  });

  it("handles a leading sign", () => {
    assert.equal(evaluateAmountExpression("-5+8"), 3);
    assert.equal(evaluateAmountExpression("10*-2"), -20);
  });

  it("rejects malformed input", () => {
    assert.equal(evaluateAmountExpression(""), null);
    assert.equal(evaluateAmountExpression("1+"), null);
    assert.equal(evaluateAmountExpression("(1+2"), null);
    assert.equal(evaluateAmountExpression("1+2)"), null);
    assert.equal(evaluateAmountExpression("1..2"), null);
    assert.equal(evaluateAmountExpression("abc"), null);
  });

  it("rejects a division by zero rather than returning Infinity", () => {
    assert.equal(evaluateAmountExpression("5/0"), null);
  });

  it("rounds away binary floating-point noise when formatted", () => {
    assert.equal(normalizeDecimalInput("0,1+0,2"), "0.3");
    assert.equal(normalizeDecimalInput("10/3"), "3.333333");
  });
});

describe("sanitizeDecimalInput", () => {
  it("normalises a comma to a period", () => {
    assert.equal(sanitizeDecimalInput("12,50"), "12.50");
  });

  it("keeps only the first decimal separator within one number", () => {
    assert.equal(sanitizeDecimalInput("1.2.3"), "1.23");
    assert.equal(sanitizeDecimalInput("1,2,3"), "1.23");
  });

  it("allows a separator in each operand of an expression", () => {
    assert.equal(sanitizeDecimalInput("1,5+2,5"), "1.5+2.5");
  });

  it("keeps arithmetic characters and spaces", () => {
    assert.equal(sanitizeDecimalInput("(4,20 + 1,80)/2"), "(4.20 + 1.80)/2");
  });

  it("strips letters and other symbols", () => {
    assert.equal(sanitizeDecimalInput("$1a2.5x"), "12.5");
  });

  it("keeps a leading minus, which the expression parser reads as a sign", () => {
    assert.equal(sanitizeDecimalInput("-5"), "-5");
  });

  it("preserves a trailing separator while typing", () => {
    assert.equal(sanitizeDecimalInput("1,"), "1.");
  });

  it("returns empty for a value with no digits or separators", () => {
    assert.equal(sanitizeDecimalInput("abc"), "");
  });
});

describe("whitespace handling", () => {
  it("normalises a whitespace-only value to blank, not to zero", () => {
    assert.equal(normalizeDecimalInput("  "), "");
  });

  it("keeps a spaced expression working", () => {
    assert.equal(normalizeDecimalInput(" 12,50 + 7,50 "), "20");
  });

  it("still rejects two numbers with no operator between them", () => {
    assert.equal(Number.isNaN(Number(normalizeDecimalInput("1 2"))), true);
  });
});
