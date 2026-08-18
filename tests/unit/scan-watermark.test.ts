import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_WATERMARK_STRENGTH,
  MAX_WATERMARK_STRENGTH,
  MIN_WATERMARK_STRENGTH,
  bandPass,
  blurPlane,
  clampStrength,
  enhanceWatermark,
  extractChannel,
  localContrastStretch,
  medianFilter,
  removePlane,
  type Pixels,
  type WatermarkChannel,
} from "../../src/lib/scan-watermark";

/** Pixels per millimetre used throughout: a 240 px buffer is then 24 mm of paper — one stamp — and
 * the chain's radii land where they would on a real crop. */
const PX_PER_MM = 10;

/**
 * A synthetic scan of the back of a stamp: paper, a lamp that falls off across the platen, grain,
 * and a watermark buried under all three.
 *
 * The watermark is a **bar**, only `mark` levels deep, in one channel — deliberately weaker than
 * the grain around it, because a mark that stands out of the input is not the case this tool exists
 * for. Everything is deterministic: `Math.random()` would make a failure impossible to reproduce,
 * which for a detector is the wrong kind of test.
 */
function scannedBack(opts: {
  width?: number;
  height?: number;
  /** Depth of the watermark, in channel levels. */
  mark: number;
  /** Which channel carries it. */
  markChannel?: "r" | "g" | "b";
  /** Peak-to-peak paper grain, in levels. */
  grain?: number;
  /** How much the lamp falls off across the width, in levels. */
  gradient?: number;
}): Pixels {
  const {
    width = 240,
    height = 180,
    mark,
    markChannel = "b",
    grain = 8,
    gradient = 40,
  } = opts;
  const data = new Uint8ClampedArray(width * height * 4);

  let seed = 987654321;
  const jitter = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed / 0x7fffffff) * 2 - 1) * (grain / 2);
  };

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const base = 170 + (x / width) * gradient + jitter();
      const inMark = markInside(x, y, width, height);
      const p = (y * width + x) * 4;
      data[p] = base + (markChannel === "r" && inMark ? -mark : 0);
      data[p + 1] = base + (markChannel === "g" && inMark ? -mark : 0);
      data[p + 2] = base + (markChannel === "b" && inMark ? -mark : 0);
      data[p + 3] = 255;
    }
  }
  return { data, width, height };
}

/** Where the bar sits: a vertical stroke about 2 mm wide down the middle third of the picture —
 * the scale a watermark's strokes actually occupy. */
function markInside(x: number, y: number, width: number, height: number): boolean {
  const cx = width / 2;
  return Math.abs(x - cx) <= PX_PER_MM && y > height * 0.2 && y < height * 0.8;
}

/** The mean output level inside the bar and well away from it, in 0…255. The gap between the two is
 * what "readable" means here. */
function markSeparation(out: { data: Uint8ClampedArray; width: number; height: number }): number {
  let inside = 0;
  let insideN = 0;
  let outside = 0;
  let outsideN = 0;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const v = out.data[(y * out.width + x) * 4];
      if (markInside(x, y, out.width, out.height)) {
        inside += v;
        insideN++;
      } else if (Math.abs(x - out.width / 2) > 4 * PX_PER_MM) {
        outside += v;
        outsideN++;
      }
    }
  }
  return Math.abs(inside / insideN - outside / outsideN);
}

function meanOfColumns(
  out: { data: Uint8ClampedArray; width: number; height: number },
  from: number,
  to: number
): number {
  let sum = 0;
  let n = 0;
  for (let y = 0; y < out.height; y++) {
    for (let x = from; x < to; x++) {
      sum += out.data[(y * out.width + x) * 4];
      n++;
    }
  }
  return sum / n;
}

function standardDeviation(out: { data: Uint8ClampedArray; width: number; height: number }): number {
  let sum = 0;
  let sumSq = 0;
  const n = out.width * out.height;
  for (let i = 0; i < n; i++) {
    const v = out.data[i * 4];
    sum += v;
    sumSq += v * v;
  }
  const mean = sum / n;
  return Math.sqrt(Math.max(0, sumSq / n - mean * mean));
}

const options = (over: Partial<Parameters<typeof enhanceWatermark>[1]> = {}) => ({
  channel: "blue" as WatermarkChannel,
  strength: DEFAULT_WATERMARK_STRENGTH,
  pixelsPerMm: PX_PER_MM,
  ...over,
});

describe("extractChannel", () => {
  it("selects rather than relabels", () => {
    const image: Pixels = { data: [10, 20, 30, 255], width: 1, height: 1 };
    assert.equal(extractChannel(image, "red")[0], 10);
    assert.equal(extractChannel(image, "green")[0], 20);
    assert.equal(extractChannel(image, "blue")[0], 30);
    assert.ok(Math.abs(extractChannel(image, "grey")[0] - 18.15) < 0.05);
  });
});

describe("blurPlane", () => {
  it("leaves a flat plane flat", () => {
    const plane = new Float32Array(20 * 20).fill(42);
    const out = blurPlane(plane, 20, 20, 3);
    for (const v of out) assert.ok(Math.abs(v - 42) < 1e-3);
  });

  it("is the identity below a radius of one pixel", () => {
    const plane = Float32Array.from({ length: 16 }, (_, i) => i);
    const out = blurPlane(plane, 4, 4, 0.4);
    assert.deepEqual(Array.from(out), Array.from(plane));
  });

  it("spreads a spike over its radius without changing the total", () => {
    const plane = new Float32Array(41 * 41);
    plane[20 * 41 + 20] = 1000;
    const out = blurPlane(plane, 41, 41, 4);
    assert.ok(out[20 * 41 + 20] < 1000, "the spike is flattened");
    assert.ok(out[20 * 41 + 22] > 0, "and its neighbours pick it up");
    const total = out.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 1000) < 1, `total ${total} is preserved`);
  });
});

describe("removePlane", () => {
  it("takes a tilted lamp off and leaves what was riding on it", () => {
    const w = 40;
    const h = 30;
    const plane = new Float32Array(w * h);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) plane[y * w + x] = 100 + 2 * x + 0.5 * y + (x === 20 ? 7 : 0);
    }
    const out = removePlane(plane, w, h);
    // The ramp is gone everywhere except where the bump was, which is left standing.
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        if (x === 20) continue;
        assert.ok(Math.abs(out[y * w + x]) < 0.5, `(${x},${y}) flattened`);
      }
    }
    assert.ok(out[5 * w + 20] > 5, "the bump survives the fit");
  });

  it("leaves a picture with no gradient alone but for its own mean", () => {
    const plane = new Float32Array(16 * 16).fill(7);
    for (const v of removePlane(plane, 16, 16)) assert.ok(Math.abs(v) < 1e-3);
  });
});

describe("bandPass", () => {
  it("removes an illumination gradient and keeps the band the watermark lives in", () => {
    const image = scannedBack({ mark: 3 });
    const plane = extractChannel(image, "blue");
    const banded = bandPass(plane, image.width, image.height, 1, 25);

    // The gradient is 40 levels across the picture in the input…
    const left = plane.slice(0, 10).reduce((a, b) => a + b, 0) / 10;
    const right = plane.slice(plane.length - 10).reduce((a, b) => a + b, 0) / 10;
    assert.ok(right - left > 20, `input carries the gradient (${(right - left).toFixed(1)})`);

    // …and gone from the band-passed plane, which is centred on zero.
    let sum = 0;
    for (const v of banded) sum += v;
    assert.ok(Math.abs(sum / banded.length) < 0.5, "band-passed plane is centred on zero");
  });
});

describe("medianFilter", () => {
  it("drops a speckle its neighbours do not share", () => {
    const plane = new Float32Array(9 * 9).fill(5);
    plane[4 * 9 + 4] = 500;
    const out = medianFilter(plane, 9, 9, 1);
    assert.equal(out[4 * 9 + 4], 5);
  });

  it("keeps an edge a blur would soften", () => {
    const w = 9;
    const plane = new Float32Array(w * w);
    for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) plane[y * w + x] = x < 4 ? 0 : 100;
    const out = medianFilter(plane, w, w, 1);
    assert.equal(out[4 * w + 3], 0);
    assert.equal(out[4 * w + 4], 100);
  });

  it("is the identity below a radius of one pixel", () => {
    const plane = Float32Array.from({ length: 25 }, (_, i) => i);
    assert.deepEqual(Array.from(medianFilter(plane, 5, 5, 0)), Array.from(plane));
  });
});

describe("localContrastStretch", () => {
  it("centres on mid-grey and stays inside the range", () => {
    const plane = Float32Array.from({ length: 64 * 64 }, (_, i) => Math.sin(i / 7) * 3);
    const out = localContrastStretch(plane, 64, 64, { tilePx: 16, strength: 1 });
    for (const v of out) assert.ok(v >= 0 && v <= 1);
    const mean = out.reduce((a, b) => a + b, 0) / out.length;
    assert.ok(Math.abs(mean - 0.5) < 0.1, `mean ${mean.toFixed(3)} sits at mid-grey`);
  });

  it("does not stretch a flat tile by an unbounded gain", () => {
    // Half the picture carries a signal, half is dead flat. Without the clip floor the flat half
    // comes back as full-range noise — a field of watermarks that are not there.
    const w = 64;
    const plane = new Float32Array(w * w);
    for (let y = 0; y < w; y++) {
      for (let x = 0; x < w; x++) plane[y * w + x] = x < w / 2 ? Math.sin(x / 3) * 10 : 0;
    }
    const out = localContrastStretch(plane, w, w, { tilePx: 16, strength: 1 });
    for (let y = 0; y < w; y++) {
      for (let x = w / 2 + 8; x < w; x++) {
        assert.ok(Math.abs(out[y * w + x] - 0.5) < 0.05, "the flat half stays flat");
      }
    }
  });
});

describe("enhanceWatermark", () => {
  it("lifts a watermark that is invisible in the scan", () => {
    // Three levels deep, under eight levels of grain and a forty-level gradient: not something an
    // eye picks out of the paper, which is the whole case for the tool.
    const image = scannedBack({ mark: 3 });
    const out = enhanceWatermark(image, options());
    const separation = markSeparation(out);
    assert.ok(
      separation > 40,
      `the bar reads at ${separation.toFixed(1)} levels out of 255, from 3 in the scan`
    );
  });

  it("still finds it when the lamp falls off twice as hard", () => {
    const image = scannedBack({ mark: 3, gradient: 90 });
    const separation = markSeparation(enhanceWatermark(image, options()));
    assert.ok(separation > 40, `separation ${separation.toFixed(1)} survives the gradient`);
  });

  it("throws the illumination gradient away rather than stretching it", () => {
    const image = scannedBack({ mark: 0, gradient: 60 });
    const out = enhanceWatermark(image, options());
    const left = meanOfColumns(out, 0, 30);
    const right = meanOfColumns(out, out.width - 30, out.width);
    assert.ok(
      Math.abs(left - right) < 12,
      `left ${left.toFixed(1)} and right ${right.toFixed(1)} are the same paper`
    );
  });

  it("reads the channel the control names", () => {
    const image = scannedBack({ mark: 3, markChannel: "b" });
    const onBlue = markSeparation(enhanceWatermark(image, options({ channel: "blue" })));
    const onRed = markSeparation(enhanceWatermark(image, options({ channel: "red" })));
    assert.ok(onBlue > 40, `blue carries it (${onBlue.toFixed(1)})`);
    assert.ok(
      onRed < onBlue / 3,
      `red does not (${onRed.toFixed(1)} against ${onBlue.toFixed(1)})`
    );
  });

  it("shows blank paper as blank paper", () => {
    // Nothing but grain and a lamp. The output may be noisy — it is a stretch — but it must not
    // organise that noise into something with the shape and depth of a watermark.
    const image = scannedBack({ mark: 0 });
    const separation = markSeparation(enhanceWatermark(image, options()));
    assert.ok(separation < 10, `nothing stands where nothing is (${separation.toFixed(1)})`);
  });

  it("turns the contrast up with the strength control", () => {
    const image = scannedBack({ mark: 2 });
    const low = standardDeviation(enhanceWatermark(image, options({ strength: 0.4 })));
    const high = standardDeviation(enhanceWatermark(image, options({ strength: 2 })));
    assert.ok(high > low * 1.5, `${high.toFixed(1)} against ${low.toFixed(1)}`);
  });

  it("filters at the paper's scale, not the buffer's", () => {
    // The same paper scanned at twice the resolution: the radii follow `pixelsPerMm`, so the mark
    // reads about as well either way. A chain with radii in pixels would lose it.
    const fine = scannedBack({ width: 480, height: 360, mark: 3 });
    const separation = markSeparationScaled(
      enhanceWatermark(fine, options({ pixelsPerMm: PX_PER_MM * 2 })),
      PX_PER_MM * 2
    );
    assert.ok(separation > 40, `separation ${separation.toFixed(1)} at twice the resolution`);
  });

  it("falls back to an assumed scale rather than refusing", () => {
    const image = scannedBack({ mark: 3 });
    // 240 px taken as one 25 mm stamp is 9.6 px/mm — near enough to the truth that the mark still
    // reads, which is the point of falling back rather than showing nothing.
    const separation = markSeparation(enhanceWatermark(image, options({ pixelsPerMm: null })));
    assert.ok(separation > 40, `separation ${separation.toFixed(1)} on the assumed scale`);
  });

  it("returns an opaque grey buffer of the same size", () => {
    const image = scannedBack({ mark: 3 });
    const out = enhanceWatermark(image, options());
    assert.equal(out.width, image.width);
    assert.equal(out.height, image.height);
    assert.equal(out.data.length, image.width * image.height * 4);
    for (let i = 0; i < 40; i++) {
      const p = i * 4;
      assert.equal(out.data[p], out.data[p + 1]);
      assert.equal(out.data[p + 1], out.data[p + 2]);
      assert.equal(out.data[p + 3], 255);
    }
  });

  it("survives a degenerate crop rather than throwing", () => {
    const empty: Pixels = { data: new Uint8ClampedArray(0), width: 0, height: 0 };
    assert.equal(enhanceWatermark(empty, options()).data.length, 0);
    const single: Pixels = { data: new Uint8ClampedArray([1, 2, 3, 255]), width: 1, height: 1 };
    assert.equal(enhanceWatermark(single, options()).data.length, 4);
  });
});

/** {@link markSeparation} for a picture at a different pixel density — the bar is 2 mm wide either
 * way, so the region it is measured over has to follow the scale too. */
function markSeparationScaled(
  out: { data: Uint8ClampedArray; width: number; height: number },
  pxPerMm: number
): number {
  let inside = 0;
  let insideN = 0;
  let outside = 0;
  let outsideN = 0;
  for (let y = 0; y < out.height; y++) {
    for (let x = 0; x < out.width; x++) {
      const v = out.data[(y * out.width + x) * 4];
      const dx = Math.abs(x - out.width / 2);
      const within = dx <= pxPerMm && y > out.height * 0.2 && y < out.height * 0.8;
      if (within) {
        inside += v;
        insideN++;
      } else if (dx > 4 * pxPerMm) {
        outside += v;
        outsideN++;
      }
    }
  }
  return Math.abs(inside / insideN - outside / outsideN);
}

describe("clampStrength", () => {
  it("keeps a slider's value inside what the stretch is calibrated for", () => {
    assert.equal(clampStrength(0), MIN_WATERMARK_STRENGTH);
    assert.equal(clampStrength(99), MAX_WATERMARK_STRENGTH);
    assert.equal(clampStrength(Number.NaN), DEFAULT_WATERMARK_STRENGTH);
    assert.equal(clampStrength(1.5), 1.5);
  });
});
