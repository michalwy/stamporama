import sharp, { type Metadata } from "sharp";

// `sharp` image processing for photo uploads (#112). On upload, in a single decode, the
// original is downscaled to the full-size derivative and a thumbnail is generated. Both are
// written eagerly at upload time so the serving route stays a dumb byte stream.

/** Longest-edge cap for the stored full-size derivative. */
export const FULL_MAX_EDGE = 2500;
/** Longest-edge cap for the thumbnail used in slot/list display. Changing this later requires
 * a one-off backfill script to regenerate existing thumbnails. */
export const THUMB_MAX_EDGE = 320;

/**
 * Max accepted upload size (bytes). The whole file is buffered in memory before `sharp` decodes
 * it, so this is a memory bound as much as a policy.
 *
 * **Fitted to a full-resolution card scan** (#566/#567), not to a photograph. At 60 MB it was a
 * guard against a stray upload — a phone photo of a stamp is a couple of megabytes and nothing on
 * the ordinary path comes near either figure. A whole stockbook card scanned at 1200 dpi routinely
 * passes 60 MB, and that file is *retained*, uncapped, because the cut is taken from the original
 * (ADR-0033 §3/§4): a card cannot be re-scanned once it has been broken up, so refusing the scan is
 * refusing the ingest.
 *
 * Deliberately **one number for every upload** rather than a larger cap for sheets. One limit is
 * explainable and appears in one sentence of the user guide; two would need every caller, route and
 * error message to say which one it meant, and the photo path loses nothing to a ceiling it never
 * approaches. Whoever raises this next: the figure is about the largest scan worth accepting, and
 * the cost is that much resident memory per concurrent upload.
 */
export const MAX_UPLOAD_BYTES = 200 * 1024 * 1024;

/** Accepted upload formats. Anything else is rejected before processing. */
export const ACCEPTED_MIMES = ["image/jpeg", "image/png", "image/webp"] as const;
export type AcceptedMime = (typeof ACCEPTED_MIMES)[number];

export function isAcceptedMime(mime: string): mime is AcceptedMime {
  return (ACCEPTED_MIMES as readonly string[]).includes(mime);
}

/** sharp output format + resulting mime, keyed by the (validated) source format. Output mime
 * matches the source so the extension/mime persisted with the photo is honest. */
const OUTPUT: Record<
  AcceptedMime,
  { format: "jpeg" | "png" | "webp"; mime: AcceptedMime }
> = {
  "image/jpeg": { format: "jpeg", mime: "image/jpeg" },
  "image/png": { format: "png", mime: "image/png" },
  "image/webp": { format: "webp", mime: "image/webp" },
};

/** One processed derivative: encoded bytes plus its dimensions and mime. */
export interface ProcessedVariant {
  buffer: Buffer;
  width: number;
  height: number;
  mime: AcceptedMime;
}

/** Result of processing one upload: the `full` derivative (drives the persisted photo's
 * dimensions/mime), its `thumb`, and the source's own dimensions. */
export interface ProcessedImage {
  full: ProcessedVariant;
  thumb: ProcessedVariant;
  /** The upload's dimensions *before* the `FULL_MAX_EDGE` downscale, EXIF rotation already applied
   * so they describe the visible image like the derivatives' do. Persisted because the original
   * bytes are not: it is the only record of how much a scan was shrunk, which is what lets the
   * collage renderer put two scans back on a common scale. Equal to `full`'s when nothing was
   * clamped, which is the common case. */
  original: { width: number; height: number };
}

export class UnsupportedImageError extends Error {}

/** Downscale + thumbnail an uploaded image in a single decode. `withoutEnlargement` keeps
 * small originals at their native size rather than upscaling. Rotation is normalized from
 * EXIF orientation so stored dimensions match the visible image. */
export async function processImage(
  input: Buffer,
  declaredMime: string
): Promise<ProcessedImage> {
  if (!isAcceptedMime(declaredMime)) {
    throw new UnsupportedImageError(`Unsupported image type: ${declaredMime}`);
  }

  // Decode once; validate the real format from the bytes, not just the declared mime.
  const base = sharp(input, { failOn: "error" }).rotate();
  const meta = await base.metadata();
  const actualMime =
    meta.format === "jpeg"
      ? "image/jpeg"
      : meta.format === "png"
        ? "image/png"
        : meta.format === "webp"
          ? "image/webp"
          : null;
  if (!actualMime || !isAcceptedMime(actualMime)) {
    throw new UnsupportedImageError(
      `Unsupported or corrupt image (format: ${meta.format ?? "unknown"})`
    );
  }

  const out = OUTPUT[actualMime];

  const encode = async (maxEdge: number): Promise<ProcessedVariant> => {
    // Clone the decoded pipeline so full + thumb share the single decode above.
    const pipeline = base
      .clone()
      .resize(maxEdge, maxEdge, { fit: "inside", withoutEnlargement: true })
      .toFormat(out.format);
    const { data, info } = await pipeline.toBuffer({ resolveWithObject: true });
    return { buffer: data, width: info.width, height: info.height, mime: out.mime };
  };

  const [full, thumb] = await Promise.all([
    encode(FULL_MAX_EDGE),
    encode(THUMB_MAX_EDGE),
  ]);

  return { full, thumb, original: orientedSize(meta, full) };
}

/** The source's visible dimensions. `metadata()` reports what is stored in the file, before the
 * `.rotate()` in the pipeline is applied, so a quarter-turn EXIF orientation has them the wrong way
 * round — the same normalisation the derivatives get from `.rotate()`, done by hand. A source that
 * reports no dimensions at all falls back to the given derivative's, which reads as "never
 * downscaled" and so leaves the collage's scaling exactly where it is today.
 *
 * Exported because a scan sheet (#566) needs the same answer for a different reason: its recorded
 * size is the coordinate space every cut box lives in, so a sheet measured unrotated would put
 * every box on the card wrong. */
export function orientedSize(
  meta: Metadata,
  fallback: { width: number; height: number }
): { width: number; height: number } {
  if (!meta.width || !meta.height) return { width: fallback.width, height: fallback.height };
  const quarterTurned = meta.orientation != null && meta.orientation >= 5;
  return quarterTurned
    ? { width: meta.height, height: meta.width }
    : { width: meta.width, height: meta.height };
}

/**
 * Thumbnail an image the app itself produced — a rendered offer collage (#311). Distinct from
 * `processImage`, which also re-encodes the `full` derivative: a collage's `full` bytes are the
 * renderer's own output, already sized and encoded to the platform's limits (#310), so re-encoding
 * them would undo that work. Only the `thumb` is derived here, at the same `THUMB_MAX_EDGE` as
 * uploads so display code cannot tell the two apart.
 */
export async function thumbnailFor(
  input: Buffer,
  mime: AcceptedMime
): Promise<ProcessedVariant> {
  const { data, info } = await sharp(input, { failOn: "error" })
    .resize(THUMB_MAX_EDGE, THUMB_MAX_EDGE, { fit: "inside", withoutEnlargement: true })
    .toFormat(OUTPUT[mime].format)
    .toBuffer({ resolveWithObject: true });
  return { buffer: data, width: info.width, height: info.height, mime: OUTPUT[mime].mime };
}
