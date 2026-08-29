import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseVariantNumberSpec } from "../../src/lib/catalog-number";

/** The numbers a variant spec generates under `base`, or the error it produced. */
function numbers(input: string, base = "240"): string[] | string {
  const spec = parseVariantNumberSpec(input, base);
  return "error" in spec ? spec.error : spec.numbers;
}

describe("parseVariantNumberSpec — the base number is understood (#722)", () => {
  it("expands a bare letter range", () => {
    assert.deepEqual(numbers("a-f"), ["240a", "240b", "240c", "240d", "240e", "240f"]);
  });

  it("takes a bare list of suffixes, keeping the typed order", () => {
    assert.deepEqual(numbers("a, b, c"), ["240a", "240b", "240c"]);
    assert.deepEqual(numbers("c,a"), ["240c", "240a"]);
  });

  it("reads the same range written in full", () => {
    assert.deepEqual(numbers("240a-240c"), ["240a", "240b", "240c"]);
    assert.deepEqual(numbers("240a, 240b"), ["240a", "240b"]);
  });

  it("enumerates Roman-numeral suffixes", () => {
    assert.deepEqual(numbers("I-III"), ["240I", "240II", "240III"]);
  });

  it("mixes the two forms in one spec", () => {
    assert.deepEqual(numbers("a-b, 241a"), ["240a", "240b", "241a"]);
  });

  it("takes a lone suffix literally, so a variant of a variant can be numbered", () => {
    // `309A` + `P` is `309AP` — a suffix no sequence would have produced (Infla).
    assert.deepEqual(numbers("P", "309A"), ["309AP"]);
    assert.deepEqual(numbers("a-c", "309A"), ["309Aa", "309Ab", "309Ac"]);
  });

  it("tolerates the half-typed states a live field passes through", () => {
    assert.deepEqual(numbers("a,"), ["240a"]);
    assert.equal(numbers(""), "Enter at least one variant number.");
    assert.equal(numbers("   "), "Enter at least one variant number.");
  });

  it("rejects a range whose ends sit on different sequences", () => {
    assert.match(String(numbers("a-III")), /letters, or both Roman numerals/);
  });

  it("rejects a descending range", () => {
    assert.equal(numbers("f-a"), "First suffix must be ≤ Last suffix.");
  });

  it("rejects a suffix sequence it cannot enumerate", () => {
    assert.match(String(numbers("P-S")), /letters a–z or Roman numerals/);
  });

  it("rejects a half-bare range rather than guessing which axis it is on", () => {
    assert.equal(numbers("240a-c"), "Last catalog number must contain a number.");
  });

  it("rejects the same number twice", () => {
    assert.equal(numbers("a, a"), "240a appears more than once.");
    assert.equal(numbers("a-c, 240b"), "240b appears more than once.");
  });

  it("says so when the base stamp carries no number in that catalogue", () => {
    assert.match(String(numbers("a-c", "")), /write the variants' numbers in full/);
    // The full form still works there.
    assert.deepEqual(numbers("240a-240b", ""), ["240a", "240b"]);
  });
});
