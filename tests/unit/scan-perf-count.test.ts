import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_COUNTABLE_TEETH,
  candidateToothCounts,
  countTeethBetweenMarks,
  countTeethInProfile,
  sampleProfile,
  type Pixels,
} from "../../src/lib/scan-perf-count";

/** A plausible run length in millimetres for a given tooth count — gauge 12, the middle of what
 * philately actually uses. The synthetic edges below are pitched at 26 px, so this pairs them with
 * a ~400 dpi scan; the counting never sees a dpi, only the length it has to bound candidates by. */
function runMm(teeth: number): number {
  return (teeth * 20) / 12;
}

/**
 * A synthetic perforated edge: white paper with a row of dark holes down the middle of it, pitched
 * so that `teeth` teeth lie between the first hole's centre and the last one's.
 *
 * Dark holes on light paper rather than the other way round is arbitrary — the counting is on the
 * *period*, not on which way the contrast runs — and one of the tests below checks exactly that by
 * inverting it.
 */
function perforatedEdge(opts: {
  teeth: number;
  pitch: number;
  holeRadius?: number;
  noise?: number;
  invert?: boolean;
  margin?: number;
}): { image: Pixels; a: { x: number; y: number }; b: { x: number; y: number } } {
  const { teeth, pitch, holeRadius = pitch * 0.28, noise = 0, invert = false, margin = 20 } = opts;
  const holes = teeth + 1;
  const width = Math.ceil(margin * 2 + pitch * teeth) + 1;
  const height = margin * 2 + 1;
  const data = new Uint8ClampedArray(width * height * 4);
  const paper = invert ? 30 : 235;
  const hole = invert ? 235 : 30;

  // A deterministic wobble stands in for scanner noise: `Math.random()` would make a failure
  // impossible to reproduce, which for a detector is the wrong kind of test.
  let seed = 12345;
  const jitter = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return ((seed / 0x7fffffff) * 2 - 1) * noise;
  };

  const cy = Math.floor(height / 2);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let v = paper;
      for (let h = 0; h < holes; h++) {
        const hx = margin + h * pitch;
        if (Math.hypot(x - hx, y - cy) <= holeRadius) {
          v = hole;
          break;
        }
      }
      v += jitter();
      const i = (y * width + x) * 4;
      data[i] = v;
      data[i + 1] = v;
      data[i + 2] = v;
      data[i + 3] = 255;
    }
  }
  return {
    image: { data, width, height },
    a: { x: margin, y: cy },
    b: { x: margin + pitch * teeth, y: cy },
  };
}

describe("sampleProfile", () => {
  it("reads the edge as a periodic signal along the marked line", () => {
    const { image, a, b } = perforatedEdge({ teeth: 8, pitch: 30 });
    const profile = sampleProfile(image, a, b, 400);
    assert.equal(profile.length, 400);
    // Both ends sit on a hole centre, which is the darkest the profile gets.
    const min = Math.min(...profile);
    const max = Math.max(...profile);
    assert.ok(profile[0] < min + (max - min) * 0.1, "starts on a hole");
    assert.ok(profile[399] < min + (max - min) * 0.1, "ends on a hole");
    assert.ok(max - min > 100, "paper and hole are far apart");
  });

  it("is empty for a degenerate line", () => {
    const { image, a } = perforatedEdge({ teeth: 8, pitch: 30 });
    assert.deepEqual(sampleProfile(image, a, a, 400), []);
  });
});

describe("candidateToothCounts", () => {
  it("is bounded by what a perforation can be once the scale is stated", () => {
    // A 21 mm run: gauge 3 → ~3 teeth, gauge 30 → ~32. The floor is the countable minimum.
    const { min, max } = candidateToothCounts(1000, 21);
    assert.equal(min, MIN_COUNTABLE_TEETH);
    assert.equal(max, 32);
  });

  it("is bounded by the profile's own resolution when nothing else bounds it", () => {
    const { min, max } = candidateToothCounts(200, null);
    assert.equal(min, MIN_COUNTABLE_TEETH);
    assert.equal(max, 50);
  });

  it("never proposes more cycles than the samples can carry", () => {
    // A very long run at a coarse sample count: resolution wins over the gauge band.
    const { max } = candidateToothCounts(96, 200);
    assert.equal(max, 24);
  });
});

describe("countTeethBetweenMarks", () => {
  it("counts a clean edge", () => {
    for (const teeth of [6, 9, 12, 14, 17]) {
      const { image, a, b } = perforatedEdge({ teeth, pitch: 26 });
      const found = countTeethBetweenMarks({ image, a, b, runLengthMm: runMm(teeth) });
      assert.ok(found.ok, `expected a count for ${teeth} teeth`);
      assert.equal(found.teeth, teeth);
    }
  });

  it("counts the same edge with the contrast the other way round", () => {
    const { image, a, b } = perforatedEdge({ teeth: 12, pitch: 26, invert: true });
    const found = countTeethBetweenMarks({ image, a, b, runLengthMm: runMm(12) });
    assert.equal(found.ok && found.teeth, 12);
  });

  it("counts through scanner noise", () => {
    const { image, a, b } = perforatedEdge({ teeth: 12, pitch: 26, noise: 28 });
    const found = countTeethBetweenMarks({ image, a, b, runLengthMm: runMm(12) });
    assert.equal(found.ok && found.teeth, 12);
  });

  it("recovers a line placed a little off the hole centres", () => {
    // The offsets exist for exactly this: a mark two or three pixels above the row of holes.
    const { image, a, b } = perforatedEdge({ teeth: 12, pitch: 26 });
    const found = countTeethBetweenMarks({
      image,
      a: { x: a.x, y: a.y - 3 },
      b: { x: b.x, y: b.y - 3 },
      runLengthMm: runMm(12),
    });
    assert.equal(found.ok && found.teeth, 12);
  });

  it("does not report the octave when the line grazes between the holes", () => {
    // Two crossings per period is the classic way to read a perforation as twice itself.
    const { image, a, b } = perforatedEdge({ teeth: 12, pitch: 26, holeRadius: 9 });
    const grazing = 8; // just inside the holes' rims, so each hole gives two dips
    const found = countTeethBetweenMarks({
      image,
      a: { x: a.x, y: a.y - grazing },
      b: { x: b.x, y: b.y - grazing },
      runLengthMm: runMm(12),
    });
    assert.equal(found.ok && found.teeth, 12);
  });

  it("counts nothing at all on plain paper", () => {
    const width = 400;
    const height = 41;
    const data = new Uint8ClampedArray(width * height * 4);
    let seed = 7;
    for (let i = 0; i < width * height; i++) {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      const v = 220 + ((seed / 0x7fffffff) * 2 - 1) * 12;
      data[i * 4] = v;
      data[i * 4 + 1] = v;
      data[i * 4 + 2] = v;
      data[i * 4 + 3] = 255;
    }
    const found = countTeethBetweenMarks({
      image: { data, width, height },
      a: { x: 20, y: 20 },
      b: { x: 380, y: 20 },
      runLengthMm: runMm(12),
    });
    assert.equal(found.ok, false, "a run with no period must return nothing, not its best bin");
    assert.equal(found.ok === false && found.reason, "weak");
  });

  it("refuses a degenerate mark rather than dividing by zero", () => {
    const { image, a } = perforatedEdge({ teeth: 12, pitch: 26 });
    const found = countTeethBetweenMarks({ image, a, b: a, runLengthMm: runMm(12) });
    assert.equal(found.ok, false);
    assert.equal(found.ok === false && found.reason, "short");
  });

  it("works without a stated scale, which only widens the search", () => {
    const { image, a, b } = perforatedEdge({ teeth: 12, pitch: 26 });
    const loose = countTeethBetweenMarks({ image, a, b, runLengthMm: null });
    assert.ok(loose.ok);
    assert.equal(loose.teeth, 12);
  });
});

describe("countTeethInProfile", () => {
  it("takes a bare periodic profile", () => {
    const n = 600;
    const profile = Array.from({ length: n }, (_, i) => Math.cos((2 * Math.PI * 11 * i) / n));
    const found = countTeethInProfile(profile, null);
    assert.equal(found.ok && found.teeth, 11);
  });

  it("returns null for a profile too short to carry a spectrum", () => {
    assert.equal(countTeethInProfile([1, 2, 3, 4], null).ok, false);
  });

  it("returns null for a flat profile rather than dividing by its own silence", () => {
    assert.equal(countTeethInProfile(new Array(600).fill(128), null).ok, false);
  });
});
