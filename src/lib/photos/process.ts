import sharp from "sharp";

// `sharp` image processing for photo uploads (#112). On upload, in a single decode, the
// original is downscaled to the full-size derivative and a thumbnail is generated. Both are
// written eagerly at upload time so the serving route stays a dumb byte stream.

/** Longest-edge cap for the stored full-size derivative. */
export const FULL_MAX_EDGE = 2500;
/** Longest-edge cap for the thumbnail used in slot/list display. Changing this later requires
 * a one-off backfill script to regenerate existing thumbnails. */
export const THUMB_MAX_EDGE = 320;

/** Max accepted upload size (bytes). ~15 MB default, adjustable. */
export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

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
 * dimensions/mime) and its `thumb`. */
export interface ProcessedImage {
  full: ProcessedVariant;
  thumb: ProcessedVariant;
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

  return { full, thumb };
}
