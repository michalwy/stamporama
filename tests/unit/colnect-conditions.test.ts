import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COLNECT_CONDITIONS,
  colnectGradeFor,
  guessColnectGrade,
  isColnectConditionValue,
} from "../../src/lib/colnect-conditions";

describe("colnectGradeFor", () => {
  it("resolves a stored value to the grade it renders as", () => {
    assert.equal(colnectGradeFor("1")?.label, "MNH - Mint Never Hinged");
    assert.equal(colnectGradeFor(" 4 ")?.label, "U - Used");
  });

  it("refuses a value Colnect does not offer", () => {
    assert.equal(colnectGradeFor("9"), null);
    assert.equal(colnectGradeFor(""), null);
  });
});

describe("isColnectConditionValue", () => {
  it("accepts every value in the vocabulary and nothing else", () => {
    for (const grade of COLNECT_CONDITIONS) assert.ok(isColnectConditionValue(grade.value));
    assert.equal(isColnectConditionValue("MNH"), false);
    assert.equal(isColnectConditionValue("0"), false);
  });
});

describe("guessColnectGrade", () => {
  it("matches a seeded condition's abbreviation, case-insensitively", () => {
    assert.equal(guessColnectGrade("MNH")?.value, "1");
    assert.equal(guessColnectGrade(" cto ")?.value, "5");
  });

  it("proposes nothing for a condition Colnect has no grade for", () => {
    // The collection seeds `FDC` too, and Colnect's list has no cover option.
    assert.equal(guessColnectGrade("FDC"), null);
    assert.equal(guessColnectGrade(""), null);
  });

  it("never guesses from the name", () => {
    assert.equal(guessColnectGrade("Mint Never Hinged"), null);
  });
});
