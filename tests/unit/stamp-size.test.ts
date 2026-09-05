import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAX_SIZE_MM,
  MIN_SIZE_MM,
  NO_STAMP_SIZE,
  formatSizeMm,
  formatStampSize,
  parseSizeMm,
  resolveStampSize,
  roundSizeMm,
  sizeFromScanPixels,
  statedStampSize,
  type StampSizeEntry,
} from "../../src/lib/stamp-size";

describe("parseSizeMm", () => {
  it("reads a whole number and a decimal", () => {
    assert.deepEqual(parseSizeMm("21"), { ok: true, mm: 21 });
    assert.deepEqual(parseSizeMm("21.5"), { ok: true, mm: 21.5 });
    assert.deepEqual(parseSizeMm("  25.4  "), { ok: true, mm: 25.4 });
  });

  it("reads a comma as a decimal point", () => {
    assert.deepEqual(parseSizeMm("21,5"), { ok: true, mm: 21.5 });
  });

  it("rounds to the precision a size is stated at", () => {
    assert.deepEqual(parseSizeMm("21.44"), { ok: true, mm: 21.4 });
    assert.deepEqual(parseSizeMm("21.46"), { ok: true, mm: 21.5 });
  });

  it("treats blank as no figure rather than as a bad one", () => {
    assert.deepEqual(parseSizeMm(""), { ok: true, mm: null });
    assert.deepEqual(parseSizeMm("   "), { ok: true, mm: null });
    assert.deepEqual(parseSizeMm(null), { ok: true, mm: null });
    assert.deepEqual(parseSizeMm(undefined), { ok: true, mm: null });
  });

  it("refuses anything it cannot read, rather than storing null over a real size", () => {
    for (const bad of ["abc", "21mm", "21.5.1", "-21", "21½", "1e3", "21 5", ".5", "21."]) {
      assert.deepEqual(parseSizeMm(bad), { ok: false }, bad);
    }
  });

  it("refuses a figure outside what a stamp can be", () => {
    assert.deepEqual(parseSizeMm("0"), { ok: false });
    assert.deepEqual(parseSizeMm("0.4"), { ok: false });
    assert.deepEqual(parseSizeMm(String(MIN_SIZE_MM)), { ok: true, mm: MIN_SIZE_MM });
    assert.deepEqual(parseSizeMm(String(MAX_SIZE_MM)), { ok: true, mm: MAX_SIZE_MM });
    assert.deepEqual(parseSizeMm("10000"), { ok: false });
  });
});

describe("formatting", () => {
  it("states a figure without a trailing zero", () => {
    assert.equal(formatSizeMm(21), "21");
    assert.equal(formatSizeMm(21.5), "21.5");
    assert.equal(roundSizeMm(21.449), 21.4);
  });

  it("states a complete size, and says which half a half-stated one is", () => {
    assert.equal(formatStampSize({ widthMm: 21.5, heightMm: 25 }), "21.5 × 25 mm");
    assert.equal(formatStampSize({ widthMm: 21.5, heightMm: null }), "21.5 mm wide");
    assert.equal(formatStampSize({ widthMm: null, heightMm: 25 }), "25 mm high");
    assert.equal(formatStampSize(NO_STAMP_SIZE), null);
    assert.equal(formatStampSize(null), null);
  });

  it("counts half a size as no size", () => {
    assert.deepEqual(statedStampSize({ widthMm: 21.5, heightMm: 25 }), {
      widthMm: 21.5,
      heightMm: 25,
    });
    assert.equal(statedStampSize({ widthMm: 21.5, heightMm: null }), null);
    assert.equal(statedStampSize(NO_STAMP_SIZE), null);
  });
});

describe("sizeFromScanPixels", () => {
  it("converts a crop at a stated scale", () => {
    // 1000 x 1200 px at 1200 dpi is 21.2 x 25.4 mm.
    assert.deepEqual(sizeFromScanPixels({ w: 1000, h: 1200 }, 1200), {
      widthMm: 21.2,
      heightMm: 25.4,
    });
  });

  it("refuses a degenerate box or an impossible scale, rather than reading 0 × 0", () => {
    assert.equal(sizeFromScanPixels({ w: 0, h: 1200 }, 1200), null);
    assert.equal(sizeFromScanPixels({ w: 1000, h: -1 }, 1200), null);
    assert.equal(sizeFromScanPixels({ w: 1000, h: 1200 }, 0), null);
  });

  it("refuses a box that converts to an impossible size", () => {
    assert.equal(sizeFromScanPixels({ w: 2, h: 2 }, 1200), null);
    assert.equal(sizeFromScanPixels({ w: 600000, h: 600000 }, 72), null);
  });
});

describe("resolveStampSize", () => {
  const entry = (stampId: string, widthMm: number | null = null, heightMm = widthMm): StampSizeEntry => ({
    stampId,
    widthMm,
    heightMm,
  });

  it("uses the stamp's own size when it states one", () => {
    const list = [entry("a", 20), entry("b", 30), entry("c")];
    assert.deepEqual(resolveStampSize(list, "b"), {
      widthMm: 30,
      heightMm: 30,
      source: "stated",
      fromStampId: "b",
    });
  });

  it("borrows the nearest stamp of the checklist that states one", () => {
    const list = [entry("a", 20), entry("b"), entry("c"), entry("d", 40)];
    assert.deepEqual(resolveStampSize(list, "b"), {
      widthMm: 20,
      heightMm: 20,
      source: "inherited",
      fromStampId: "a",
    });
    assert.deepEqual(resolveStampSize(list, "c"), {
      widthMm: 40,
      heightMm: 40,
      source: "inherited",
      fromStampId: "d",
    });
  });

  it("gives a tie to the earlier stamp in catalog order", () => {
    const list = [entry("a", 20), entry("b"), entry("c", 40)];
    assert.deepEqual(resolveStampSize(list, "b"), {
      widthMm: 20,
      heightMm: 20,
      source: "inherited",
      fromStampId: "a",
    });
  });

  it("looks past a neighbour that states only half a size", () => {
    const list = [{ stampId: "a", widthMm: 20, heightMm: null }, entry("b"), entry("c", 40)];
    assert.deepEqual(resolveStampSize(list, "b"), {
      widthMm: 40,
      heightMm: 40,
      source: "inherited",
      fromStampId: "c",
    });
  });

  it("resolves a stamp that states half a size through its checklist too", () => {
    const list = [entry("a", 20), { stampId: "b", widthMm: 30, heightMm: null }];
    assert.deepEqual(resolveStampSize(list, "b"), {
      widthMm: 20,
      heightMm: 20,
      source: "inherited",
      fromStampId: "a",
    });
  });

  it("has no answer when nothing on the checklist states a size", () => {
    assert.equal(resolveStampSize([entry("a"), entry("b")], "a"), null);
  });

  it("has no answer for a stamp that is not on the checklist", () => {
    assert.equal(resolveStampSize([entry("a", 20)], "z"), null);
  });

  it("has no answer for an empty checklist", () => {
    assert.equal(resolveStampSize([], "a"), null);
  });
});
