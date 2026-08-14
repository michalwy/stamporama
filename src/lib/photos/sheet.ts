import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import sharp from "sharp";
import type { StorageInput } from "../storage/types";
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

/**
 * Where a sheet's bytes are, on the way in.
 *
 * A `Buffer` is the ordinary case. A **path** is the chunked upload (#590): its parts are assembled
 * into one local file, and handing that file's path to `sharp` — which takes one — is what keeps a
 * 200 MB card from ever being resident whole. Nothing else about a sheet differs between the two;
 * this is only how the bytes are reached.
 */
export type SheetSource = Buffer | { path: string };

/** A sheet upload, ready to be stored: the bytes to retain and the derivative to display. */
export interface PreparedSheet {
  /** Open the upload's own bytes for storing under `original.<ext>`, never resampled. A function
   * rather than a value because for a file-backed source it is a read stream, and one created for a
   * `put` that then never happens is a descriptor left open — so it is opened at the moment it is
   * consumed. */
  openOriginal: () => StorageInput;
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
  input: SheetSource,
  declaredMime: string
): Promise<PreparedSheet> {
  if (!isAcceptedMime(declaredMime)) {
    throw new UnsupportedImageError(`Unsupported image type: ${declaredMime}`);
  }

  // `sharp` reads a path as readily as a buffer, and for a 1200 dpi card that is the difference
  // between decoding a file and holding it in memory *while* decoding it (#590).
  const base = sharp(Buffer.isBuffer(input) ? input : input.path, { failOn: "error" }).rotate();
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
    openOriginal: () => (Buffer.isBuffer(input) ? input : createReadStream(input.path)),
    mime: actualMime,
    width: oriented.width,
    height: oriented.height,
    sizeBytes: Buffer.isBuffer(input) ? input.byteLength : (await stat(input.path)).size,
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

/**
 * One region of a sheet, at the size it will be displayed — what the editor asks for once it is
 * zoomed past the `view` derivative's own scale (#579).
 *
 * `view` is capped at `FULL_MAX_EDGE` (2500 px) while a 600 dpi card is around 7000, so zooming the
 * view alone magnifies a threefold downscale: a larger blur rather than more stamp. And the review
 * exists to catch the quietest error there is — a box clipping a stamp's perforation by a few
 * pixels — which at fit-to-window on a whole card is invisible. So past that point the visible
 * region comes from the retained original. The bytes are already kept; this is what they are kept
 * for.
 *
 * This is the same `extract` the cut itself uses, on the same untouched bytes through the same
 * `.rotate()`, so a region and a crop of the same box are the same pixels. The one difference is
 * that this one **is** resized — to the pixels the screen has and no more, since the point is what
 * the collector can see, not what the file holds.
 */
export async function extractSheetRegion(
  original: Buffer,
  box: Box,
  renderWidth: number
): Promise<{ buffer: Buffer; mime: AcceptedMime; width: number; height: number }> {
  const base = sharp(original, { failOn: "error" }).rotate();
  const meta = await base.metadata();
  const mime = mimeOf(meta.format);
  if (!mime) {
    throw new UnsupportedImageError(
      `Unsupported or corrupt image (format: ${meta.format ?? "unknown"})`
    );
  }

  const out = await base
    .extract({ left: box.x, top: box.y, width: box.w, height: box.h })
    .resize(Math.min(renderWidth, box.w), null, { withoutEnlargement: true })
    .toFormat(formatFor(mime))
    .toBuffer({ resolveWithObject: true });

  return { buffer: out.data, mime, width: out.info.width, height: out.info.height };
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
