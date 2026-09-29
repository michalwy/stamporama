import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calibrateProfile,
  formatCalibration,
  initialProfileId,
  isPlausibleCalibration,
  MAX_CALIBRATION_DEVIATION,
  MIN_CALIBRATION_MM,
  parseProfileName,
  profileLabel,
  profileScale,
  readCalibrationStretches,
  scaleForTurn,
  typedScale,
  type ScanningProfileView,
} from "../../src/lib/scanning-profile";
import { measureDistance, MM_PER_INCH } from "../../src/lib/scan-measure";
import { sizeFromScanPixels } from "../../src/lib/stamp-size";

function near(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

const EPSON: ScanningProfileView = {
  id: "p-epson",
  name: "Epson V600",
  nominalDpi: 1200,
  calibration: { x: 1195, y: 1198 },
};
const CANON: ScanningProfileView = { id: "p-canon", name: "Canon", nominalDpi: 600, calibration: null };

/** The pixels a scanner at `dpi` spends on `mm` millimetres. */
const px = (mm: number, dpi: number) => (mm / MM_PER_INCH) * dpi;

describe("a profile names itself", () => {
  it("with its nominal resolution and whether it is calibrated", () => {
    assert.equal(profileLabel(EPSON), "Epson V600, 1200 dpi (calibrated)");
    assert.equal(profileLabel(CANON), "Canon, 600 dpi (uncalibrated)");
    assert.equal(typedScale(800).label, "800 dpi (typed)");
  });

  it("states a calibration to the hundredth", () => {
    assert.equal(formatCalibration({ x: 1195.37, y: 1198 }), "1195.37 × 1198 dpi");
  });
});

describe("the scale a profile measures at", () => {
  it("is its calibration per axis, or its nominal dpi on both", () => {
    const calibrated = profileScale(EPSON);
    assert.deepEqual([calibrated.x, calibrated.y, calibrated.calibrated], [1195, 1198, true]);
    const nominal = profileScale(CANON);
    assert.deepEqual([nominal.x, nominal.y, nominal.calibrated], [600, 600, false]);
    assert.equal(nominal.profileId, "p-canon");
    assert.equal(typedScale(800).profileId, null);
  });

  it("swaps its axes for a picture turned sideways, and only then", () => {
    const scale = profileScale(EPSON);
    assert.deepEqual([scaleForTurn(scale, 90).x, scaleForTurn(scale, 90).y], [1198, 1195]);
    assert.deepEqual([scaleForTurn(scale, 270).x, scaleForTurn(scale, 270).y], [1198, 1195]);
    assert.deepEqual([scaleForTurn(scale, 180).x, scaleForTurn(scale, 180).y], [1195, 1198]);
    assert.equal(scaleForTurn(scale, 0), scale);
  });

  it("measures a turned tile's width along the scanner's other axis", () => {
    // A stamp 20 mm across the glass and 30 mm along it, stood up by a quarter turn: on screen it is
    // 30 mm wide, and that width was sampled by the scanner's y axis.
    const box = { w: px(30, 1198), h: px(20, 1195) };
    const size = sizeFromScanPixels(box, scaleForTurn(profileScale(EPSON), 90));
    assert.deepEqual(size, { widthMm: 30, heightMm: 20 });
  });
});

describe("which profile a measurement opens on", () => {
  const setup = { profiles: [CANON, EPSON], defaultProfileId: "p-epson" };

  it("is the scan's own, else the default, else the first", () => {
    assert.equal(initialProfileId(setup, "p-canon"), "p-canon");
    assert.equal(initialProfileId(setup, null), "p-epson");
    // A profile that is not the collection's is not trusted.
    assert.equal(initialProfileId(setup, "p-other"), "p-epson");
    assert.equal(initialProfileId({ profiles: [CANON, EPSON], defaultProfileId: null }, null), "p-canon");
  });

  it("is nothing when the collection has no profile, which the viewer answers with a typed dpi", () => {
    assert.equal(initialProfileId({ profiles: [], defaultProfileId: null }, "p-canon"), null);
  });
});

describe("a profile's name", () => {
  it("is trimmed, collapsed and bounded", () => {
    assert.equal(parseProfileName("  Epson   V600 "), "Epson V600");
    assert.equal(parseProfileName("   "), null);
    assert.equal(parseProfileName("x".repeat(61)), null);
  });
});

describe("calibrating from a ruler (#1443)", () => {
  const X = 1195.37;
  const Y = 1198.02;

  it("recovers each axis's resolution from a stretch across and one along", () => {
    const result = calibrateProfile(
      1200,
      { a: { x: 100, y: 50 }, b: { x: 100 + px(150, X), y: 50 }, mm: 150 },
      { a: { x: 40, y: 80 }, b: { x: 40, y: 80 + px(200, Y) }, mm: 200 }
    );
    assert.ok(result.ok);
    near(result.calibration.x, X, 0.005);
    near(result.calibration.y, Y, 0.005);
  });

  it("is exact for a ruler lying askew on the glass", () => {
    // Both rulers tilted by 4°: each stretch has a component on the other axis, which the solve takes
    // through that axis rather than pretending it is not there.
    const t = (4 * Math.PI) / 180;
    const across = { dx: Math.cos(t) * px(120, X), dy: Math.sin(t) * px(120, Y) };
    const along = { dx: -Math.sin(t) * px(160, X), dy: Math.cos(t) * px(160, Y) };
    const result = calibrateProfile(
      1200,
      { a: { x: 0, y: 0 }, b: { x: across.dx, y: across.dy }, mm: 120 },
      { a: { x: 500, y: 0 }, b: { x: 500 + along.dx, y: along.dy }, mm: 160 }
    );
    assert.ok(result.ok);
    near(result.calibration.x, X, 0.005);
    near(result.calibration.y, Y, 0.005);
  });

  it("then measures the ruler at its true length along both axes", () => {
    const result = calibrateProfile(
      1200,
      { a: { x: 0, y: 0 }, b: { x: px(100, X), y: 0 }, mm: 100 },
      { a: { x: 0, y: 0 }, b: { x: 0, y: px(100, Y) }, mm: 100 }
    );
    assert.ok(result.ok);
    near(measureDistance({ x: 0, y: 0 }, { x: px(25, X), y: 0 }, result.calibration).mm, 25, 0.001);
    near(measureDistance({ x: 0, y: 0 }, { x: 0, y: px(25, Y) }, result.calibration).mm, 25, 0.001);
  });

  it("refuses a stretch shorter than the minimum", () => {
    const result = calibrateProfile(
      1200,
      { a: { x: 0, y: 0 }, b: { x: px(MIN_CALIBRATION_MM - 1, 1200), y: 0 }, mm: MIN_CALIBRATION_MM - 1 },
      { a: { x: 0, y: 0 }, b: { x: 0, y: px(150, 1200) }, mm: 150 }
    );
    assert.equal(result.ok, false);
  });

  it("refuses the two stretches the wrong way round", () => {
    const result = calibrateProfile(
      1200,
      { a: { x: 0, y: 0 }, b: { x: 0, y: px(150, 1200) }, mm: 150 },
      { a: { x: 0, y: 0 }, b: { x: px(150, 1200), y: 0 }, mm: 150 }
    );
    assert.equal(result.ok, false);
  });

  it("refuses a correction beyond a few per cent as a probable mistake", () => {
    // 150 mm typed where the stretch really is 140: the answer would be 7% off nominal.
    const result = calibrateProfile(
      1200,
      { a: { x: 0, y: 0 }, b: { x: px(140, 1200), y: 0 }, mm: 150 },
      { a: { x: 0, y: 0 }, b: { x: 0, y: px(150, 1200) }, mm: 150 }
    );
    assert.equal(result.ok, false);
    assert.ok(!result.ok && /from 1200 dpi/.test(result.reason));
  });

  it("accepts a calibration up to the band and not past it", () => {
    const edge = 1200 * (1 + MAX_CALIBRATION_DEVIATION);
    assert.equal(isPlausibleCalibration(1200, { x: edge, y: 1200 }), true);
    assert.equal(isPlausibleCalibration(1200, { x: edge + 1, y: 1200 }), false);
    assert.equal(isPlausibleCalibration(1200, { x: 1200, y: Number.NaN }), false);
  });
});

describe("calibrating from two ruler scans, one per axis (#1486)", () => {
  const X = 1195.37;
  const Y = 1198.02;

  /** A stretch of `mm` on a ruler turned `degrees` off the axis it lies along, from `at`, in the
   * pixels of a scan taken at the effective X × Y. */
  function ruler(at: { x: number; y: number }, mm: number, degrees: number, along: boolean) {
    const t = (degrees * Math.PI) / 180;
    const [cos, sin] = [Math.cos(t), Math.sin(t)];
    const d = along ? { x: -sin * mm, y: cos * mm } : { x: cos * mm, y: sin * mm };
    return { a: at, b: { x: at.x + px(d.x, X), y: at.y + px(d.y, Y) }, mm };
  }

  it("is exact with each ruler askew on its own scan, by a different amount", () => {
    // The across ruler near the top of a wide scan, 3° one way; the along ruler far down a tall one,
    // 5° the other. Nothing but the components enters the solve, so where each lay does not matter.
    const across = ruler({ x: 2400, y: 310 }, 180, 3, false);
    const along = ruler({ x: 95, y: 6100 }, 220, -5, true);
    const result = calibrateProfile(1200, across, along);
    assert.ok(result.ok);
    near(result.calibration.x, X, 0.005);
    near(result.calibration.y, Y, 0.005);
  });

  it("gives what one scan gives for the same two stretches", () => {
    const across = ruler({ x: 0, y: 0 }, 150, 2, false);
    const along = ruler({ x: 0, y: 0 }, 150, -1.5, true);
    const shifted = (s: typeof across, dx: number, dy: number) => ({
      a: { x: s.a.x + dx, y: s.a.y + dy },
      b: { x: s.b.x + dx, y: s.b.y + dy },
      mm: s.mm,
    });
    const oneScan = calibrateProfile(1200, shifted(across, 300, 200), shifted(along, 900, 400));
    const twoScans = calibrateProfile(1200, shifted(across, 50, 7000), shifted(along, 4000, 20));
    assert.ok(oneScan.ok && twoScans.ok);
    assert.deepEqual(twoScans.calibration, oneScan.calibration);
  });

  it("holds the minimum and the band on each scan alike", () => {
    const short = calibrateProfile(
      1200,
      ruler({ x: 0, y: 0 }, 150, 1, false),
      ruler({ x: 0, y: 0 }, MIN_CALIBRATION_MM - 1, 1, true)
    );
    assert.ok(!short.ok && /along the scan must be at least 100 mm/.test(short.reason));
    // 150 mm typed on the second scan where its stretch is really 140.
    const along = { ...ruler({ x: 0, y: 0 }, 140, 0, true), mm: 150 };
    const far = calibrateProfile(1200, ruler({ x: 0, y: 0 }, 150, 0, false), along);
    assert.ok(!far.ok && /from 1200 dpi/.test(far.reason));
  });
});

describe("the stretches a calibration request carries (#1486)", () => {
  const across = { a: { x: 0, y: 0 }, b: { x: 7000, y: 12 }, mm: 150 };
  const along = { a: { x: 5, y: 3 }, b: { x: 9, y: 7100 }, mm: 150 };

  it("are read when both are there", () => {
    assert.deepEqual(readCalibrationStretches({ across, along }), { across, along });
  });

  it("are refused with one axis missing — a calibration is both or none", () => {
    assert.equal(readCalibrationStretches({ across }), null);
    assert.equal(readCalibrationStretches({ along }), null);
    assert.equal(readCalibrationStretches({ across: null, along }), null);
    assert.equal(readCalibrationStretches(null), null);
  });

  it("are refused when an end or a length is not a number", () => {
    assert.equal(readCalibrationStretches({ across: { ...across, mm: "150" }, along }), null);
    assert.equal(readCalibrationStretches({ across, along: { ...along, b: { x: 9 } } }), null);
    assert.equal(
      readCalibrationStretches({ across, along: { ...along, a: { x: Number.NaN, y: 0 } } }),
      null
    );
  });
});
