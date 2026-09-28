import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SCAN_DPI,
  MAX_SCAN_DPI,
  MIN_SCAN_DPI,
  distanceInScanPixels,
  formatGaugeAt,
  formatGaugeStep,
  formatMeasuredGauge,
  formatMillimetres,
  formatMillimetresAt,
  isPlausibleGauge,
  meanPixelsPerMm,
  measureDistance,
  nearestCatalogueGauge,
  parseScanDpi,
  parseToothCount,
  perforationGauge,
  scanPixelsToMm,
  scanVectorToMm,
  uniformScale,
} from "../../src/lib/scan-measure";

/** Two figures equal to within a tolerance the scan itself could not tell apart. */
function near(actual: number, expected: number, tolerance = 1e-9): void {
  assert.ok(
    Math.abs(actual - expected) <= tolerance,
    `expected ${actual} to be within ${tolerance} of ${expected}`
  );
}

describe("parseScanDpi", () => {
  it("takes a whole number in range", () => {
    assert.equal(parseScanDpi("1200"), 1200);
    assert.equal(parseScanDpi("  600 "), 600);
    assert.equal(parseScanDpi(String(MIN_SCAN_DPI)), MIN_SCAN_DPI);
    assert.equal(parseScanDpi(String(MAX_SCAN_DPI)), MAX_SCAN_DPI);
  });

  it("refuses anything that is not one", () => {
    assert.equal(parseScanDpi(""), null);
    assert.equal(parseScanDpi("1200.5"), null);
    assert.equal(parseScanDpi("-600"), null);
    assert.equal(parseScanDpi("1200 dpi"), null);
    assert.equal(parseScanDpi(String(MIN_SCAN_DPI - 1)), null);
    assert.equal(parseScanDpi(String(MAX_SCAN_DPI + 1)), null);
  });
});

describe("parseToothCount", () => {
  it("takes a whole count of one or more", () => {
    assert.equal(parseToothCount("1"), 1);
    assert.equal(parseToothCount(" 14 "), 14);
  });

  it("refuses zero, fractions and text — none of which is a run of teeth", () => {
    assert.equal(parseToothCount("0"), null);
    assert.equal(parseToothCount("10.5"), null);
    assert.equal(parseToothCount(""), null);
    assert.equal(parseToothCount("ten"), null);
  });
});

describe("scanPixelsToMm", () => {
  it("converts against the stated scale and nothing else", () => {
    // One inch at 1200 dpi is 1200 px and 25.4 mm, whatever any file claims about itself.
    near(scanPixelsToMm(1200, 1200), 25.4);
    near(scanPixelsToMm(600, 1200), 12.7);
    // The same pixel count at half the resolution is twice the stamp — which is the whole reason
    // the scale has to be stated rather than guessed.
    near(scanPixelsToMm(1200, 600), 50.8);
  });

  it("is zero rather than infinite at a nonsense scale", () => {
    assert.equal(scanPixelsToMm(1200, 0), 0);
    assert.equal(scanPixelsToMm(1200, -1), 0);
  });
});

describe("distanceInScanPixels / measureDistance", () => {
  it("measures the straight line, not the axis-aligned box", () => {
    assert.equal(distanceInScanPixels({ x: 0, y: 0 }, { x: 3, y: 4 }), 5);
  });

  it("keeps the pixel count beside the millimetres", () => {
    const { px, mm } = measureDistance({ x: 100, y: 100 }, { x: 1300, y: 100 }, uniformScale(1200));
    assert.equal(px, 1200);
    near(mm, 25.4);
  });
});

describe("two axes (#1443)", () => {
  const scale = { x: 1195, y: 1198 };

  it("converts a line along each axis through that axis's own resolution", () => {
    near(measureDistance({ x: 0, y: 0 }, { x: 1195, y: 0 }, scale).mm, 25.4);
    near(measureDistance({ x: 0, y: 0 }, { x: 0, y: 1198 }, scale).mm, 25.4);
    // The same 1195 px down the picture is a shorter distance, because that axis is denser.
    near(measureDistance({ x: 0, y: 0 }, { x: 0, y: 1195 }, scale).mm, (1195 / 1198) * 25.4);
  });

  it("converts each component before taking a diagonal's length", () => {
    const mm = scanVectorToMm({ x: 0, y: 0 }, { x: 1195, y: 1198 }, scale);
    near(mm, Math.hypot(25.4, 25.4));
  });

  it("is #598's single dpi when both axes agree", () => {
    const a = { x: 10, y: 20 };
    const b = { x: 610, y: 820 };
    near(scanVectorToMm(a, b, uniformScale(1200)), scanPixelsToMm(1000, 1200));
  });

  it("gauges a perforation along the axis the teeth run", () => {
    // Twelve teeth over 1000 px down a vertical edge: the vertical resolution decides the gauge.
    const down = perforationGauge(measureDistance({ x: 0, y: 0 }, { x: 0, y: 1000 }, { x: 1150, y: 1200 }).mm, 12);
    const across = perforationGauge(measureDistance({ x: 0, y: 0 }, { x: 1000, y: 0 }, { x: 1150, y: 1200 }).mm, 12);
    near(down as number, 11.34, 0.005);
    assert.ok((across as number) < 11);
  });

  it("gives the watermark filter the paper's scale taken from both axes", () => {
    near(meanPixelsPerMm({ x: 1190, y: 1210 }), 1200 / 25.4);
  });
});

describe("perforationGauge", () => {
  it("is teeth per 2 cm", () => {
    // Fourteen teeth over 20 mm is, by definition, perf 14.
    near(perforationGauge(20, 14) as number, 14);
    // Ten teeth over 20 mm is perf 10; the same ten over 10 mm is perf 20.
    near(perforationGauge(20, 10) as number, 10);
    near(perforationGauge(10, 10) as number, 20);
  });

  it("reads a real run measured at 1200 dpi", () => {
    // Twelve teeth spanning 1000 scan pixels at 1200 dpi: 21.17 mm, so 11.34 — a piece sitting
    // between 11¼ and 11½, which is exactly the case the raw figure exists to report.
    const { mm } = measureDistance({ x: 0, y: 0 }, { x: 1000, y: 0 }, uniformScale(1200));
    const gauge = perforationGauge(mm, 12) as number;
    near(gauge, 11.34, 0.005);
    near(nearestCatalogueGauge(gauge), 11.25);
  });

  it("separates one catalogue step from the next, which is what the stated scale is for", () => {
    // The same physical run read at the wrong scale is a different catalogue answer.
    const pxRun = 926; // 12 teeth
    const right = perforationGauge(scanPixelsToMm(pxRun, 1200), 12) as number;
    const wrong = perforationGauge(scanPixelsToMm(pxRun, 1250), 12) as number;
    assert.equal(formatGaugeStep(nearestCatalogueGauge(right)), "12¼");
    assert.equal(formatGaugeStep(nearestCatalogueGauge(wrong)), "12¾");
  });

  it("is null rather than a plausible-looking number on impossible input", () => {
    assert.equal(perforationGauge(0, 12), null);
    assert.equal(perforationGauge(-5, 12), null);
    assert.equal(perforationGauge(20, 0), null);
  });
});

describe("isPlausibleGauge", () => {
  it("accepts what philately actually uses and rejects an obvious slip", () => {
    assert.equal(isPlausibleGauge(11.5), true);
    assert.equal(isPlausibleGauge(7), true);
    assert.equal(isPlausibleGauge(16), true);
    assert.equal(isPlausibleGauge(0.4), false);
    assert.equal(isPlausibleGauge(240), false);
  });
});

describe("nearestCatalogueGauge", () => {
  it("snaps to quarter steps", () => {
    near(nearestCatalogueGauge(11.63), 11.75);
    near(nearestCatalogueGauge(11.51), 11.5);
    near(nearestCatalogueGauge(12.02), 12);
  });
});

describe("formatGaugeStep", () => {
  it("writes a quarter gauge the way a catalogue does", () => {
    assert.equal(formatGaugeStep(11), "11");
    assert.equal(formatGaugeStep(11.25), "11¼");
    assert.equal(formatGaugeStep(11.5), "11½");
    assert.equal(formatGaugeStep(11.75), "11¾");
    assert.equal(formatGaugeStep(14), "14");
  });
});

describe("stating the scale with the figure", () => {
  it("never renders a measurement without what it was taken with", () => {
    const taken = "Epson V600, 1200 dpi (calibrated)";
    assert.equal(formatMillimetresAt(25.4, taken), "25.40 mm — Epson V600, 1200 dpi (calibrated)");
    // The step first, because that is what a catalogue says; the measured figure beside it,
    // because that is what says how comfortably the piece sits on the step.
    assert.equal(formatGaugeAt(11.63, taken), "11¾ (11.63) — Epson V600, 1200 dpi (calibrated)");
    assert.equal(formatGaugeAt(11.63, "600 dpi (typed)"), "11¾ (11.63) — 600 dpi (typed)");
  });

  it("states figures at the precision the scan supports and no more", () => {
    assert.equal(formatMillimetres(25.4), "25.40");
    assert.equal(formatMeasuredGauge(11.6349), "11.63");
  });
});

describe("the default scale", () => {
  it("is the resolution this app's own reference scans were made at", () => {
    assert.equal(DEFAULT_SCAN_DPI, 1200);
    assert.equal(parseScanDpi(String(DEFAULT_SCAN_DPI)), DEFAULT_SCAN_DPI);
  });
});
