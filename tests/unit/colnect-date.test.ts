import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatPartialDate,
  parseColnectDate,
  proposeIssuedDate,
  type PartialDate,
} from "../../src/lib/colnect-date";

// Syncing the date of issue from a matched Colnect item (#655). The interesting part is the
// per-field comparison: Colnect dating a stamp we hold by year alone is not a disagreement, while a
// different day is one nothing may resolve on its own.

const mine = (year: number | null, month: number | null = null, day: number | null = null): PartialDate => ({
  year,
  month,
  day,
});

describe("parseColnectDate", () => {
  it("reads a full date", () => {
    assert.deepEqual(parseColnectDate("1945-01-22"), { year: 1945, month: 1, day: 22 });
  });

  it("reads a partial date", () => {
    assert.deepEqual(parseColnectDate("1945-01"), { year: 1945, month: 1, day: null });
    assert.deepEqual(parseColnectDate("1945"), { year: 1945, month: null, day: null });
  });

  it("tolerates surrounding whitespace and trailing text", () => {
    assert.deepEqual(parseColnectDate("  1945-01-22  "), { year: 1945, month: 1, day: 22 });
    assert.deepEqual(parseColnectDate("1945-01-22 (issued)"), { year: 1945, month: 1, day: 22 });
  });

  it("gives up on anything that is not a date", () => {
    assert.equal(parseColnectDate(""), null);
    assert.equal(parseColnectDate(null), null);
    assert.equal(parseColnectDate("unknown"), null);
    assert.equal(parseColnectDate("194"), null);
  });

  it("drops an out-of-range component rather than clamping it", () => {
    assert.deepEqual(parseColnectDate("1945-13-02"), { year: 1945, month: null, day: null });
    assert.deepEqual(parseColnectDate("1945-01-42"), { year: 1945, month: 1, day: null });
  });
});

describe("formatPartialDate", () => {
  it("formats what it has", () => {
    assert.equal(formatPartialDate(mine(1945, 1, 22)), "22 Jan 1945");
    assert.equal(formatPartialDate(mine(1945)), "1945");
    assert.equal(formatPartialDate(mine(null)), null);
  });
});

describe("proposeIssuedDate", () => {
  const colnect = parseColnectDate("1945-01-22");

  it("fills an undated stamp", () => {
    const p = proposeIssuedDate(colnect, mine(null));
    assert.equal(p?.status, "would-fill");
    assert.deepEqual(p?.date, { year: 1945, month: 1, day: 22 });
    assert.equal(p?.label, "22 Jan 1945");
    assert.equal(p?.currentLabel, null);
  });

  it("adds precision to a stamp dated by year alone", () => {
    const p = proposeIssuedDate(colnect, mine(1945));
    assert.equal(p?.status, "would-fill");
    assert.deepEqual(p?.date, { year: 1945, month: 1, day: 22 });
    assert.equal(p?.currentLabel, "1945");
  });

  it("proposes nothing when the two sides already agree", () => {
    assert.equal(proposeIssuedDate(colnect, mine(1945, 1, 22)), null);
  });

  it("proposes nothing when Colnect knows less than we do", () => {
    assert.equal(proposeIssuedDate(parseColnectDate("1945"), mine(1945, 1, 22)), null);
    assert.equal(proposeIssuedDate(parseColnectDate("1945-01"), mine(1945, 1, 22)), null);
  });

  it("proposes nothing when the item states no date", () => {
    assert.equal(proposeIssuedDate(null, mine(null)), null);
  });

  it("reports a differing year as a conflict, replacing the date whole", () => {
    const p = proposeIssuedDate(parseColnectDate("1946"), mine(1945, 1, 22));
    assert.equal(p?.status, "conflict");
    // Colnect's date, whole: our day belongs to a year the collector just abandoned.
    assert.deepEqual(p?.date, { year: 1946, month: null, day: null });
    assert.equal(p?.currentLabel, "22 Jan 1945");
    assert.equal(p?.colnectLabel, "1946");
    assert.deepEqual(p?.conflictingFields, ["year"]);
  });

  it("reports a differing month or day as a conflict", () => {
    const month = proposeIssuedDate(colnect, mine(1945, 2, 22));
    assert.equal(month?.status, "conflict");
    assert.deepEqual(month?.conflictingFields, ["month"]);

    const day = proposeIssuedDate(colnect, mine(1945, 1, 23));
    assert.equal(day?.status, "conflict");
    assert.deepEqual(day?.conflictingFields, ["day"]);
    assert.deepEqual(day?.date, { year: 1945, month: 1, day: 22 });
  });

  it("names every field the two sides disagree about", () => {
    const p = proposeIssuedDate(colnect, mine(1946, 2, 23));
    assert.deepEqual(p?.conflictingFields, ["year", "month", "day"]);
  });

  it("treats a field only one side states as no disagreement", () => {
    // A month with no year of its own is odd data, but it agrees with Colnect's — so the year and
    // day are still a plain fill.
    const p = proposeIssuedDate(colnect, mine(null, 1, null));
    assert.equal(p?.status, "would-fill");
    assert.deepEqual(p?.date, { year: 1945, month: 1, day: 22 });
  });
});
