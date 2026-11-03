import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  applyFaultReduction,
  applyValueModifier,
  modifyValue,
  valuatePiece,
  type CopyValuation,
} from "../../src/lib/valuation";
import {
  assertValueModifier,
  describeValueModifierState,
  parseValueModifierInput,
  valueModifierColumns,
  valueModifierHint,
  valueModifierLabel,
} from "../../src/lib/value-modifier";

// A copy's catalogue value adjusted on the copy (#2357): catalogue value × (1 + percent) + amount,
// never below zero, and only then the fault reduction (#1560).

const NO_RATES = new Map<string, number | null>();

/** A catalogue valuation of `amount` in `currency`, converted to EUR at `rate`. */
function catalogue(amount: number | null, currency = "EUR", rate: number | null = 1): CopyValuation {
  const priced = amount !== null;
  const baseAmount = priced && rate !== null ? amount * rate : null;
  return {
    amount: priced ? amount.toFixed(2) : null,
    currency: priced ? currency : null,
    baseAmount,
    baseAmountDisplay: baseAmount === null ? null : baseAmount.toFixed(2),
    catalogNameId: priced ? "cat-michel" : null,
    editionYear: priced ? 2026 : null,
    uncertain: false,
    unpriced: !priced,
    mark: null,
    sourceStampId: null,
    unpricedVariantIds: [],
    piece: null,
    faultReduction: null,
    valueModifier: null,
  };
}

const modifier = (percent: number | null, amount: string | null, note: string | null = null) => ({
  percent,
  amount,
  note,
});

describe("modifyValue", () => {
  it("multiplies by the percentage, then adds the amount", () => {
    assert.equal(modifyValue(10, modifier(200, null)), 30);
    assert.equal(modifyValue(10, modifier(null, "5.00")), 15);
    assert.equal(modifyValue(10, modifier(200, "5.00")), 35);
    assert.equal(modifyValue(10, modifier(-50, "1.25")), 6.25);
  });

  it("floors a negative result at zero", () => {
    assert.equal(modifyValue(10, modifier(null, "-25.00")), 0);
    assert.equal(modifyValue(10, modifier(-100, "-1.00")), 0);
    assert.equal(modifyValue(10, modifier(-100, null)), 0);
  });

  it("leaves the amount alone with no modifier", () => {
    assert.equal(modifyValue(10, null), 10);
    assert.equal(modifyValue(10, modifier(null, null)), 10);
  });
});

describe("applyValueModifier", () => {
  it("adjusts the figure in its own currency and keeps the catalogue's beside it", () => {
    const v = applyValueModifier(catalogue(10), modifier(200, "5.00", "Stempel Danzig"), "EUR", NO_RATES);
    assert.equal(v.amount, "35.00");
    assert.equal(v.baseAmountDisplay, "35.00");
    assert.deepEqual(v.valueModifier, {
      percent: 200,
      amount: "5.00",
      note: "Stempel Danzig",
      fullAmount: "10.00",
      fullBaseAmount: 10,
      fullBaseAmountDisplay: "10.00",
    });
    // Where the figure was read is unchanged.
    assert.equal(v.catalogNameId, "cat-michel");
    assert.equal(v.editionYear, 2026);
  });

  it("states the amount in the catalogue's currency and converts it with the figure", () => {
    // 10 PLN + 5 PLN = 15 PLN, at 0.25 EUR per PLN: 3.75 EUR — never 10 PLN + 5 EUR.
    const rates = new Map<string, number | null>([["PLN", 0.25]]);
    const v = applyValueModifier(catalogue(10, "PLN", 0.25), modifier(null, "5.00"), "EUR", rates);
    assert.equal(v.amount, "15.00");
    assert.equal(v.currency, "PLN");
    assert.equal(v.baseAmountDisplay, "3.75");
  });

  it("keeps an unconvertible figure unconvertible", () => {
    const v = applyValueModifier(catalogue(10, "PLN", null), modifier(100, null), "EUR", NO_RATES);
    assert.equal(v.amount, "20.00");
    assert.equal(v.baseAmount, null);
  });

  it("floors a negative amount at zero", () => {
    const v = applyValueModifier(catalogue(10), modifier(null, "-12.00"), "EUR", NO_RATES);
    assert.equal(v.amount, "0.00");
    assert.equal(v.baseAmountDisplay, "0.00");
    assert.equal(v.unpriced, false);
  });

  it("gives a copy with no catalogue value no value from the modifier alone", () => {
    const unpriced = catalogue(null);
    const v = applyValueModifier(unpriced, modifier(null, "50.00"), "EUR", NO_RATES);
    assert.equal(v, unpriced);
    assert.equal(v.unpriced, true);
    assert.equal(v.amount, null);
    assert.equal(v.valueModifier, null);
  });

  it("adjusts a piece's computed figure the same way (#2359)", () => {
    const computed = valuatePiece(
      { amount: 20, rule: "sum_of_used", usage: null, partial: false, missing: [], terms: [] },
      {
        method: "michel",
        methodSource: { kind: "collection" },
        inherited: { method: "michel", areaId: null, areaName: null },
        franking: "rate_correct",
        kind: "on_cover",
        components: [],
      },
      false,
      "EUR"
    );
    const v = applyValueModifier(computed, modifier(50, null), "EUR", NO_RATES);
    assert.equal(v.amount, "30.00");
    assert.equal(v.piece?.method, "michel");
  });

  it("comes before the fault reduction, which lowers the modified figure", () => {
    // 10 × 3 + 5 = 35, then −40 % = 21 — not (10 − 40 %) × 3 + 5 = 23.
    const modified = applyValueModifier(catalogue(10), modifier(200, "5.00"), "EUR", NO_RATES);
    const v = applyFaultReduction(modified, 40);
    assert.equal(v.amount, "21.00");
    assert.equal(v.baseAmountDisplay, "21.00");
    assert.equal(v.faultReduction?.fullAmount, "35.00");
    assert.equal(v.valueModifier?.fullAmount, "10.00");
  });

  it("floors at zero before the fault reduction, which leaves zero at zero", () => {
    const modified = applyValueModifier(catalogue(10), modifier(null, "-20.00"), "EUR", NO_RATES);
    assert.equal(applyFaultReduction(modified, 50).amount, "0.00");
  });
});

describe("parseValueModifierInput", () => {
  it("reads a signed whole percentage, an amount and a note", () => {
    assert.deepEqual(parseValueModifierInput("200", "", "Stempel Danzig"), {
      ok: true,
      value: { percent: 200, amount: null, note: "Stempel Danzig" },
    });
    assert.deepEqual(parseValueModifierInput("+200 %", "5", ""), {
      ok: true,
      value: { percent: 200, amount: "5.00", note: null },
    });
    assert.deepEqual(parseValueModifierInput("-100", "-2,5", " cut "), {
      ok: true,
      value: { percent: -100, amount: "-2.50", note: "cut" },
    });
    assert.deepEqual(parseValueModifierInput("", "2+3", ""), {
      ok: true,
      value: { percent: null, amount: "5.00", note: null },
    });
  });

  it("reads blank and zero as none, dropping the note with it", () => {
    assert.deepEqual(parseValueModifierInput("", "", ""), { ok: true, value: null });
    assert.deepEqual(parseValueModifierInput("0", "0.00", "a note"), { ok: true, value: null });
  });

  it("refuses a fraction, text and anything below −100 %", () => {
    for (const [p, a] of [["12.5", ""], ["abc", ""], ["-101", ""], ["", "abc"]]) {
      assert.equal(parseValueModifierInput(p, a, "").ok, false, `${p} / ${a}`);
    }
  });
});

describe("assertValueModifier", () => {
  it("accepts none and a real modifier", () => {
    assertValueModifier(undefined);
    assertValueModifier(null);
    assertValueModifier(modifier(-100, null));
    assertValueModifier(modifier(null, "-3.00"));
  });

  it("refuses below −100 %, a fraction, a zero and an empty one", () => {
    assert.throws(() => assertValueModifier(modifier(-101, null)), /from −100 up/);
    assert.throws(() => assertValueModifier(modifier(2.5, null)), /whole number/);
    assert.throws(() => assertValueModifier(modifier(0, null)), /zero/);
    assert.throws(() => assertValueModifier(modifier(null, "0.00")), /zero/);
    assert.throws(() => assertValueModifier(modifier(null, null, "note")), /percentage or an amount/);
  });

  it("stores none as null in all three columns", () => {
    assert.deepEqual(valueModifierColumns(null), {
      valueModifierPercent: null,
      valueModifierAmount: null,
      valueModifierNote: null,
    });
  });
});

describe("the words on a modified figure", () => {
  it("signs the percentage and the amount", () => {
    assert.equal(valueModifierLabel(modifier(200, null), "EUR"), "+200 %");
    assert.equal(valueModifierLabel(modifier(null, "-3.00"), "EUR"), "−3.00 EUR");
    assert.equal(valueModifierLabel(modifier(-50, "5.00"), null), "−50 % +5.00");
  });

  it("names the catalogue figure, the modifier and its note", () => {
    assert.equal(
      valueModifierHint("10.00", "EUR", modifier(200, null, "Stempel Danzig")),
      "Catalogue 10.00 EUR, +200 % (Stempel Danzig)"
    );
    assert.equal(valueModifierHint("10.00", "EUR", modifier(null, "5.00")), "Catalogue 10.00 EUR, +5.00 EUR");
  });

  it("words the bulk edit's line for one copy and for many", () => {
    assert.equal(describeValueModifierState(0, 1), "It has no modifier yet.");
    assert.equal(describeValueModifierState(1, 1), "It already has a modifier.");
    assert.equal(describeValueModifierState(0, 3), "None has a modifier yet.");
    assert.equal(describeValueModifierState(3, 3), "All 3 have a modifier.");
    assert.equal(describeValueModifierState(1, 3), "1 of 3 has a modifier.");
  });
});
