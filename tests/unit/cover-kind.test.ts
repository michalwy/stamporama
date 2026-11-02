import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { COVER_FORMATS, COVER_KINDS, isCoverKind, sortPriceFormats, type CoverKind } from "../../src/lib/cover-kind";

// The four cover-price formats (#2356): their order after a copy's formats, and the guard that
// tells them apart. The rows themselves, and the copy pickers leaving them out, are in
// `tests/integration/cover-prices.test.ts`.

const row = (name: string, sortOrder: number, coverKind: CoverKind | null = null) => ({ name, sortOrder, coverKind });

describe("cover-price formats (#2356)", () => {
  it("puts a copy's formats first in the collector's order, then the cover prices in theirs", () => {
    const sorted = sortPriceFormats([
      row("On piece", 0, "on_piece"),
      row("Block of 4", 1),
      row("Cover EF", 3, "cover_ef"),
      row("Pair", 0),
      row("Cover MiF", 1, "cover_mif"),
      row("Cover MeF", 2, "cover_mef"),
    ]);
    assert.deepEqual(
      sorted.map((f) => f.name),
      ["Pair", "Block of 4", "Cover EF", "Cover MeF", "Cover MiF", "On piece"]
    );
  });

  it("seeds one row per kind, abbreviated by its name", () => {
    assert.deepEqual(COVER_FORMATS.map((f) => f.coverKind), [...COVER_KINDS]);
    assert.ok(COVER_FORMATS.every((f) => f.abbreviation === f.name));
  });

  it("recognises only the four kinds", () => {
    assert.ok(COVER_KINDS.every(isCoverKind));
    assert.equal(isCoverKind("cover"), false);
    assert.equal(isCoverKind(null), false);
  });
});
