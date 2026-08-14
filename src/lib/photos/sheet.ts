import sharp from "sharp";
import {
  FULL_MAX_EDGE,
  isAcceptedMime,
  orientedSize,
  processImage,
  UnsupportedImageError,
  type AcceptedMime,
  type ProcessedImage,
  type ProcessedVariant,
} from "./process";
import type { Box } from "../scan-boxes";

/**
 * Scan sheet handling (#566, ADR-0033) — the one place in the image pipeline where the **order** is
 * the point.
 *
 * `processImage` downscales every upload to `FULL_MAX_EDGE` (2500 px) and keeps no original. Run a
 * whole stockbook card through that and a card of forty yields ~600 px tiles: the sheet has spent
 * its resolution on being a sheet. So the cut happens **first, on the original**, and each crop is
 * then handed to `processImage` unchanged — giving every tile its own `full` and `thumb` exactly
 * like a photograph taken of that stamp alone. A card scanned at 600 dpi yields ~800 px tiles, well
 * inside the cap, with no downscale at all.
 *
 * That ordering is easy to get backwards and impossible to notice afterwards: the tiles come out
 * looking fine, merely soft, and by then the stockbook has been broken up. Hence this module, the
 * ADR, and the fact that nothing here calls `processImage` on a sheet.
 *
 * ## Orientation
 *
 * The retained original is the **uploaded bytes, untouched** — re-encoding a scan to normalise it
 * would throw away the quality the whole arrangement exists to keep. EXIF orientation is therefore
 * still in the file, and every read of a sheet goes through `.rotate()`: the `view` derivative, and
 * every crop. The dimensions recorded on the sheet are likewise the *oriented* ones, so a box drawn
 * on screen and a box handed to `extract` mean the same thing.
 */

/** A sheet upload, ready to be stored: the bytes to retain and the derivative to display. */
export interface PreparedSheet {
  /** The upload's own bytes, stored under `original.<ext>` and never resampled. */
  original: Buffer;
  mime: AcceptedMime;
  /** Oriented dimensions of the original — the coordinate space every box lives in. */
  width: number;
  height: number;
  sizeBytes: number;
  /** `FULL_MAX_EDGE`-capped derivative, stored under `view.<ext>`. What the review editor shows:
   * a browser cannot be handed a 30 Mpx image, and the original must never be the thing on screen
   * because a canvas that has to decode it is a canvas that drops the drag. */
  view: ProcessedVariant;
}

/** Validate and measure a sheet upload, and derive its display copy. The original is returned
 * unchanged — this function deliberately produces no `full` and no `thumb`, because a sheet is not
 * a photo of anything. */
export async function prepareSheet(
  input: Buffer,
  declaredMime: string
): Promise<PreparedSheet> {
  if (!isAcceptedMime(declaredMime)) {
    throw new UnsupportedImageError(`Unsupported image type: ${declaredMime}`);
  }

  const base = sharp(input, { failOn: "error" }).rotate();
  const meta = await base.metadata();
  const actualMime = mimeOf(meta.format);
  if (!actualMime) {
    throw new UnsupportedImageError(
      `Unsupported or corrupt image (format: ${meta.format ?? "unknown"})`
    );
  }

  const view = await base
    .clone()
    .resize(FULL_MAX_EDGE, FULL_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .toFormat(formatFor(actualMime))
    .toBuffer({ resolveWithObject: true });

  // Normalised by hand from the metadata rather than measured off a decoded buffer: the answer is
  // the same and this does not re-encode a 30 Mpx scan to learn two numbers. A sheet whose recorded
  // size disagreed with the image on screen would put every box on the card wrong, which is why it
  // shares `process.ts`'s rule instead of restating it.
  const oriented = orientedSize(meta, { width: view.info.width, height: view.info.height });

  return {
    original: input,
    mime: actualMime,
    width: oriented.width,
    height: oriented.height,
    sizeBytes: input.byteLength,
    view: {
      buffer: view.data,
      width: view.info.width,
      height: view.info.height,
      mime: actualMime,
    },
  };
}

/**
 * Cut a sheet into crops and put each one through the existing photo pipeline.
 *
 * Crops are `extract`ed from the **full-resolution original** — nothing is resized on the way out,
 * because a resample here is resolution spent twice. The decode is shared across every box: one
 * `sharp` pipeline, cloned per crop, so a card of forty decodes the sheet once and not forty times.
 *
 * Boxes are in the sheet's oriented pixels and are assumed already clamped to it (`normalizeBox`);
 * a box outside the image is a programming error and `extract` will say so rather than silently
 * cropping something else.
 *
 * Returns one `ProcessedImage` per box, in the order given — the caller has already put them in
 * reading order and pairs its own bookkeeping to that order.
 */
export async function cutSheet(
  original: Buffer,
  boxes: readonly Box[]
): Promise<ProcessedImage[]> {
  if (boxes.length === 0) return [];

  const base = sharp(original, { failOn: "error" }).rotate();
  const meta = await base.metadata();
  const mime = mimeOf(meta.format);
  if (!mime) {
    throw new UnsupportedImageError(
      `Unsupported or corrupt image (format: ${meta.format ?? "unknown"})`
    );
  }

  const crops: ProcessedImage[] = [];
  for (const b of boxes) {
    // Encoded back to the source format and handed to `processImage` as if it had been uploaded on
    // its own. The extra decode is on an ~800 px crop and costs nothing next to the guarantee that
    // a tile is processed by exactly the code every other photo is.
    const cropped = await base
      .clone()
      .extract({ left: b.x, top: b.y, width: b.w, height: b.h })
      .toFormat(formatFor(mime))
      .toBuffer();
    crops.push(await processImage(cropped, mime));
  }
  return crops;
}

function mimeOf(format: string | undefined): AcceptedMime | null {
  switch (format) {
    case "jpeg":
      return "image/jpeg";
    case "png":
      return "image/png";
    case "webp":
      return "image/webp";
    default:
      return null;
  }
}

function formatFor(mime: AcceptedMime): "jpeg" | "png" | "webp" {
  return mime === "image/jpeg" ? "jpeg" : mime === "image/png" ? "png" : "webp";
}
