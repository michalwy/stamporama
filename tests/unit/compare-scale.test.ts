import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  atSameScale,
  carryView,
  fitAt,
  pairedFitScales,
  pictureDpi,
  type PairedLayout,
} from "../../src/lib/compare-scale";
import { fitScale, toSheetPoint } from "../../src/lib/scan-viewport";
import type { ScanningSetup } from "../../src/lib/scanning-profile";
import { tracePhotoScan, type ConsumedTileSide } from "../../src/lib/held-copies";

// *Compare with the copies you hold* (#1641): two pictures at one scale where both resolutions are
// known, and one viewer's zoom and pan carried to the other.

const VIEWPORT = { width: 800, height: 600 };

/** A stamp 25 × 30 mm cut tight, scanned at `dpi`, plus `margin` mm of card on every side. */
function layout(dpi: number | null, margin = 0, at = dpi ?? 600): PairedLayout {
  const px = (mm: number) => Math.round(((mm + 2 * margin) / 25.4) * at);
  return { picture: { width: px(25), height: px(30) }, viewport: VIEWPORT, dpi };
}

const SETUP: ScanningSetup = {
  profiles: [
    { id: "v600", name: "V600", nominalDpi: 1200, calibration: { x: 1196, y: 1200 } },
    { id: "flat", name: "Flatbed", nominalDpi: 600, calibration: null },
  ],
  defaultProfileId: "flat",
};

describe("pictureDpi", () => {
  it("is the profile's resolution, the mean of a calibration's two axes", () => {
    assert.equal(pictureDpi(SETUP, { scanningProfileId: "v600" }), 1198);
    assert.equal(pictureDpi(SETUP, { scanningProfileId: "flat" }), 600);
  });

  it("is the collection's default for a card that does not say", () => {
    assert.equal(pictureDpi(SETUP, { scanningProfileId: null }), 600);
  });

  it("is not known for a picture with no scan behind it, or with no profile to read", () => {
    assert.equal(pictureDpi(SETUP, null), null);
    assert.equal(
      pictureDpi({ profiles: [], defaultProfileId: null }, { scanningProfileId: null }),
      null
    );
  });
});

describe("pairedFitScales", () => {
  it("draws both at one size on paper, the larger fitting its viewer", () => {
    const piece = layout(1200);
    const held = layout(600, 3);
    const fits = pairedFitScales(piece, held)!;
    // Display pixels per inch, the same in both.
    assert.ok(Math.abs(fits.a * 1200 - fits.b * 600) < 1e-9);
    // The held copy carries 3 mm of card around it, so it is the larger and fits exactly.
    assert.ok(Math.abs(fits.b - fitScale(held.picture, held.viewport)) < 1e-9);
    assert.ok(fits.a < fitScale(piece.picture, piece.viewport));
  });

  it("says nothing where either resolution is not known — each then fits its own viewer", () => {
    assert.equal(pairedFitScales(layout(1200), layout(null)), null);
    assert.equal(pairedFitScales(layout(null), layout(600)), null);
    assert.equal(atSameScale(layout(1200), layout(null)), false);
    assert.equal(atSameScale(layout(1200), layout(600)), true);
  });
});

describe("carryView", () => {
  it("at one scale, lands on the same place of the stamp at the same size on paper", () => {
    const piece = layout(1200);
    const held = layout(600, 3);
    const fits = pairedFitScales(piece, held)!;
    // The piece zoomed onto a point 5 mm right and 4 mm down from its picture's centre.
    const scale = 1;
    const target = {
      x: piece.picture.width / 2 + (5 / 25.4) * 1200,
      y: piece.picture.height / 2 + (4 / 25.4) * 1200,
    };
    const view = {
      scale,
      offsetX: VIEWPORT.width / 2 - target.x * scale,
      offsetY: VIEWPORT.height / 2 - target.y * scale,
    };
    const carried = carryView(view, { ...piece, fit: fits.a }, { ...held, fit: fits.b });
    // The same display pixels per inch…
    assert.ok(Math.abs(carried.scale * 600 - scale * 1200) < 1e-9);
    // …centred on the point 5 mm right and 4 mm down from the held picture's centre.
    const centre = toSheetPoint(carried, VIEWPORT.width / 2, VIEWPORT.height / 2);
    assert.ok(Math.abs(centre.x - (held.picture.width / 2 + (5 / 25.4) * 600)) < 1e-6);
    assert.ok(Math.abs(centre.y - (held.picture.height / 2 + (4 / 25.4) * 600)) < 1e-6);
  });

  it("without one scale, carries the zoom as a multiple of fit and the point as a fraction", () => {
    const piece = layout(1200);
    const held = layout(null, 0, 300);
    const pieceFit = fitScale(piece.picture, piece.viewport);
    const heldFit = fitScale(held.picture, held.viewport);
    const scale = pieceFit * 3;
    const target = { x: piece.picture.width * 0.4, y: piece.picture.height * 0.6 };
    const view = {
      scale,
      offsetX: VIEWPORT.width / 2 - target.x * scale,
      offsetY: VIEWPORT.height / 2 - target.y * scale,
    };
    const carried = carryView(view, { ...piece, fit: pieceFit }, { ...held, fit: heldFit });
    assert.ok(Math.abs(carried.scale - heldFit * 3) < 1e-9);
    const centre = toSheetPoint(carried, VIEWPORT.width / 2, VIEWPORT.height / 2);
    assert.ok(Math.abs(centre.x / held.picture.width - 0.4) < 1e-6);
    assert.ok(Math.abs(centre.y / held.picture.height - 0.6) < 1e-6);
  });

  it("keeps a picture drawn far below its own fit to match the other reachable", () => {
    const piece = layout(1200);
    // 20 mm of card all round: the piece is drawn at under half its own fit to match it, which a
    // viewer's own floor would not allow.
    const held = layout(600, 20);
    const fits = pairedFitScales(piece, held)!;
    assert.ok(fits.a < fitScale(piece.picture, piece.viewport) / 2);
    const fitted = fitAt(piece.picture, piece.viewport, fits.a);
    const back = carryView(
      fitAt(held.picture, held.viewport, fits.b),
      { ...held, fit: fits.b },
      { ...piece, fit: fits.a }
    );
    assert.ok(Math.abs(back.scale - fitted.scale) < 1e-9);
  });
});

describe("tracePhotoScan", () => {
  const sides: ConsumedTileSide[] = [
    { role: "front", width: 1180, height: 1420, scanningProfileId: "v600" },
    { role: "back", width: 1190, height: 1430, scanningProfileId: null },
  ];

  it("finds the card a photo was cut from by its role and its upload size", () => {
    assert.deepEqual(
      tracePhotoScan({ role: "front", frame: { width: 1180, height: 1420 } }, sides),
      { scanningProfileId: "v600" }
    );
    assert.deepEqual(
      tracePhotoScan({ role: "back", frame: { width: 1190, height: 1430 } }, sides),
      { scanningProfileId: null }
    );
  });

  it("still finds it after the photo was turned by a quarter", () => {
    assert.deepEqual(
      tracePhotoScan({ role: "front", frame: { width: 1420, height: 1180 } }, sides),
      { scanningProfileId: "v600" }
    );
  });

  it("does not trace a photo replaced since, one in the other slot, or one with no frame", () => {
    assert.equal(tracePhotoScan({ role: "front", frame: { width: 3000, height: 4000 } }, sides), null);
    assert.equal(tracePhotoScan({ role: "back", frame: { width: 1180, height: 1420 } }, sides), null);
    assert.equal(tracePhotoScan({ role: null, frame: { width: 1180, height: 1420 } }, sides), null);
    assert.equal(tracePhotoScan({ role: "front", frame: null }, sides), null);
  });
});
