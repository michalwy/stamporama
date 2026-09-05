import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STOCK_LENGTH_MM,
  describeHawidBox,
  hawidStripLabel,
  isOversize,
  MAX_STRIP_HEIGHT_MM,
  parseHawidStripInput,
  planHawidBox,
  type HawidMargins,
} from "../../src/lib/hawid";

// The box-size rule (#765) on plain numbers. Everything here is millimetres: a stamp's size, the
// template's clearances, and a drawer of strips.

const strip = (heightMm: number, label?: string, stockLengthMm = DEFAULT_STOCK_LENGTH_MM) => ({
  heightMm,
  stockLengthMm,
  label: label ?? null,
});

/** The heights this collection is imagined to own, in the collector's own order. */
const STOCK = [strip(24, "Hawid 224"), strip(29, "Hawid 264"), strip(41, "Hawid 341")];

/** A plain template: 2 mm of strip above and below the stamp, 3 mm of width around it. */
const MARGINS: HawidMargins = { verticalClearanceMm: 2, horizontalMarginMm: 3 };

describe("planHawidBox", () => {
  it("takes its height from the shortest strip the stamp fits into", () => {
    const box = planHawidBox({ widthMm: 21, heightMm: 25 }, MARGINS, STOCK);
    // 25 + 2 = 27, so the 24 mm strip is out and the 29 mm one is the shortest that takes it.
    assert.equal(box.heightMm, 29);
    assert.equal(box.strip?.label, "Hawid 264");
  });

  it("takes its width from the stamp plus the horizontal margin, not from the strip", () => {
    const box = planHawidBox({ widthMm: 21, heightMm: 25 }, MARGINS, STOCK);
    assert.equal(box.widthMm, 24);
  });

  it("counts the vertical clearance before choosing, not after", () => {
    // 23 mm alone fits the 24 mm strip; with 2 mm of clearance it does not.
    assert.equal(planHawidBox({ widthMm: 20, heightMm: 23 }, MARGINS, STOCK).heightMm, 29);
    assert.equal(
      planHawidBox(
        { widthMm: 20, heightMm: 23 },
        { verticalClearanceMm: 0, horizontalMarginMm: 3 },
        STOCK
      ).heightMm,
      24
    );
  });

  it("takes a strip whose height is exactly what is needed", () => {
    const box = planHawidBox({ widthMm: 20, heightMm: 22 }, { ...MARGINS, verticalClearanceMm: 2 }, [
      strip(24),
    ]);
    assert.equal(box.heightMm, 24);
    assert.equal(box.strip?.heightMm, 24);
  });

  it("does not let floating-point noise buy a taller strip", () => {
    // 23.9 + 0.1 is 24.000000000000004 in binary floating point; rounded first, it is 24, and the
    // 24 mm strip is the right one. Unrounded, this test picks the 29 and wastes 5 mm of hawid.
    const box = planHawidBox(
      { widthMm: 20, heightMm: 23.9 },
      { verticalClearanceMm: 0.1, horizontalMarginMm: 3 },
      STOCK
    );
    assert.equal(box.heightMm, 24);
  });

  it("keeps the collector's order when two strips are equally short", () => {
    const first = strip(29, "opened packet");
    const second = { ...strip(29, "sealed packet"), heightMm: 29 };
    const box = planHawidBox({ widthMm: 20, heightMm: 25 }, MARGINS, [first, second]);
    assert.equal(box.strip?.label, "opened packet");
  });

  it("reads the stock in its given order rather than sorting it", () => {
    const shuffled = [strip(41), strip(24), strip(29)];
    const box = planHawidBox({ widthMm: 20, heightMm: 25 }, MARGINS, shuffled);
    assert.equal(box.strip?.heightMm, 29);
    assert.deepEqual(
      shuffled.map((s) => s.heightMm),
      [41, 24, 29]
    );
  });

  it("calls a stamp taller than every strip oversize, with no strip and its own height", () => {
    const box = planHawidBox({ widthMm: 70, heightMm: 90 }, MARGINS, STOCK);
    assert.equal(box.strip, null);
    assert.ok(isOversize(box));
    assert.equal(box.heightMm, 92);
    assert.equal(box.widthMm, 73);
  });

  it("makes every box oversize when the stock is empty", () => {
    const box = planHawidBox({ widthMm: 21, heightMm: 25 }, MARGINS, []);
    assert.equal(box.strip, null);
    assert.equal(box.heightMm, 27);
    assert.equal(box.widthMm, 24);
  });

  it("will not cut a piece longer than the strip is sold", () => {
    // A wide cover: short enough for the 41 mm strip, wider than the 210 mm it comes in.
    const box = planHawidBox({ widthMm: 230, heightMm: 38 }, MARGINS, STOCK);
    assert.equal(box.strip, null);
    assert.equal(box.widthMm, 233);
  });

  it("takes a longer roll where the collection owns one", () => {
    const box = planHawidBox({ widthMm: 230, heightMm: 38 }, MARGINS, [
      ...STOCK,
      strip(41, "roll", 1000),
    ]);
    assert.equal(box.strip?.label, "roll");
    assert.equal(box.heightMm, 41);
  });
});

describe("hawidStripLabel / describeHawidBox", () => {
  it("names a strip by its height, with the collector's label when there is one", () => {
    assert.equal(hawidStripLabel(strip(29, "Hawid 264")), "29 mm (Hawid 264)");
    assert.equal(hawidStripLabel(strip(29)), "29 mm");
  });

  it("says where a box is cut from, or that it is a pocket", () => {
    const cut = planHawidBox({ widthMm: 21, heightMm: 25 }, MARGINS, STOCK);
    assert.equal(describeHawidBox(cut), "24 × 29 mm from the 29 mm (Hawid 264) strip");
    const pocket = planHawidBox({ widthMm: 70, heightMm: 90 }, MARGINS, STOCK);
    assert.equal(describeHawidBox(pocket), "73 × 92 mm — pocket, no strip fits");
  });
});

describe("parseHawidStripInput", () => {
  it("reads a tenth of a millimetre, either decimal separator", () => {
    const parsed = parseHawidStripInput({
      heightMm: "24,5",
      stockLengthMm: "210",
      label: " Hawid 224 ",
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, { heightMm: 24.5, stockLengthMm: 210, label: "Hawid 224" });
  });

  it("treats a blank label as no label", () => {
    const parsed = parseHawidStripInput({ heightMm: "29", stockLengthMm: "210", label: "   " });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.label, null);
  });

  it("rejects a blank height, a second decimal place and a figure off the scale", () => {
    for (const heightMm of ["", "24.55", "0.5", String(MAX_STRIP_HEIGHT_MM + 1), "29mm"]) {
      const parsed = parseHawidStripInput({ heightMm, stockLengthMm: "210", label: "" });
      assert.equal(parsed.ok, false, `expected ${JSON.stringify(heightMm)} to be rejected`);
    }
  });

  it("rejects a stock length the strip could not be sold at", () => {
    const parsed = parseHawidStripInput({ heightMm: "29", stockLengthMm: "0", label: "" });
    assert.equal(parsed.ok, false);
  });
});
