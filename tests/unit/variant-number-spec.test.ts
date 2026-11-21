import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseVariantNumberSpec, type VariantNumberMode } from "../../src/lib/catalog-number";

/** The numbers a variant spec generates under `base`, or the error it produced. */
function numbers(input: string, base = "240", mode: VariantNumberMode = "suffixes"): string[] | string {
  const spec = parseVariantNumberSpec(input, base, { mode });
  return "error" in spec ? spec.error : spec.numbers;
}

/** The same, read as full numbers. */
const full = (input: string, base = "240") => numbers(input, base, "full");

describe("parseVariantNumberSpec — suffixes hung off the base number (#722)", () => {
  it("expands a bare letter range", () => {
    assert.deepEqual(numbers("a-f"), ["240a", "240b", "240c", "240d", "240e", "240f"]);
  });

  it("takes a bare list of suffixes, keeping the typed order", () => {
    assert.deepEqual(numbers("a, b, c"), ["240a", "240b", "240c"]);
    assert.deepEqual(numbers("c,a"), ["240c", "240a"]);
  });

  it("enumerates Roman-numeral suffixes", () => {
    assert.deepEqual(numbers("I-III"), ["240I", "240II", "240III"]);
  });

  it("enumerates uppercase-letter suffixes", () => {
    assert.deepEqual(numbers("A-B"), ["240A", "240B"]);
    assert.deepEqual(numbers("A-D"), ["240A", "240B", "240C", "240D"]);
    // The tie with Roman numerals is settled for the **pair**: `F` spells no numeral, so the whole
    // range is letters even though `C` alone would have read as 100.
    assert.deepEqual(numbers("C-F"), ["240C", "240D", "240E", "240F"]);
    assert.deepEqual(numbers("P-S"), ["240P", "240Q", "240R", "240S"]);
  });

  it("keeps a Roman-valid pair Roman", () => {
    // Both ends spell canonical numerals, so this stays the numeral run it always was — even
    // though the letters would also have made sense. Writing them out ("I, J") says otherwise.
    assert.deepEqual(numbers("I-V"), ["240I", "240II", "240III", "240IV", "240V"]);
  });

  it("takes a lone suffix literally, so a variant of a variant can be numbered", () => {
    // `309A` + `P` is `309AP` — a suffix no sequence would have produced (Infla).
    assert.deepEqual(numbers("P", "309A"), ["309AP"]);
    assert.deepEqual(numbers("a-c", "309A"), ["309Aa", "309Ab", "309Ac"]);
  });

  it("tolerates the half-typed states a live field passes through", () => {
    assert.deepEqual(numbers("a,"), ["240a"]);
    assert.deepEqual(numbers("a-"), ["240a"]);
    assert.equal(numbers(""), "Enter at least one variant number.");
    assert.equal(numbers("   "), "Enter at least one variant number.");
  });

  it("rejects a range whose ends sit on different sequences", () => {
    assert.match(String(numbers("a-III")), /Unrecognized suffix sequence/);
    assert.match(String(numbers("a-C")), /Unrecognized suffix sequence/);
  });

  it("rejects a descending range", () => {
    assert.equal(numbers("f-a"), "First suffix must be ≤ Last suffix.");
    assert.equal(numbers("D-A"), "First suffix must be ≤ Last suffix.");
    assert.equal(numbers("x5-x2"), "First suffix must be ≤ Last suffix.");
  });

  it("rejects a suffix sequence it cannot enumerate", () => {
    assert.match(String(numbers("CKB-KB")), /Unrecognized suffix sequence/);
    assert.match(String(numbers("x2-y4")), /Unrecognized suffix sequence/);
  });

  it("rejects the same number twice", () => {
    assert.equal(numbers("a, a"), "240a appears more than once.");
    assert.equal(numbers("a-c, b"), "240b appears more than once.");
  });

  it("points to full numbers when the base stamp carries no number in that catalogue", () => {
    assert.match(String(numbers("a-c", "")), /choose Full numbers/);
  });
});

describe("parseVariantNumberSpec — a suffix may carry a digit (#2671)", () => {
  it("hangs a suffix with a digit off the base, never reading it as a full number", () => {
    assert.deepEqual(numbers("x2, z2, y3", "88B"), ["88Bx2", "88Bz2", "88By3"]);
  });

  it("runs a suffix whose ends differ only in a trailing number", () => {
    assert.deepEqual(numbers("x2-x4", "88B"), ["88Bx2", "88Bx3", "88Bx4"]);
    assert.deepEqual(numbers("T.1-T.3", "88B"), ["88BT.1", "88BT.2", "88BT.3"]);
    assert.deepEqual(numbers("1-3", "88B"), ["88B1", "88B2", "88B3"]);
  });

  it("keeps a padded run as wide as it was typed", () => {
    assert.deepEqual(numbers("x08-x11", "88B"), ["88Bx08", "88Bx09", "88Bx10", "88Bx11"]);
  });

  it("hangs even a whole number off the base, because the collector said these are suffixes", () => {
    assert.deepEqual(numbers("240a", "240"), ["240240a"]);
  });
});

describe("parseVariantNumberSpec — full numbers (#2671)", () => {
  it("takes every piece as a whole catalogue number", () => {
    assert.deepEqual(full("240a-240c"), ["240a", "240b", "240c"]);
    assert.deepEqual(full("240a, 240b"), ["240a", "240b"]);
    assert.deepEqual(full("240a-240b, 241a"), ["240a", "240b", "241a"]);
  });

  it("needs no number on the base stamp", () => {
    assert.deepEqual(full("240a-240b", ""), ["240a", "240b"]);
  });

  it("rejects a half-bare range rather than guessing which axis it is on", () => {
    assert.equal(full("240a-c"), "Last catalog number must contain a number.");
  });

  it("ignores Separate with a space", () => {
    const spec = parseVariantNumberSpec("240a-240b", "240", { mode: "full", separateWithSpace: true });
    assert.deepEqual(spec, { numbers: ["240a", "240b"] });
  });

  it("rejects the same number twice", () => {
    assert.equal(full("240a-240c, 240b"), "240b appears more than once.");
  });
});

describe("parseVariantNumberSpec — Separate with a space (#2652)", () => {
  const spaced = (input: string, base = "88B") => {
    const spec = parseVariantNumberSpec(input, base, { mode: "suffixes", separateWithSpace: true });
    return "error" in spec ? spec.error : spec.numbers;
  };

  it("puts one space between the base and each lone suffix", () => {
    assert.deepEqual(spaced("T.I, T.II, T.III"), ["88B T.I", "88B T.II", "88B T.III"]);
  });

  it("separates every suffix a range generates", () => {
    assert.deepEqual(spaced("a-c"), ["88B a", "88B b", "88B c"]);
    assert.deepEqual(spaced("I-III", "240"), ["240 I", "240 II", "240 III"]);
    assert.deepEqual(spaced("x2-x3"), ["88B x2", "88B x3"]);
  });

  it("uses one space, whatever spaces are typed around the commas", () => {
    assert.deepEqual(spaced("  T.I ,   T.II  "), ["88B T.I", "88B T.II"]);
    assert.deepEqual(spaced("a - b", " 88B "), ["88B a", "88B b"]);
  });

  it("joins the suffixes straight on when unticked, as before", () => {
    assert.deepEqual(numbers("T.I, T.II, T.III", "88B"), ["88BT.I", "88BT.II", "88BT.III"]);
    const spec = parseVariantNumberSpec("T.I", "88B", { mode: "suffixes", separateWithSpace: false });
    assert.deepEqual(spec, { numbers: ["88BT.I"] });
  });
});
