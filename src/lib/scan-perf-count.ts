// Counting the teeth between the perforation markers (#614), for the gauge #598 built.
//
// Pure — no DOM, no canvas, no React. The caller hands over pixels it has already read; everything
// from there is arithmetic, so the octave trap and the refuse-to-guess case are unit tests rather
// than something first met on a collector's screen.
//
// ## Why this is a narrow question, not a hard one
//
// A perforated edge is periodic, and **the two markers pin exactly how much of it is in view**: a
// run marked from the first hole to the last with `k` teeth between them spans exactly `k` periods.
// So the question is never "what is the period of this signal" — it is "which integer number of
// cycles best fits this window", which has a small candidate set and one obvious score per
// candidate. That is the whole method: one DFT bin per candidate, take the best, and refuse when
// nothing stands out.
//
// The candidate set is narrowed further by the **stated scale** (#598): a plausible gauge is roughly
// 3–30 teeth per 2 cm and the run's length in millimetres is already known, so the count is bounded
// before a pixel is looked at. The scale earns its keep twice — once converting the length, once
// keeping this from considering counts no perforation has.
//
// ## Resolution: safe here, and deliberately not safe for the length
//
// The profile is sampled from the tile's own photo, which for an ordinary single stamp *is* the scan
// and for an oversized tile is a downscale by a factor nothing states. That is fine **for a count**:
// a frequency survives resampling, and an unknown scale factor cannot change how many teeth lie in
// the window. It would not be fine for the millimetres, which is why the length keeps coming from
// the marks in scan pixels against the stated resolution and never from here. The two numbers come
// from different places on purpose.
//
// ## What it will not do
//
// It will not find the edge, and it will not move the markers — those are #598's decision and stand.
// It reads what is between two marks the collector placed, and when the reading is weak it returns
// null so the field keeps whatever is in it. A count nobody can check is the failure this is
// designed around; a count sitting in an editable field beside a live gauge is one keystroke from
// being right.

import { MAX_PLAUSIBLE_GAUGE, MIN_PLAUSIBLE_GAUGE, GAUGE_REFERENCE_MM } from "./scan-measure";

/** Greyscale-able pixels, in the shape `CanvasRenderingContext2D.getImageData` hands back — RGBA,
 * row-major. Taken as a plain structural type so a test can build one by hand. */
export interface Pixels {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** A point in the pixel buffer's own coordinates. */
export interface PixelPoint {
  x: number;
  y: number;
}

/** How many samples the profile is resampled to, at most — past this the extra points say nothing a
 * perforation could have put there, and the scoring loop is O(samples × candidates). */
const MAX_SAMPLES = 2048;

/** …and at least. A short run still gets a usable spectrum by oversampling, which costs nothing and
 * keeps the scoring loop from special-casing tiny windows. */
const MIN_SAMPLES = 96;

/** At least this many samples per period, or the candidate is not scored: below roughly four
 * points per cycle a DFT bin is reading the resampling as much as the paper. */
const MIN_SAMPLES_PER_PERIOD = 4;

/** A run shorter than this many teeth is not counted at all. Two cycles can be fitted by almost
 * anything; the honest answer on a three-tooth run is that it was not measured, which is also
 * #598's advice about short runs (a quarter gauge is a couple of pixels there). */
export const MIN_COUNTABLE_TEETH = 4;

/** The perpendicular offsets tried, in pixels. A line placed by hand sits a pixel or two off the
 * hole centres, and the profile through the centres is much the strongest — so the offsets exist to
 * recover a slightly misplaced line, not to search for the edge. */
const OFFSETS = [-8, -6, -4, -2, 0, 2, 4, 6, 8];

/**
 * How strong the winning bin has to be against the profile's own RMS, and how far it has to stand
 * out from the field of candidates. Both thresholds, because a profile with no period at all still
 * has a best bin and it is often not a weak one.
 *
 * Measured on synthetic edges rather than guessed: a clean run scores **1.28** at a prominence of
 * ~19, one buried in noise 1.27 at ~17, one grazing the holes' rims 1.11 at ~14 — while plain paper
 * tops out around 0.26 at a prominence under 2.6. The gap is an order of magnitude on the second
 * figure, so these sit far from both sides of it.
 *
 * Deliberately on the conservative side of that gap. Refusing a real edge costs the collector one
 * typed number, which they were going to type anyway before #614; inventing one costs a wrong gauge
 * that looks exactly like a right one, which is the failure #598 declined to build.
 */
const MIN_PERIODICITY = 0.5;
const MIN_PROMINENCE = 4;

/** An edge whose line grazes the paper between the holes sees **two** dark crossings per period —
 * both walls of each hole — so the octave above the truth can outscore it. Half the winner is
 * preferred whenever it scores at least this fraction of it, which is the standard guard and the
 * single most likely way to be wrong by a factor of two. */
const OCTAVE_PREFERENCE = 0.6;

/**
 * What came of trying to read the edge — the count, or **why there is not one**.
 *
 * A reason rather than a bare null, because the two ways of failing want different sentences and
 * because a caller that cannot tell them apart cannot tell the collector anything useful: *mark a
 * longer run* and *this does not look like a perforation* are different instructions, and "nothing
 * happened" is not an instruction at all.
 */
export type ToothCountResult =
  | {
      ok: true;
      teeth: number;
      /** The winning bin against the profile's RMS — around 1.2 on a clean edge. Reported so a
       * caller can say *counted* with a straight face, not so it can be shown as a percentage. */
      strength: number;
    }
  | {
      ok: false;
      /** `short` — the run cannot carry enough cycles to be read at all. `weak` — it was read and
       * carries no period worth a number. */
      reason: "short" | "weak";
      /** The strongest score seen, so a caller can say *nearly* rather than only *no*. Zero when
       * nothing was scored. */
      best: number;
    };

/** Greyscale at a point, bilinear. Off the edge of the buffer clamps rather than wrapping: a mark
 * placed at the very rim of a tile must not sample the opposite side of it. */
function sampleAt(img: Pixels, x: number, y: number): number {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const g = (px: number, py: number): number => {
    const cx = px < 0 ? 0 : px > img.width - 1 ? img.width - 1 : px;
    const cy = py < 0 ? 0 : py > img.height - 1 ? img.height - 1 : py;
    const i = (cy * img.width + cx) * 4;
    // Rec. 601 luma. The perforation is a hole in paper, so any sane luma works; this one is the
    // conventional choice and keeps a coloured stamp from reading as an edge.
    return 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
  };
  return (
    g(x0, y0) * (1 - fx) * (1 - fy) +
    g(x0 + 1, y0) * fx * (1 - fy) +
    g(x0, y0 + 1) * (1 - fx) * fy +
    g(x0 + 1, y0 + 1) * fx * fy
  );
}

/**
 * The brightness profile along a line, optionally shifted perpendicular to it.
 *
 * Exported for the tests, which build a synthetic edge and check that the profile of it is the
 * periodic thing the scoring below assumes.
 */
export function sampleProfile(
  img: Pixels,
  a: PixelPoint,
  b: PixelPoint,
  samples: number,
  perpendicularOffset = 0
): number[] {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!(len > 0) || samples < 2) return [];
  const nx = -dy / len;
  const ny = dx / len;
  const out = new Array<number>(samples);
  for (let i = 0; i < samples; i++) {
    const t = i / (samples - 1);
    out[i] = sampleAt(
      img,
      a.x + dx * t + nx * perpendicularOffset,
      a.y + dy * t + ny * perpendicularOffset
    );
  }
  return out;
}

/** One DFT bin: the amplitude of `k` whole cycles across the window, as a fraction of the profile's
 * own RMS. Mean-subtracted, so illumination that merely drifts across the run contributes nothing
 * at any candidate frequency. */
function cycleStrength(profile: number[], k: number): number {
  const n = profile.length;
  let mean = 0;
  for (let i = 0; i < n; i++) mean += profile[i];
  mean /= n;

  let re = 0;
  let im = 0;
  let power = 0;
  for (let i = 0; i < n; i++) {
    const v = profile[i] - mean;
    const phase = (-2 * Math.PI * k * i) / n;
    re += v * Math.cos(phase);
    im += v * Math.sin(phase);
    power += v * v;
  }
  const rms = Math.sqrt(power / n);
  if (!(rms > 1e-9)) return 0;
  return (2 * Math.hypot(re, im)) / n / rms;
}

/** The integer counts worth scoring for a run of this length. Bounded by what a perforation can
 * plausibly be when the run's length is known, and by the profile's own resolution when it is not. */
export function candidateToothCounts(
  samples: number,
  runLengthMm: number | null
): { min: number; max: number } {
  const byResolution = Math.floor(samples / MIN_SAMPLES_PER_PERIOD);
  if (runLengthMm !== null && runLengthMm > 0) {
    // teeth = gauge × mm / 20, so a plausible gauge band is a plausible count band.
    const min = Math.max(MIN_COUNTABLE_TEETH, Math.floor((MIN_PLAUSIBLE_GAUGE * runLengthMm) / GAUGE_REFERENCE_MM));
    const max = Math.min(byResolution, Math.ceil((MAX_PLAUSIBLE_GAUGE * runLengthMm) / GAUGE_REFERENCE_MM));
    return { min, max };
  }
  return { min: MIN_COUNTABLE_TEETH, max: byResolution };
}

/**
 * How many teeth a brightness profile carries, or null when it does not carry a count worth
 * showing.
 *
 * `runLengthMm` narrows the candidates to counts a perforation could actually be; pass null when
 * the scale has not been stated, and the resolution of the profile bounds it instead.
 */
export function countTeethInProfile(
  profile: number[],
  runLengthMm: number | null
): ToothCountResult {
  const n = profile.length;
  if (n < MIN_SAMPLES / 2) return { ok: false, reason: "short", best: 0 };

  const { min, max } = candidateToothCounts(n, runLengthMm);
  if (max < min) return { ok: false, reason: "short", best: 0 };

  const scores = new Map<number, number>();
  let best = 0;
  let bestScore = 0;
  let total = 0;
  for (let k = min; k <= max; k++) {
    const score = cycleStrength(profile, k);
    scores.set(k, score);
    total += score;
    if (score > bestScore) {
      bestScore = score;
      best = k;
    }
  }
  const candidates = max - min + 1;
  if (best === 0 || candidates === 0) return { ok: false, reason: "weak", best: 0 };

  // Weak, or not standing out from the field: both mean the profile has no period, and the second
  // check is what stops a run of noise — which still has a best bin — from becoming a count.
  const average = total / candidates;
  if (bestScore < MIN_PERIODICITY) return { ok: false, reason: "weak", best: bestScore };
  if (candidates > 2 && bestScore < average * MIN_PROMINENCE) {
    return { ok: false, reason: "weak", best: bestScore };
  }

  // The octave guard, applied repeatedly: a line grazing the paper between the holes sees both
  // walls of each hole, so the truth can sit an octave — or two — below the winning bin.
  let teeth = best;
  for (;;) {
    if (teeth % 2 !== 0) break;
    const half = teeth / 2;
    if (half < min) break;
    const halfScore = scores.get(half) ?? 0;
    if (halfScore < bestScore * OCTAVE_PREFERENCE) break;
    teeth = half;
  }
  if (teeth < MIN_COUNTABLE_TEETH) return { ok: false, reason: "short", best: bestScore };

  return { ok: true, teeth, strength: scores.get(teeth) ?? bestScore };
}

/**
 * How many teeth lie between two marks on an image — the whole job, from pixels to a count.
 *
 * Several parallel offsets are tried and the strongest reading wins: the collector aims at the
 * centres of the first and last hole, so offset `0` is the intended line and the rest are there to
 * recover one placed a pixel or two off it. The line is never moved and no offset is reported — the
 * markers stay exactly where they were put, because they are also what the *length* is measured
 * from and that must not shift under a count.
 */
export function countTeethBetweenMarks(args: {
  image: Pixels;
  a: PixelPoint;
  b: PixelPoint;
  /** The run's length in millimetres, from the marks and the stated scale — the candidate bound.
   * Null when no scale has been stated, which widens the search rather than stopping it. */
  runLengthMm: number | null;
}): ToothCountResult {
  const { image, a, b, runLengthMm } = args;
  const lengthPx = Math.hypot(b.x - a.x, b.y - a.y);
  if (!(lengthPx > 0)) return { ok: false, reason: "short", best: 0 };

  const samples = Math.max(MIN_SAMPLES, Math.min(MAX_SAMPLES, Math.round(lengthPx)));

  let best: ToothCountResult = { ok: false, reason: "short", best: 0 };
  for (const offset of OFFSETS) {
    const profile = sampleProfile(image, a, b, samples, offset);
    const found = countTeethInProfile(profile, runLengthMm);
    if (found.ok) {
      if (!best.ok || found.strength > best.strength) best = found;
    } else if (!best.ok && found.best > best.best) {
      // The nearest miss is kept, so a run that is merely weak does not get reported as too short
      // just because some offset was.
      best = found;
    }
  }
  return best;
}
