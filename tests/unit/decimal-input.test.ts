import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateAmountExpression,
  formatAmountInput,
  normalizeDecimalInput,
  roundAmount,
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

// An amount field shows two decimal places once it is left (#1231), and what it shows is what is
// saved — so the rounding is half up on the decimal that was typed, never `toFixed`'s binary one.

describe("roundAmount (#1231)", () => {
  it("rounds half up on the decimal, where toFixed would round the double down", () => {
    assert.equal((1.555).toFixed(2), "1.55", "the trap this exists for");
    assert.equal(roundAmount(1.555), "1.56");
    assert.equal(roundAmount(1.005), "1.01");
    assert.equal(roundAmount(2.675), "2.68");
  });

  it("pads to exactly two places", () => {
    assert.equal(roundAmount(3), "3.00");
    assert.equal(roundAmount(1.5), "1.50");
    assert.equal(roundAmount(0.7), "0.70");
    assert.equal(roundAmount(0), "0.00");
  });

  it("rounds below the half down and carries into the whole part", () => {
    assert.equal(roundAmount(1.554), "1.55");
    assert.equal(roundAmount(9.995), "10.00");
    assert.equal(roundAmount(0.005), "0.01");
  });

  it("rounds a negative away from zero, and never writes a negative zero", () => {
    assert.equal(roundAmount(-1.555), "-1.56");
    assert.equal(roundAmount(-0.001), "0.00");
  });
});

describe("formatAmountInput (#1231)", () => {
  it("shows an amount with two decimal places", () => {
    assert.equal(formatAmountInput("1.5"), "1.50");
    assert.equal(formatAmountInput(".7"), "0.70");
    assert.equal(formatAmountInput("3"), "3.00");
    assert.equal(formatAmountInput("1."), "1.00");
  });

  it("accepts either decimal separator (#233)", () => {
    assert.equal(formatAmountInput("1,5"), "1.50");
  });

  it("rounds more than two places half up", () => {
    assert.equal(formatAmountInput("1.555"), "1.56");
    assert.equal(formatAmountInput("1,005"), "1.01");
  });

  it("formats an arithmetic expression by its result (#580)", () => {
    assert.equal(formatAmountInput("1+2.5"), "3.50");
    assert.equal(formatAmountInput("0,1+0,2"), "0.30");
    assert.equal(formatAmountInput("10/3"), "3.33");
  });

  it("leaves a blank field blank rather than writing zero (#1184)", () => {
    assert.equal(formatAmountInput(""), "");
    assert.equal(formatAmountInput("   "), "");
  });

  it("leaves what is not an amount as typed", () => {
    assert.equal(formatAmountInput("1+"), "1+");
    assert.equal(formatAmountInput("."), ".");
    assert.equal(formatAmountInput("1 2"), "1 2");
    assert.equal(formatAmountInput("abc"), "abc");
    assert.equal(formatAmountInput("-5"), "-5", "a negative is refused by the caller, as typed");
  });

  it("is stable: a formatted amount formats to itself", () => {
    assert.equal(formatAmountInput("12.50"), "12.50");
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
