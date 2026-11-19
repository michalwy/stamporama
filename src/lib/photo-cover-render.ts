// How a pixelated or blurred cover comes out (#1665, #2586; ADR-0066) — the pure half, shared by the
// server, which draws covers into the offer images (`photos/covers.ts`), and the editor and the copy's
// page, which draw the same thing on screen. One set of numbers, so what the collector sees while
// drawing is what goes on the image (#2586) and the two can never drift apart.
//
// No Prisma, no DOM, no sharp: pixels come in and go out as plain RGBA arrays.

import { DEFAULT_PHOTO_COVER_STRENGTH, normalizeCoverStrength, type PhotoCover } from "./photo-cover-rules";

/** How many blocks a pixelated cover is across its shorter side, at each strength step from 1 (#2587):
 *  from many small blocks to two large ones, which leave nothing to recognise. Step 3's six is what
 *  every pixelation had before strengths — few enough that a portrait or a symbol cannot be read back
 *  out of it on most stamps, many enough that it still reads as a covered stamp. */
export const PIXELATE_BLOCKS_BY_STRENGTH: readonly number[] = [12, 9, 6, 4, 3, 2];

/** A blur's Gaussian sigma as a share of the cover's shorter side, at each strength step from 1
 *  (#2587); null at the last, which is no blur but the box in its one average colour — a blur of plain
 *  colour, leaving nothing to recognise. Step 3's 0.2 is what every blur had before strengths. */
export const BLUR_SIGMA_SHARE_BY_STRENGTH: readonly (number | null)[] = [0.06, 0.12, 0.2, 0.3, 0.45, null];

/** A step's entry in a table indexed from 1, an unknown step read as the default (#2587). */
function atStrength<T>(table: readonly T[], strength: number): T {
  return table[(normalizeCoverStrength(strength) ?? DEFAULT_PHOTO_COVER_STRENGTH) - 1];
}

/** Where a Gaussian's mask is cut off, as a share of its peak — sharp's own default for `blur`, which
 *  the server uses, so the screen cuts it at the same place. */
export const BLUR_MIN_AMPLITUDE = 0.2;

/** How many pixels across its shorter side the screen blurs a cover at. Even the lightest blur is a
 *  few of these pixels wide, so working at this size and drawing the result larger loses nothing the eye can see, and it
 *  keeps the work the same however large the photo, so a cover can be dragged smoothly. */
export const BLUR_WORK_SIDE = 64;

export interface PixelBox {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** RGBA pixels, four bytes each, row by row — the layout a canvas reads and writes. */
export interface Rgba {
  data: Uint8ClampedArray<ArrayBuffer>;
  width: number;
  height: number;
}

/** The cover's box in the photo's pixels, clipped to the photo and never empty. */
export function coverPixelBox(
  cover: Pick<PhotoCover, "x" | "y" | "width" | "height">,
  width: number,
  height: number
): PixelBox {
  const left = Math.min(width - 1, Math.max(0, Math.floor(cover.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.floor(cover.y * height)));
  const right = Math.min(width, Math.max(left + 1, Math.ceil((cover.x + cover.width) * width)));
  const bottom = Math.min(height, Math.max(top + 1, Math.ceil((cover.y + cover.height) * height)));
  return { left, top, width: right - left, height: bottom - top };
}

/** How many blocks a pixelated box is cut into, across and down, at a strength step. */
export function pixelateGrid(
  box: { width: number; height: number },
  strength: number
): { columns: number; rows: number } {
  const block = Math.max(1, Math.ceil(Math.min(box.width, box.height) / atStrength(PIXELATE_BLOCKS_BY_STRENGTH, strength)));
  return {
    columns: Math.max(1, Math.ceil(box.width / block)),
    rows: Math.max(1, Math.ceil(box.height / block)),
  };
}

/** A blurred box's Gaussian sigma, in the photo's pixels, at a strength step — or null at the step
 *  that leaves the box in its one average colour (see {@link BLUR_SIGMA_SHARE_BY_STRENGTH}). */
export function blurSigma(box: { width: number; height: number }, strength: number): number | null {
  const share = atStrength(BLUR_SIGMA_SHARE_BY_STRENGTH, strength);
  return share == null ? null : Math.max(1, Math.min(box.width, box.height) * share);
}

/** For each target pixel along one axis, the source pixels it covers and how much of each. */
function areaWeights(from: number, to: number): { start: number; weights: number[] }[] {
  const scale = from / to;
  return Array.from({ length: to }, (_, i) => {
    const lo = i * scale;
    const hi = (i + 1) * scale;
    const start = Math.min(from - 1, Math.floor(lo));
    const end = Math.max(start + 1, Math.min(from, Math.ceil(hi)));
    const weights: number[] = [];
    let sum = 0;
    for (let s = start; s < end; s++) {
      const w = Math.max(0, Math.min(hi, s + 1) - Math.max(lo, s));
      weights.push(w);
      sum += w;
    }
    return { start, weights: weights.map((w) => (sum > 0 ? w / sum : 1 / weights.length)) };
  });
}

/** The pixels averaged down to `width` × `height`: each target pixel is the mean of the area of the
 *  source it covers — how a pixelation's blocks get their colours. */
export function averageDown(src: Rgba, width: number, height: number): Rgba {
  const w = Math.max(1, Math.round(width));
  const h = Math.max(1, Math.round(height));
  const across = areaWeights(src.width, w);
  const down = areaWeights(src.height, h);
  // Across first, into floats, then down.
  const mid = new Float32Array(src.height * w * 4);
  for (let y = 0; y < src.height; y++) {
    const row = y * src.width * 4;
    for (let x = 0; x < w; x++) {
      const { start, weights } = across[x];
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < weights.length; k++) {
        const p = row + (start + k) * 4;
        const wt = weights[k];
        r += src.data[p] * wt;
        g += src.data[p + 1] * wt;
        b += src.data[p + 2] * wt;
        a += src.data[p + 3] * wt;
      }
      const o = (y * w + x) * 4;
      mid[o] = r;
      mid[o + 1] = g;
      mid[o + 2] = b;
      mid[o + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++) {
    const { start, weights } = down[y];
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = 0; k < weights.length; k++) {
        const p = ((start + k) * w + x) * 4;
        const wt = weights[k];
        r += mid[p] * wt;
        g += mid[p + 1] * wt;
        b += mid[p + 2] * wt;
        a += mid[p + 3] * wt;
      }
      const o = (y * w + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { data: out, width: w, height: h };
}

/** A Gaussian mask as libvips (behind sharp's `blur`) builds it: every offset whose weight is at least
 *  `minAmplitude` of the peak, normalised to sum to one. */
export function gaussianKernel(sigma: number, minAmplitude: number = BLUR_MIN_AMPLITUDE): Float32Array {
  const twoSigmaSq = 2 * sigma * sigma;
  let radius = 0;
  while (Math.exp(-((radius + 1) * (radius + 1)) / twoSigmaSq) >= minAmplitude) radius++;
  const kernel = new Float32Array(radius * 2 + 1);
  let sum = 0;
  for (let i = -radius; i <= radius; i++) {
    const v = Math.exp(-(i * i) / twoSigmaSq);
    kernel[i + radius] = v;
    sum += v;
  }
  for (let i = 0; i < kernel.length; i++) kernel[i] /= sum;
  return kernel;
}

/** A Gaussian blur, across then down, the edge pixels repeated beyond the edges — as the server's
 *  blur of a cut-out box treats them. */
export function gaussianBlur(src: Rgba, sigma: number, minAmplitude: number = BLUR_MIN_AMPLITUDE): Rgba {
  const { width, height } = src;
  const kernel = gaussianKernel(sigma, minAmplitude);
  const radius = (kernel.length - 1) / 2;
  const clampX = (x: number) => (x < 0 ? 0 : x >= width ? width - 1 : x);
  const clampY = (y: number) => (y < 0 ? 0 : y >= height ? height - 1 : y);
  const mid = new Float32Array(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const p = (y * width + clampX(x + k)) * 4;
        const wt = kernel[k + radius];
        r += src.data[p] * wt;
        g += src.data[p + 1] * wt;
        b += src.data[p + 2] * wt;
        a += src.data[p + 3] * wt;
      }
      const o = (y * width + x) * 4;
      mid[o] = r;
      mid[o + 1] = g;
      mid[o + 2] = b;
      mid[o + 3] = a;
    }
  }
  const out = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let k = -radius; k <= radius; k++) {
        const p = (clampY(y + k) * width + x) * 4;
        const wt = kernel[k + radius];
        r += mid[p] * wt;
        g += mid[p + 1] * wt;
        b += mid[p + 2] * wt;
        a += mid[p + 3] * wt;
      }
      const o = (y * width + x) * 4;
      out[o] = r;
      out[o + 1] = g;
      out[o + 2] = b;
      out[o + 3] = a;
    }
  }
  return { data: out, width, height };
}

/**
 * What the screen draws for a pixelated or blurred cover, from the pixels under it.
 *
 * `region` is the box's pixels, read at any size no larger than the box; `box` is the box's size in the
 * photo's own pixels, which with `strength` fixes the blocks and the blur. A pixelation comes back as
 * its blocks, one pixel each, to be stretched over the box without smoothing — the server's blocks
 * exactly. A blur comes back at most {@link BLUR_WORK_SIDE} pixels across its shorter side, to be
 * stretched over the box smoothly; the blur of plain colour as one pixel of the box's average colour.
 */
export function paintCover(
  style: "pixelate" | "blur",
  region: Rgba,
  box: { width: number; height: number },
  strength: number
): Rgba {
  if (style === "pixelate") {
    const { columns, rows } = pixelateGrid(box, strength);
    return averageDown(region, columns, rows);
  }
  const sigma = blurSigma(box, strength);
  if (sigma == null) return averageDown(region, 1, 1);
  const scale = Math.min(1, BLUR_WORK_SIDE / Math.min(box.width, box.height));
  const work = averageDown(region, Math.min(region.width, box.width * scale), Math.min(region.height, box.height * scale));
  // The sigma is the box's, in the photo's pixels, carried to the work size.
  return gaussianBlur(work, sigma * (work.width / box.width));
}
