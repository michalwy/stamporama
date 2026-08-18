// Reading a watermark off the back of a scan (#625) — the filter chain, and nothing else.
//
// Pure — no DOM, no canvas, no React. The caller hands over the pixels it has already read and gets
// a grey buffer back, exactly as `scan-perf-count.ts` does, and for the same reason: what makes or
// breaks this is arithmetic, and arithmetic buried in a component is arithmetic nothing can test.
//
// ## What is actually being recovered
//
// A watermark is a **thickness difference in the paper**, not a mark on it. In a reflective scan of
// the back that arrives as a very weak, low-frequency variation in luminance — present in the bytes,
// sitting below the threshold at which an eye picks it out of paper grain and uneven scanner
// illumination. So the job is not to sharpen anything. It is to throw away the two things that are
// louder than the signal (the illumination gradient above it in scale, the grain below it) and then
// stretch what is left.
//
// Four steps, each earning its place:
//
// 1. **One channel, not luminance.** On cream and toned paper the blue channel usually carries the
//    best thickness contrast, and averaging to grey mixes it with two channels that carry less.
//    Which one wins depends on the paper, so the channel is a control rather than a constant.
// 2. **Band-pass** — a heavily blurred copy subtracted from a lightly blurred one. This is what
//    removes uneven illumination and the large tonal drift of the paper, and what keeps the spatial
//    scale a watermark actually lives at (roughly a millimetre to a centimetre).
// 3. **Grain suppression before the stretch** (a small median). Without it the stretch amplifies
//    paper grain more than it amplifies the watermark, which is a louder picture of nothing.
// 4. **A local contrast stretch**, tiled and interpolated (CLAHE in spirit). A global stretch is
//    decided by the darkest and lightest pixels in the frame and therefore does nothing in the
//    middle, where the watermark is; the watermark's contrast is local by nature.
//
// The optional fifth step #625 floated — posterisation or a false-colour ramp — is **not here**. It
// was worth trying and it is not worth keeping: a ramp turns the smooth thing being looked for into
// bands whose edges are artefacts of the ramp, and on a signal this weak the eye then reads the
// banding as the watermark. The scope says two controls, and adding a third that makes the picture
// more confident without making it more true is the wrong direction for a tool whose whole risk is
// seeing what is not there.
//
// ## What it cannot do
//
// **Show-through of the design printed on the front is the watermark's main competitor, and it
// occupies the same band.** Nothing here can separate the two: the filter lifts both, and on a
// heavily printed stamp the front's design is what comes up. Nor can processing invent signal that
// is not in the file — how the back was scanned (a dark backing, or transmitted light) dominates
// any chain of filters. The honest goal is *legible when the candidate watermarks are known*, not
// *clean*, and the UI says so rather than presenting the output as a photograph of a watermark.
//
// ## Nothing is stored
//
// No caller writes. This is a way of looking, like the ruler's marks — the collector's conclusion
// has a home (the stamp it was identified as, a parked tile's note), and a derivative image kept
// beside the scan would be a picture of a filter's opinion sitting where a scan belongs.

/** RGBA pixels, row-major — the shape `CanvasRenderingContext2D.getImageData` hands back. A plain
 * structural type so a test can build one by hand, and deliberately declared here rather than
 * shared with `scan-perf-count.ts`: the two modules read the same buffer for unrelated reasons, and
 * a shared type between them would be a dependency neither wants. */
export interface Pixels {
  data: Uint8ClampedArray | number[];
  width: number;
  height: number;
}

/** Which channel the thickness contrast is read out of. `grey` is Rec. 601 luma — the fallback when
 * no single channel is better, not the default. */
export type WatermarkChannel = "blue" | "green" | "red" | "grey";

/** The control's options, in the order they are offered — with the sentence each one wants beside
 * it, since *why you would pick this channel* is the whole of what the control is asking. Blue
 * first because it is right most often on cream and toned paper, which is most philatelic paper. */
export const WATERMARK_CHANNELS: readonly {
  value: WatermarkChannel;
  label: string;
  hint: string;
}[] = [
  {
    value: "blue",
    label: "Blue",
    hint: "Usually the best on cream and toned paper, which is most stamp paper — start here",
  },
  { value: "green", label: "Green", hint: "Worth a try when blue is flat, or on a yellowed back" },
  { value: "red", label: "Red", hint: "Worth a try on a blue or green back" },
  {
    value: "grey",
    label: "Grey",
    hint: "All three averaged — the fallback when no single channel is better",
  },
];

export const DEFAULT_WATERMARK_CHANNEL: WatermarkChannel = "blue";

/** The gain on the local stretch, as a multiple. 1 maps roughly ±2σ of local variation onto the
 * full range; past that the picture is mostly grain, below it most watermarks stay invisible. */
export const MIN_WATERMARK_STRENGTH = 0.25;
export const MAX_WATERMARK_STRENGTH = 2.5;
export const DEFAULT_WATERMARK_STRENGTH = 1;

/** The band the chain keeps, in millimetres: finer than this is grain and the scanner's own noise,
 * coarser is the paper's tone and the lamp. A watermark's strokes are around a millimetre wide and
 * the whole device a centimetre across, so the band is set around that and is not a control — a
 * collector has no way to judge it, and every value that helps is inside this window. */
const FINE_BLUR_MM = 0.1;
const COARSE_BLUR_MM = 2.5;

/** The grain median's radius, in millimetres — a hair over the fine blur, which is what makes it a
 * *rank* filter rather than a second blur: it removes speckle that survived the band-pass without
 * softening the edge of a stroke the way another Gaussian would. */
const GRAIN_MM = 0.12;

/** …and its ceiling in pixels. The cost of a median is quadratic in the radius, and past a couple of
 * pixels it is eating the signal rather than the grain. */
const MAX_GRAIN_RADIUS = 2;

/** How large a tile the local stretch adapts over. Comfortably larger than the watermark's strokes
 * and smaller than the stamp: a tile the size of the feature would flatten the very thing being
 * looked for, since a stroke filling its own tile *is* that tile's local contrast. */
const TILE_MM = 4;
const MIN_TILE_PX = 24;

/** The clip limit, expressed the way this stretch is: a tile whose own variation is below this
 * fraction of the picture's is stretched as though it had that much. Without it a tile of blank
 * paper — no watermark anywhere in it — is stretched by an unbounded gain and comes back as pure
 * amplified grain, which is CLAHE's classic failure and, here, a field of imaginary watermarks. */
const CLIP_FLOOR = 0.4;

/** How many local standard deviations fill the output range at strength 1. */
const STRETCH_SPAN = 4;

/** Box blurs run three times to stand in for a Gaussian — the standard trick, and the reason the
 * coarse blur costs the same as the fine one however wide it is (running sums, O(n) per pass). */
const BLUR_PASSES = 3;

/** Pixels per millimetre assumed when no scale has been stated: the buffer is taken to span roughly
 * one stamp. Unlike the ruler, a wrong assumption here costs a picture that filters at slightly the
 * wrong scale, never a number quoted as a fact — so this falls back rather than refusing. */
const ASSUMED_STAMP_MM = 25;

export interface WatermarkOptions {
  channel: WatermarkChannel;
  /** The gain on the local stretch — {@link MIN_WATERMARK_STRENGTH} to
   * {@link MAX_WATERMARK_STRENGTH}. */
  strength: number;
  /** How many pixels of **this buffer** one millimetre of paper occupies, which is what ties every
   * radius above to the paper rather than to the zoom. Null when nothing has been stated, and then
   * {@link ASSUMED_STAMP_MM} stands in. */
  pixelsPerMm: number | null;
}

/** The processed picture, in the same RGBA shape it arrived in — grey, opaque, ready for
 * `putImageData`. */
export interface WatermarkImage {
  data: Uint8ClampedArray;
  width: number;
  height: number;
}

/** One channel as a plane of floats. Exported for the tests, which check that the control actually
 * selects rather than merely relabelling. */
export function extractChannel(image: Pixels, channel: WatermarkChannel): Float32Array {
  const { width, height, data } = image;
  const out = new Float32Array(width * height);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) {
    const r = data[p];
    const g = data[p + 1];
    const b = data[p + 2];
    out[i] =
      channel === "blue"
        ? b
        : channel === "green"
          ? g
          : channel === "red"
            ? r
            : 0.299 * r + 0.587 * g + 0.114 * b;
  }
  return out;
}

/** One separable box-blur pass along the rows, edges clamped. Clamping rather than wrapping matters
 * at this radius: a coarse blur of a 25 px margin would otherwise fold the opposite edge of the
 * crop into the background estimate. */
function blurRows(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const span = 2 * r + 1;
  for (let y = 0; y < h; y++) {
    const row = y * w;
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[row + clampIndex(i, w)];
    for (let x = 0; x < w; x++) {
      dst[row + x] = sum / span;
      sum += src[row + clampIndex(x + r + 1, w)] - src[row + clampIndex(x - r, w)];
    }
  }
}

/** The same, down the columns. */
function blurCols(src: Float32Array, dst: Float32Array, w: number, h: number, r: number): void {
  const span = 2 * r + 1;
  for (let x = 0; x < w; x++) {
    let sum = 0;
    for (let i = -r; i <= r; i++) sum += src[clampIndex(i, h) * w + x];
    for (let y = 0; y < h; y++) {
      dst[y * w + x] = sum / span;
      sum += src[clampIndex(y + r + 1, h) * w + x] - src[clampIndex(y - r, h) * w + x];
    }
  }
}

function clampIndex(i: number, n: number): number {
  return i < 0 ? 0 : i > n - 1 ? n - 1 : i;
}

/** A Gaussian-ish blur at the given radius. Radius 0 (or a plane too small to carry one) is the
 * identity, which is what keeps the chain from special-casing a tiny crop. */
export function blurPlane(
  plane: Float32Array,
  w: number,
  h: number,
  radius: number
): Float32Array {
  const r = Math.max(0, Math.min(Math.floor(radius), Math.floor(Math.min(w, h) / 2)));
  const a = Float32Array.from(plane);
  if (r < 1 || w < 2 || h < 2) return a;
  const b = new Float32Array(plane.length);
  for (let pass = 0; pass < BLUR_PASSES; pass++) {
    blurRows(a, b, w, h, r);
    blurCols(b, a, w, h, r);
  }
  return a;
}

/**
 * Take the best-fitting tilted plane off — the lamp's falloff, as a first approximation, removed
 * before anything local looks at it.
 *
 * The band-pass below removes the illumination anyway, and in the middle of a crop this step
 * changes nothing. **It is here for the edges.** A blur that wide has to invent values beyond the
 * border, and whatever it invents is flat while the real picture is still climbing — so the
 * background estimate is wrong by a growing amount over the outermost blur-radius of the crop, and
 * that error is a smooth dark-to-light drift across the finished picture. Exactly the shape a
 * watermark could have. Fitting and removing the gradient *first* leaves the coarse blur a much
 * smaller thing to be wrong about at the border.
 *
 * A plane, not a surface: a scanner lamp falls off close to linearly across a stamp-sized crop, and
 * a higher-order fit would start absorbing the watermark itself.
 */
export function removePlane(plane: Float32Array, w: number, h: number): Float32Array {
  const out = Float32Array.from(plane);
  if (w < 2 || h < 2) return out;
  const cx = (w - 1) / 2;
  const cy = (h - 1) / 2;
  let sum = 0;
  let sumUV = 0;
  let sumVV = 0;
  let sumUValue = 0;
  let sumVValue = 0;
  for (let y = 0; y < h; y++) {
    const v = y - cy;
    for (let x = 0; x < w; x++) {
      const u = x - cx;
      const value = plane[y * w + x];
      sum += value;
      sumUValue += u * value;
      sumVValue += v * value;
      sumUV += u * u;
      sumVV += v * v;
    }
  }
  // The centred coordinates make the normal equations diagonal, so the three coefficients fall out
  // without a matrix: the cross terms are zero by symmetry over a full rectangle.
  const mean = sum / (w * h);
  const bx = sumUV > 0 ? sumUValue / sumUV : 0;
  const by = sumVV > 0 ? sumVValue / sumVV : 0;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      out[y * w + x] -= mean + bx * (x - cx) + by * (y - cy);
    }
  }
  return out;
}

/**
 * The band-pass: what is left of the plane between two blurs.
 *
 * The coarse copy is the **background** — the lamp's falloff across the platen, the paper's own
 * tone, the shadow of a mount — and subtracting it is what turns a 3% variation riding on a 40%
 * gradient into a signal centred on zero. The fine copy is the plane with the sensor's
 * pixel-to-pixel noise taken off, which is not the same thing as the grain (that is next) but is
 * what stops the subtraction from being noise-limited.
 *
 * Centred on zero, in the channel's own units, and unbounded — it is stretched later, so nothing is
 * clipped here where clipping would be irreversible.
 */
export function bandPass(
  plane: Float32Array,
  w: number,
  h: number,
  fineRadius: number,
  coarseRadius: number
): Float32Array {
  const fine = blurPlane(plane, w, h, fineRadius);
  const coarse = blurPlane(plane, w, h, coarseRadius);
  const out = new Float32Array(plane.length);
  for (let i = 0; i < out.length; i++) out[i] = fine[i] - coarse[i];
  return out;
}

/**
 * A median over a small square window — the grain step.
 *
 * A median rather than another blur because grain is *speckle*: individual pixels far from their
 * neighbours, which an average carries along in diluted form and a rank filter simply drops. Doing
 * it here, after the band-pass and before the stretch, is the order the whole chain turns on — a
 * stretch applied first amplifies the speckle by the same gain it applies to the watermark, and the
 * result is a louder picture of nothing.
 */
export function medianFilter(
  plane: Float32Array,
  w: number,
  h: number,
  radius: number
): Float32Array {
  const r = Math.max(0, Math.min(Math.floor(radius), MAX_GRAIN_RADIUS));
  if (r < 1 || w < 3 || h < 3) return Float32Array.from(plane);
  const out = new Float32Array(plane.length);
  const window = new Float32Array((2 * r + 1) * (2 * r + 1));
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let n = 0;
      for (let dy = -r; dy <= r; dy++) {
        const yy = clampIndex(y + dy, h) * w;
        for (let dx = -r; dx <= r; dx++) window[n++] = plane[yy + clampIndex(x + dx, w)];
      }
      // Insertion sort over at most 25 values: shorter than any cleverer selection, and this is the
      // inner loop of the whole chain.
      for (let i = 1; i < n; i++) {
        const v = window[i];
        let j = i - 1;
        while (j >= 0 && window[j] > v) {
          window[j + 1] = window[j];
          j--;
        }
        window[j + 1] = v;
      }
      out[y * w + x] = window[(n - 1) >> 1];
    }
  }
  return out;
}

/** A tile's own statistics, and the grid they were taken over. */
interface TileStats {
  cols: number;
  rows: number;
  mean: Float32Array;
  deviation: Float32Array;
}

function tileStats(plane: Float32Array, w: number, h: number, tilePx: number): TileStats {
  const cols = Math.max(1, Math.round(w / tilePx));
  const rows = Math.max(1, Math.round(h / tilePx));
  const mean = new Float32Array(cols * rows);
  const deviation = new Float32Array(cols * rows);
  for (let ty = 0; ty < rows; ty++) {
    const y0 = Math.floor((ty * h) / rows);
    const y1 = Math.max(y0 + 1, Math.floor(((ty + 1) * h) / rows));
    for (let tx = 0; tx < cols; tx++) {
      const x0 = Math.floor((tx * w) / cols);
      const x1 = Math.max(x0 + 1, Math.floor(((tx + 1) * w) / cols));
      let sum = 0;
      let sumSq = 0;
      let n = 0;
      for (let y = y0; y < y1; y++) {
        for (let x = x0; x < x1; x++) {
          const v = plane[y * w + x];
          sum += v;
          sumSq += v * v;
          n++;
        }
      }
      const m = n > 0 ? sum / n : 0;
      const variance = n > 0 ? Math.max(0, sumSq / n - m * m) : 0;
      mean[ty * cols + tx] = m;
      deviation[ty * cols + tx] = Math.sqrt(variance);
    }
  }
  return { cols, rows, mean, deviation };
}

/** Bilinear read of a tile grid at a pixel, against the tile **centres** — which is what makes the
 * mapping continuous. Nearest-tile would put a visible seam every tile width across the picture,
 * and on a signal this weak a seam reads as a watermark's edge. */
function sampleGrid(grid: Float32Array, cols: number, rows: number, gx: number, gy: number): number {
  const x0 = Math.min(cols - 1, Math.max(0, Math.floor(gx)));
  const y0 = Math.min(rows - 1, Math.max(0, Math.floor(gy)));
  const x1 = Math.min(cols - 1, x0 + 1);
  const y1 = Math.min(rows - 1, y0 + 1);
  const fx = Math.min(1, Math.max(0, gx - x0));
  const fy = Math.min(1, Math.max(0, gy - y0));
  const a = grid[y0 * cols + x0] * (1 - fx) + grid[y0 * cols + x1] * fx;
  const b = grid[y1 * cols + x0] * (1 - fx) + grid[y1 * cols + x1] * fx;
  return a * (1 - fy) + b * fy;
}

/**
 * The local contrast stretch: every pixel re-expressed as how far it sits from its own
 * neighbourhood's average, in units of that neighbourhood's own variation.
 *
 * Tiled and interpolated rather than per-pixel because per-pixel is prohibitive and looks worse:
 * with the statistics taken over a window the size of the feature, a watermark stroke is its own
 * local mean and vanishes. Tile statistics an order of magnitude larger than the strokes, read
 * bilinearly, keep the adaptation without eating the signal.
 *
 * The clip floor is what keeps a tile of blank paper from being stretched by an unbounded gain —
 * see {@link CLIP_FLOOR}. Output is 0…1.
 */
export function localContrastStretch(
  plane: Float32Array,
  w: number,
  h: number,
  opts: { tilePx: number; strength: number }
): Float32Array {
  const out = new Float32Array(plane.length);
  if (w < 1 || h < 1) return out;

  const { cols, rows, mean, deviation } = tileStats(plane, w, h, Math.max(1, opts.tilePx));

  // The picture's own variation, which is what the clip limit is expressed against — an absolute
  // floor would mean something different on every scanner.
  let sum = 0;
  let sumSq = 0;
  for (let i = 0; i < plane.length; i++) {
    sum += plane[i];
    sumSq += plane[i] * plane[i];
  }
  const globalMean = sum / plane.length;
  const globalDeviation = Math.sqrt(Math.max(0, sumSq / plane.length - globalMean * globalMean));
  const floor = Math.max(globalDeviation * CLIP_FLOOR, 1e-6);

  const gain = STRETCH_SPAN / Math.max(1e-6, opts.strength);

  for (let y = 0; y < h; y++) {
    const gy = (y / h) * rows - 0.5;
    for (let x = 0; x < w; x++) {
      const gx = (x / w) * cols - 0.5;
      const m = sampleGrid(mean, cols, rows, gx, gy);
      const s = Math.max(floor, sampleGrid(deviation, cols, rows, gx, gy));
      const v = 0.5 + (plane[y * w + x] - m) / (gain * s);
      out[y * w + x] = v < 0 ? 0 : v > 1 ? 1 : v;
    }
  }
  return out;
}

/**
 * The whole chain: RGBA in, grey RGBA out.
 *
 * Every radius is derived from `pixelsPerMm`, so the same watermark filters the same way whether the
 * crop came off a 600 dpi card or a 1200 dpi one, and whether the viewer is at fit or at 8×. That is
 * the same discipline the ruler follows for the opposite reason: there a stated scale keeps a number
 * from being wrong, here it keeps the filter looking at the band a watermark occupies rather than at
 * whatever band this crop's pixels happen to land in.
 */
export function enhanceWatermark(image: Pixels, opts: WatermarkOptions): WatermarkImage {
  const { width: w, height: h } = image;
  const out = new Uint8ClampedArray(Math.max(0, w * h * 4));
  if (w < 1 || h < 1) return { data: out, width: Math.max(0, w), height: Math.max(0, h) };

  const pxPerMm =
    opts.pixelsPerMm !== null && opts.pixelsPerMm > 0
      ? opts.pixelsPerMm
      : Math.max(1, w / ASSUMED_STAMP_MM);

  const plane = removePlane(extractChannel(image, opts.channel), w, h);
  const banded = bandPass(plane, w, h, FINE_BLUR_MM * pxPerMm, COARSE_BLUR_MM * pxPerMm);
  const cleaned = medianFilter(banded, w, h, Math.round(GRAIN_MM * pxPerMm));
  const stretched = localContrastStretch(cleaned, w, h, {
    tilePx: Math.max(MIN_TILE_PX, TILE_MM * pxPerMm),
    strength: clampStrength(opts.strength),
  });

  for (let i = 0, p = 0; i < stretched.length; i++, p += 4) {
    const v = Math.round(stretched[i] * 255);
    out[p] = v;
    out[p + 1] = v;
    out[p + 2] = v;
    out[p + 3] = 255;
  }
  return { data: out, width: w, height: h };
}

/** A strength into the range the stretch is calibrated for. Clamped rather than validated: this
 * comes off a slider, and a value outside the range is a caller's slip rather than a collector's. */
export function clampStrength(strength: number): number {
  if (!Number.isFinite(strength)) return DEFAULT_WATERMARK_STRENGTH;
  return Math.min(MAX_WATERMARK_STRENGTH, Math.max(MIN_WATERMARK_STRENGTH, strength));
}
