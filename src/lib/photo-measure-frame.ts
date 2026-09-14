// The pixels a plain photo is measured in (#1290) — pure, beside `scan-measure.ts`, for the same
// reason: whether a figure can be taken at all is a rule, and a rule inside a component is one
// nothing can test.
//
// ## Why a photo needs a frame at all
//
// A scan tile is measured in its **box** — the rectangle it was cut from on the card, in the card's
// own pixels (#598). A copy's photo after identification, or a picture uploaded straight onto a
// copy or a stamp, has no box: what the app holds of it is the stored `full` derivative, which has
// been through `FULL_MAX_EDGE`. The upload itself is discarded. So the derivative may *be* the
// picture, or it may be a downscale of it, and a stated dpi applies to the upload, never to the
// derivative.
//
// `Photo.originalWidth` / `originalHeight` close that gap: they are the upload's own size, recorded
// before the downscale. Measuring in **that** frame makes the scale exact whatever the derivative
// on screen is — a mark is placed on the derivative, converted to the upload's pixels, and only then
// to millimetres against the stated dpi. What the downscale costs is how precisely a mark can be
// placed, never what the number means.
//
// ## When there is no frame
//
// A row written before those columns existed has no original size. If its derivative is under the
// cap on both edges it cannot have been downscaled — the pipeline never enlarges — so its own size
// is the upload's. If an edge reaches the cap, it may have been shrunk by a factor nothing records,
// and measuring it would take a reading at a resolution the app merely assumed: the one thing the
// measuring tools must never do. **No frame, and the tools are absent**, exactly as on a tile side
// with no box.

export interface PhotoPixels {
  /** The stored `full` derivative's size. */
  width: number;
  height: number;
  /** The upload's size before the downscale, or null on rows that predate the columns. */
  originalWidth: number | null;
  originalHeight: number | null;
}

export interface MeasureFrame {
  width: number;
  height: number;
}

/** How far the upload's shape may differ from the derivative's before the row is not believed. A
 * downscale rounds each edge to a whole pixel, so a long thin strip drifts by a pixel's worth of
 * ratio; anything past this is two different pictures, not a rounding. */
const ASPECT_TOLERANCE = 0.02;

/**
 * The frame a photo is measured in, or null when it cannot be measured honestly.
 *
 * `maxEdge` is the pipeline's `FULL_MAX_EDGE`, passed in so this module stays free of `sharp`.
 */
export function photoMeasureFrame(photo: PhotoPixels, maxEdge: number): MeasureFrame | null {
  const { width, height, originalWidth, originalHeight } = photo;
  if (!(width > 0) || !(height > 0)) return null;

  if (originalWidth != null && originalHeight != null) {
    if (!(originalWidth > 0) || !(originalHeight > 0)) return null;
    // The pipeline never enlarges, so an original smaller than its own derivative is a row that
    // disagrees with itself — and a frame built on it would scale every reading the wrong way.
    if (originalWidth < width || originalHeight < height) return null;
    const stored = width / height;
    const original = originalWidth / originalHeight;
    if (Math.abs(original - stored) > stored * ASPECT_TOLERANCE) return null;
    return { width: originalWidth, height: originalHeight };
  }

  // No recorded original. Under the cap on both edges the derivative is the upload; at the cap it
  // may be a downscale by an unknown factor.
  if (Math.max(width, height) >= maxEdge) return null;
  return { width, height };
}
