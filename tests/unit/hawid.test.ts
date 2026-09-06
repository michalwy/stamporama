import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_STOCK_LENGTH_MM,
  describeHawidBox,
  hawidStripBorderMm,
  hawidStripLabel,
  hawidStripTotalHeightMm,
  isHawidStripMeasured,
  isOversize,
  MAX_STRIP_HEIGHT_MM,
  parseHawidStripInput,
  planHawidBox,
  type HawidMargins,
} from "../../src/lib/hawid";

// The box-size rule (#765, corrected by #793) on plain numbers. Everything here is millimetres: a
// stamp's size, the template's clearances, and a drawer of strips.
//
// The thing to hold on to while reading these: a strip carries **two** heights. The packet number is
// the tallest stamp it takes; the strip itself is that plus its welded border. Selection compares
// against the second and the box is drawn at the second, so a `26 / 30` strip is the one a 26 mm
// stamp with 4 mm of clearance belongs in — and its box is 30 mm tall, not 26.

const strip = (
  heightMm: number,
  totalHeightMm: number,
  label?: string,
  stockLengthMm = DEFAULT_STOCK_LENGTH_MM
) => ({ heightMm, totalHeightMm, stockLengthMm, label: label ?? null });

/** A strip nobody has put a ruler to: the rule reads its packet number as the whole strip. */
const unmeasured = (heightMm: number, label?: string, stockLengthMm = DEFAULT_STOCK_LENGTH_MM) =>
  strip(heightMm, 0, label, stockLengthMm);

/** The collector's own drawer, in his own order: packets of 24, 29 and 41 mm, each with a 4 mm
 *  border, so the strips themselves are 28, 33 and 45 mm tall. */
const STOCK = [
  strip(24, 28, "Hawid 224"),
  strip(29, 33, "Hawid 264"),
  strip(41, 45, "Hawid 341"),
];

/** A plain template: 2 mm of room above and below the stamp, 3 mm of width around it. */
const MARGINS: HawidMargins = { verticalClearanceMm: 2, horizontalMarginMm: 3 };

describe("planHawidBox", () => {
  it("puts a 26 mm stamp in the 26 mm packet, not the 30 mm one", () => {
    // The user's own case, and the defect #793 was filed for. 26 + 4 = 30, and the 26 mm packet is
    // 30 mm of strip — exactly the piece that stamp goes into. Comparing against the packet number
    // instead demanded a *label* of 30 and bought a 34 mm mount for no reason.
    const drawer = [strip(26, 30, "Hawid 264"), strip(30, 34, "Hawid 304")];
    const box = planHawidBox(
      { widthMm: 21, heightMm: 26 },
      { verticalClearanceMm: 4, horizontalMarginMm: 3 },
      drawer
    );
    assert.equal(box.strip?.label, "Hawid 264");
    assert.equal(box.strip?.heightMm, 26);
    // Drawn at the strip, not at the packet: 30 mm of hawid is what ends up on the card.
    assert.equal(box.heightMm, 30);
  });

  it("still reaches for the next packet up when the collector wants a roomier mount", () => {
    // The vertical clearance keeps its own meaning. At 8 mm the same stamp needs 34 mm of strip, so
    // the 26 mm packet (30 mm) is out and the 30 mm one (34 mm) is the shortest that takes it.
    const drawer = [strip(26, 30, "Hawid 264"), strip(30, 34, "Hawid 304")];
    const box = planHawidBox(
      { widthMm: 21, heightMm: 26 },
      { verticalClearanceMm: 8, horizontalMarginMm: 3 },
      drawer
    );
    assert.equal(box.strip?.label, "Hawid 304");
    assert.equal(box.heightMm, 34);
  });

  it("takes its height from the shortest strip the stamp fits into", () => {
    const box = planHawidBox({ widthMm: 21, heightMm: 25 }, MARGINS, STOCK);
    // 25 + 2 = 27, which the 24 mm packet takes: it is 28 mm of strip. The box is drawn at 28.
    assert.equal(box.strip?.label, "Hawid 224");
    assert.equal(box.heightMm, 28);
  });

  it("takes its width from the stamp plus the horizontal margin, not from the strip", () => {
    const box = planHawidBox({ widthMm: 21, heightMm: 25 }, MARGINS, STOCK);
    assert.equal(box.widthMm, 24);
  });

  it("counts the vertical clearance before choosing, not after", () => {
    // 27 mm of strip is the 24 mm packet; with 2 mm more of clearance it is the 29 mm one.
    assert.equal(planHawidBox({ widthMm: 20, heightMm: 27 }, MARGINS, STOCK).heightMm, 33);
    assert.equal(
      planHawidBox(
        { widthMm: 20, heightMm: 27 },
        { verticalClearanceMm: 0, horizontalMarginMm: 3 },
        STOCK
      ).heightMm,
      28
    );
  });

  it("takes a strip whose whole height is exactly what is needed", () => {
    const box = planHawidBox({ widthMm: 20, heightMm: 26 }, MARGINS, [strip(24, 28)]);
    assert.equal(box.heightMm, 28);
    assert.equal(box.strip?.heightMm, 24);
  });

  it("reads an unmeasured strip's packet number as the whole strip", () => {
    // The migration default (#793): nobody can derive the border, so a strip with no outer height
    // plans exactly as it did before — a border too short, and visibly undescribed in Settings.
    const box = planHawidBox({ widthMm: 20, heightMm: 25 }, MARGINS, [unmeasured(29, "unmeasured")]);
    assert.equal(box.strip?.label, "unmeasured");
    assert.equal(box.heightMm, 29);
  });

  it("does not let floating-point noise buy a taller strip", () => {
    // 27.9 + 0.1 is 28.000000000000004 in binary floating point; rounded first, it is 28, and the
    // 24 mm packet is the right one. Unrounded, this test picks the 29 and wastes 5 mm of hawid.
    const box = planHawidBox(
      { widthMm: 20, heightMm: 27.9 },
      { verticalClearanceMm: 0.1, horizontalMarginMm: 3 },
      STOCK
    );
    assert.equal(box.heightMm, 28);
  });

  it("keeps the collector's order when two strips are equally short", () => {
    const first = strip(29, 33, "opened packet");
    const second = strip(29, 33, "sealed packet");
    const box = planHawidBox({ widthMm: 20, heightMm: 30 }, MARGINS, [first, second]);
    assert.equal(box.strip?.label, "opened packet");
  });

  it("breaks a tie on the strip's own height, not on the packet number", () => {
    // Two different packets, both 33 mm of strip: a 29 mm one with a 4 mm border and a 31 mm one
    // with a 2 mm border. Neither is shorter than the other, so the collector's order decides.
    const box = planHawidBox({ widthMm: 20, heightMm: 30 }, MARGINS, [
      strip(31, 33, "thin border"),
      strip(29, 33, "thick border"),
    ]);
    assert.equal(box.strip?.label, "thin border");
    assert.equal(box.heightMm, 33);
  });

  it("reads the stock in its given order rather than sorting it", () => {
    const shuffled = [strip(41, 45), strip(24, 28), strip(29, 33)];
    const box = planHawidBox({ widthMm: 20, heightMm: 30 }, MARGINS, shuffled);
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
    // A wide cover: short enough for the 41 mm packet, wider than the 210 mm it comes in.
    const box = planHawidBox({ widthMm: 230, heightMm: 38 }, MARGINS, STOCK);
    assert.equal(box.strip, null);
    assert.equal(box.widthMm, 233);
    assert.equal(box.heightMm, 40);
  });

  it("takes a longer roll where the collection owns one", () => {
    const box = planHawidBox({ widthMm: 230, heightMm: 38 }, MARGINS, [
      ...STOCK,
      strip(41, 45, "roll", 1000),
    ]);
    assert.equal(box.strip?.label, "roll");
    assert.equal(box.heightMm, 45);
  });
});

describe("hawidStripTotalHeightMm / hawidStripBorderMm / isHawidStripMeasured", () => {
  it("reads the strip's own height and the border it costs", () => {
    assert.equal(hawidStripTotalHeightMm(strip(26, 30)), 30);
    assert.equal(hawidStripBorderMm(strip(26, 30)), 4);
    assert.ok(isHawidStripMeasured(strip(26, 30)));
  });

  it("falls back to the packet number for a strip nobody has measured", () => {
    assert.equal(hawidStripTotalHeightMm(unmeasured(26)), 26);
    assert.equal(hawidStripBorderMm(unmeasured(26)), 0);
    assert.equal(isHawidStripMeasured(unmeasured(26)), false);
  });
});

describe("hawidStripLabel / describeHawidBox", () => {
  it("names a strip by the packet number, with the collector's label when there is one", () => {
    assert.equal(hawidStripLabel(strip(29, 33, "Hawid 264")), "29 mm (Hawid 264)");
    assert.equal(hawidStripLabel(strip(29, 33)), "29 mm");
  });

  it("says where a box is cut from, at the size that is actually cut", () => {
    const cut = planHawidBox({ widthMm: 21, heightMm: 30 }, MARGINS, STOCK);
    assert.equal(describeHawidBox(cut), "24 × 33 mm from the 29 mm (Hawid 264) strip");
    const pocket = planHawidBox({ widthMm: 70, heightMm: 90 }, MARGINS, STOCK);
    assert.equal(describeHawidBox(pocket), "73 × 92 mm — pocket, no strip fits");
  });
});

describe("parseHawidStripInput", () => {
  it("reads a tenth of a millimetre, either decimal separator", () => {
    const parsed = parseHawidStripInput({
      heightMm: "24,5",
      totalHeightMm: "28,5",
      stockLengthMm: "210",
      label: " Hawid 224 ",
    });
    assert.ok(parsed.ok);
    assert.deepEqual(parsed.value, {
      heightMm: 24.5,
      totalHeightMm: 28.5,
      stockLengthMm: 210,
      label: "Hawid 224",
    });
  });

  it("takes a blank outer height as not measured yet", () => {
    const parsed = parseHawidStripInput({
      heightMm: "29",
      totalHeightMm: "  ",
      stockLengthMm: "210",
      label: "",
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.totalHeightMm, 0);
  });

  it("treats a blank label as no label", () => {
    const parsed = parseHawidStripInput({
      heightMm: "29",
      totalHeightMm: "33",
      stockLengthMm: "210",
      label: "   ",
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.label, null);
  });

  it("rejects an outer height shorter than the stamp the packet takes", () => {
    const parsed = parseHawidStripInput({
      heightMm: "29",
      totalHeightMm: "28",
      stockLengthMm: "210",
      label: "",
    });
    assert.equal(parsed.ok, false);
  });

  it("takes an outer height equal to the packet number", () => {
    // A border of nothing is odd but not impossible, and it is not this field's job to argue.
    const parsed = parseHawidStripInput({
      heightMm: "29",
      totalHeightMm: "29",
      stockLengthMm: "210",
      label: "",
    });
    assert.ok(parsed.ok);
    assert.equal(parsed.value.totalHeightMm, 29);
  });

  it("rejects a blank height, a second decimal place and a figure off the scale", () => {
    for (const heightMm of ["", "24.55", "0.5", String(MAX_STRIP_HEIGHT_MM + 1), "29mm"]) {
      const parsed = parseHawidStripInput({
        heightMm,
        totalHeightMm: "",
        stockLengthMm: "210",
        label: "",
      });
      assert.equal(parsed.ok, false, `expected ${JSON.stringify(heightMm)} to be rejected`);
    }
  });

  it("holds the outer height to the same scale", () => {
    for (const totalHeightMm of ["28.55", String(MAX_STRIP_HEIGHT_MM + 1), "33mm"]) {
      const parsed = parseHawidStripInput({
        heightMm: "29",
        totalHeightMm,
        stockLengthMm: "210",
        label: "",
      });
      assert.equal(parsed.ok, false, `expected ${JSON.stringify(totalHeightMm)} to be rejected`);
    }
  });

  it("rejects a stock length the strip could not be sold at", () => {
    const parsed = parseHawidStripInput({
      heightMm: "29",
      totalHeightMm: "33",
      stockLengthMm: "0",
      label: "",
    });
    assert.equal(parsed.ok, false);
  });
});
