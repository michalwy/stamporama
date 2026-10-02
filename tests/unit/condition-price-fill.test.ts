import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  factorFromSetPrices,
  fillConditionCell,
  formatPriceFactor,
  parsePriceFactor,
  planConditionFill,
  scaledPrice,
  type PriceFactor,
} from "../../src/lib/condition-price-fill";

function factor(parse: ReturnType<typeof parsePriceFactor>): PriceFactor {
  assert.equal(parse.ok, true, parse.ok ? "" : parse.message);
  if (!parse.ok) throw new Error("unreachable");
  return parse.factor;
}

const third = factor(factorFromSetPrices("30", "10"));

describe("factorFromSetPrices", () => {
  it("divides the target set price by the source one, exactly", () => {
    assert.deepEqual(third, { numerator: BigInt(1000), denominator: BigInt(3000) });
    assert.equal(formatPriceFactor(third), "×0.333");
    assert.equal(formatPriceFactor(factor(factorFromSetPrices("10", "25"))), "×2.5");
  });

  it("reads the set prices as amount fields show them", () => {
    assert.equal(formatPriceFactor(factor(factorFromSetPrices("12,50", "25"))), "×2");
    assert.equal(formatPriceFactor(factor(factorFromSetPrices("10+20", "10"))), "×0.333");
  });

  it("refuses a set price of zero", () => {
    const fromZero = factorFromSetPrices("0", "10");
    const toZero = factorFromSetPrices("30", "0.00");
    assert.equal(fromZero.ok, false);
    assert.equal(toZero.ok, false);
    assert.match(fromZero.ok ? "" : fromZero.message, /zero/);
    assert.match(toZero.ok ? "" : toZero.message, /zero/);
  });

  it("refuses a missing or unreadable set price", () => {
    assert.equal(factorFromSetPrices("", "10").ok, false);
    assert.equal(factorFromSetPrices("30", "  ").ok, false);
    assert.equal(factorFromSetPrices("abc", "10").ok, false);
    assert.equal(factorFromSetPrices("30", "-10").ok, false);
  });
});

describe("parsePriceFactor", () => {
  it("reads a number with either separator", () => {
    assert.deepEqual(factor(parsePriceFactor("0.5")), {
      numerator: BigInt(5),
      denominator: BigInt(10),
    });
    assert.equal(formatPriceFactor(factor(parsePriceFactor("0,333"))), "×0.333");
    assert.equal(formatPriceFactor(factor(parsePriceFactor("2"))), "×2");
    assert.equal(formatPriceFactor(factor(parsePriceFactor(".5"))), "×0.5");
  });

  it("reads a percentage", () => {
    assert.deepEqual(factor(parsePriceFactor("33.3%")), {
      numerator: BigInt(333),
      denominator: BigInt(1000),
    });
    assert.equal(formatPriceFactor(factor(parsePriceFactor("150 %"))), "×1.5");
  });

  it("takes back the grid's own × and an expression", () => {
    assert.equal(formatPriceFactor(factor(parsePriceFactor("×0.25"))), "×0.25");
    assert.equal(formatPriceFactor(factor(parsePriceFactor("x 1.2"))), "×1.2");
    assert.equal(formatPriceFactor(factor(parsePriceFactor("10/30"))), "×0.333");
  });

  it("refuses a factor of zero or less", () => {
    for (const raw of ["0", "0.00", "0%", "-0.5", "-50%", "1-2"]) {
      const r = parsePriceFactor(raw);
      assert.equal(r.ok, false, raw);
      assert.match(r.ok ? "" : r.message, /greater than zero/, raw);
    }
  });

  it("refuses what is not a number", () => {
    for (const raw of ["", "  ", "abc", "%", "1.2.3", "1+"]) {
      assert.equal(parsePriceFactor(raw).ok, false, raw);
    }
  });
});

describe("scaledPrice", () => {
  it("multiplies by the exact factor, so a third of 30 is 10", () => {
    assert.equal(scaledPrice("30.00", third), "10.00");
    assert.equal(scaledPrice("4.50", third), "1.50");
  });

  it("rounds half up to the cent", () => {
    // 1.00 / 3 = 0.333… → 0.33
    assert.equal(scaledPrice("1.00", third), "0.33");
    // 2.00 / 3 = 0.666… → 0.67
    assert.equal(scaledPrice("2.00", third), "0.67");
    // 0.05 × 1.1 = 0.055 → 0.06, not the binary double's 0.05
    assert.equal(scaledPrice("0.05", factor(parsePriceFactor("1.1"))), "0.06");
    // 1.25 × 110% = 1.375 → 1.38
    assert.equal(scaledPrice("1.25", factor(parsePriceFactor("110%"))), "1.38");
  });

  it("does not lose precision on a large price", () => {
    assert.equal(scaledPrice("123456789.99", third), "41152263.33");
  });

  it("answers nothing for a source that is not a price", () => {
    assert.equal(scaledPrice("", third), null);
    assert.equal(scaledPrice("abc", third), null);
  });
});

describe("fillConditionCell", () => {
  it("fills an empty cell from the source price", () => {
    assert.equal(fillConditionCell({ source: "30.00", current: "", factor: third }), "10.00");
    assert.equal(fillConditionCell({ source: "30.00", current: "  ", factor: third }), "10.00");
  });

  it("never overwrites a price already in the target cell", () => {
    assert.equal(fillConditionCell({ source: "30.00", current: "12.00", factor: third }), null);
    assert.equal(fillConditionCell({ source: "30.00", current: "0.00", factor: third }), null);
  });

  it("leaves the cell empty when the source has no price", () => {
    assert.equal(fillConditionCell({ source: "", current: "", factor: third }), null);
    assert.equal(fillConditionCell({ source: "   ", current: "", factor: third }), null);
  });
});

describe("planConditionFill", () => {
  it("fills only empty, unlocked rows with a source price", () => {
    const source = new Map([
      ["a", "30.00"],
      ["b", "30.00"],
      ["c", ""],
      ["d", "9.00"],
      ["e", "6.00"],
    ]);
    const current = new Map([["b", "11.00"]]);
    const fills = planConditionFill({
      rows: [
        { stampId: "a", locked: false },
        { stampId: "b", locked: false }, // already priced in the target
        { stampId: "c", locked: false }, // no source price
        { stampId: "d", locked: true }, // locked umbrella
        { stampId: "e", locked: false },
      ],
      source: (id) => source.get(id) ?? "",
      current: (id) => current.get(id) ?? "",
      factor: third,
    });
    assert.deepEqual(fills, [
      { stampId: "a", value: "10.00" },
      { stampId: "e", value: "2.00" },
    ]);
  });

  it("fills nothing when there is nothing to fill", () => {
    assert.deepEqual(
      planConditionFill({ rows: [], source: () => "1", current: () => "", factor: third }),
      []
    );
  });
});

describe("formatPriceFactor", () => {
  it("prints a small factor with significant digits rather than as zero", () => {
    assert.equal(formatPriceFactor(factor(parsePriceFactor("0.0012"))), "×0.0012");
    assert.equal(formatPriceFactor(factor(factorFromSetPrices("3000", "1"))), "×0.000333");
  });
});
