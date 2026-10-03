import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  faultReducedTotalHint,
  faultReductionHint,
  faultReductionNote,
  parseFaultReductionInput,
} from "../../src/lib/fault-reduction";

// A copy's value lowered by a percentage typed on it, for its faults (#1560): the input the copy
// dialog and bulk edit read, and the words every reduced figure carries.
describe("parseFaultReductionInput", () => {
  it("reads a whole percentage, with or without the sign", () => {
    assert.deepEqual(parseFaultReductionInput("40"), { ok: true, value: 40 });
    assert.deepEqual(parseFaultReductionInput(" 40 % "), { ok: true, value: 40 });
    assert.deepEqual(parseFaultReductionInput("100"), { ok: true, value: 100 });
    assert.deepEqual(parseFaultReductionInput("1"), { ok: true, value: 1 });
  });

  it("reads blank and zero as no reduction — one spelling for none", () => {
    assert.deepEqual(parseFaultReductionInput(""), { ok: true, value: null });
    assert.deepEqual(parseFaultReductionInput("   "), { ok: true, value: null });
    assert.deepEqual(parseFaultReductionInput("0"), { ok: true, value: null });
  });

  it("refuses a fraction, a negative, text and anything over 100", () => {
    for (const raw of ["12.5", "-5", "abc", "101", "1e2"]) {
      assert.equal(parseFaultReductionInput(raw).ok, false, raw);
    }
  });
});

describe("the words on a reduced figure", () => {
  it("names the percentage", () => {
    assert.equal(faultReductionNote(40), "−40 % for faults");
  });

  it("names the full figure and the percentage on a copy", () => {
    assert.equal(faultReductionHint("45.00", "EUR", 40), "45.00 EUR, −40 % for faults");
    assert.equal(faultReductionHint("45.00", null, 40), "45.00, −40 % for faults");
  });

  it("names how many copies a total lowered, and the total without the reductions", () => {
    assert.equal(
      faultReducedTotalHint(2, "100.00", "27.50", "PLN"),
      "2 copies lowered for faults — 127.50 PLN without the reductions"
    );
    assert.equal(
      faultReducedTotalHint(1, "10.00", "5.00", null),
      "1 copy lowered for faults — 15.00 without the reductions"
    );
  });

  it("says nothing about a total no copy lowered", () => {
    assert.equal(faultReducedTotalHint(0, "100.00", "0.00", "PLN"), null);
  });
});
