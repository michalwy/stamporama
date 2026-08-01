import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { parseCatalogNumberSpec } from "../../src/lib/catalog-number";

/** The numbers a spec generates, or the error it produced (so a mistake reads as a message
 *  rather than a thrown property access). */
function numbers(input: string): string[] | string {
  const spec = parseCatalogNumberSpec(input);
  return "error" in spec ? spec.error : spec.numbers;
}

/** The series range a spec declares, as "first–last" (or just "first" when it has no last). */
function declared(input: string): string {
  const spec = parseCatalogNumberSpec(input);
  if ("error" in spec) return spec.error;
  const { firstNumber, lastNumber } = spec.declared;
  return lastNumber ? `${firstNumber}-${lastNumber}` : firstNumber;
}

describe("parseCatalogNumberSpec — the worked examples (#452)", () => {
  it("expands a plain range", () => {
    assert.deepEqual(numbers("2820-2822"), ["2820", "2821", "2822"]);
    assert.equal(declared("2820-2822"), "2820-2822");
  });

  it("takes several single numbers off one base", () => {
    assert.deepEqual(numbers("2823a, 2823b"), ["2823a", "2823b"]);
    // Suffixes are dropped from the series range, which leaves one base number.
    assert.equal(declared("2823a, 2823b"), "2823");
  });

  it("takes two variant runs, keeping the typed order", () => {
    assert.deepEqual(numbers("2895A-2897A, 2895B-2897B"), [
      "2895A",
      "2896A",
      "2897A",
      "2895B",
      "2896B",
      "2897B",
    ]);
    assert.equal(declared("2895A-2897A, 2895B-2897B"), "2895-2897");
  });
});

describe("parseCatalogNumberSpec — schemes it inherits from the range engine", () => {
  it("keeps a shared prefix (#149), in the numbers and in the range", () => {
    assert.deepEqual(numbers("BL120-BL123"), ["BL120", "BL121", "BL122", "BL123"]);
    assert.equal(declared("BL120-BL123"), "BL120-BL123");
  });

  it("enumerates a letter suffix sequence (#150)", () => {
    assert.deepEqual(numbers("423a-423c"), ["423a", "423b", "423c"]);
    assert.equal(declared("423a-423c"), "423");
  });

  it("enumerates a roman suffix sequence (#150)", () => {
    assert.deepEqual(numbers("12I-12II"), ["12I", "12II"]);
    assert.equal(declared("12I-12II"), "12");
  });

  it("enumerates bare Roman numerals as their own range (#383)", () => {
    assert.deepEqual(numbers("I-IV"), ["I", "II", "III", "IV"]);
    assert.equal(declared("I-IV"), "I-IV");
  });

  it("takes an en dash or em dash as the range separator", () => {
    assert.deepEqual(numbers("2820–2822"), ["2820", "2821", "2822"]);
    assert.deepEqual(numbers("2820—2822"), ["2820", "2821", "2822"]);
  });

  it("ignores spacing around the parts", () => {
    assert.deepEqual(numbers("  2820 - 2821 ,  2823a  "), ["2820", "2821", "2823a"]);
  });
});

describe("parseCatalogNumberSpec — a spec that mixes numbering families", () => {
  it("takes a block alongside the ordinary run, and declares the ordinary one", () => {
    assert.deepEqual(numbers("3025-3027, BL48"), ["3025", "3026", "3027", "BL48"]);
    // A declared range can only be one family, and the basic numbering outranks the rest —
    // the same ranking an issue's members are read with.
    assert.equal(declared("3025-3027, BL48"), "3025-3027");
  });

  it("does not care which family was typed first", () => {
    assert.equal(declared("BL48, 3025-3027"), "3025-3027");
  });

  it("measures blocks only when there is no basic numbering at all", () => {
    assert.equal(declared("BL48, BL50"), "BL48-BL50");
    assert.equal(declared("BL48"), "BL48");
  });

  it("lets a basic number outrank a bare Roman range", () => {
    assert.deepEqual(numbers("I-IV, 2820"), ["I", "II", "III", "IV", "2820"]);
    assert.equal(declared("I-IV, 2820"), "2820");
  });

  it("ignores a foreign family when widening, not when generating", () => {
    // BL48 sits outside the measured family, so it adds a stamp without stretching the range.
    assert.deepEqual(numbers("BL48, 3025-3027, Ark. 3"), [
      "BL48",
      "3025",
      "3026",
      "3027",
      "Ark. 3",
    ]);
    assert.equal(declared("BL48, 3025-3027, Ark. 3"), "3025-3027");
  });
});

describe("parseCatalogNumberSpec — states it tolerates while being typed", () => {
  it("ignores a trailing comma", () => {
    assert.deepEqual(numbers("2820-2822,"), ["2820", "2821", "2822"]);
    assert.deepEqual(numbers("2820-2822, "), ["2820", "2821", "2822"]);
  });

  it("reads a dash with nothing after it as a single number", () => {
    assert.deepEqual(numbers("2820-"), ["2820"]);
  });

  it("reads one number as one stamp", () => {
    assert.deepEqual(numbers("2820"), ["2820"]);
    assert.equal(declared("2820"), "2820");
  });
});

describe("parseCatalogNumberSpec — what it rejects", () => {
  it("rejects an empty spec", () => {
    assert.equal(numbers(""), "Enter at least one catalog number.");
    assert.equal(numbers("  ,  "), "Enter at least one catalog number.");
  });

  it("rejects more than one dash in a segment", () => {
    assert.match(numbers("2820-2821-2822") as string, /one dash per range/);
  });

  it("rejects a number repeated across segments", () => {
    assert.equal(numbers("2820-2822, 2821"), "2821 appears more than once.");
  });

  it("passes the range engine's own errors straight through", () => {
    assert.equal(numbers("2822-2820"), "First catalog number must be ≤ Last.");
    assert.match(numbers("2820A-2822B") as string, /only the number or only the suffix/);
  });
});
