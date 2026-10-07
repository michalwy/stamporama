import sharp, { type OverlayOptions } from "sharp";
import type { PhotoCover } from "../photo-cover-rules";

// Drawing a photo's covers into its pixels (#1665; ADR-0066) — for an offer image only. The bytes
// handed in are a copy's stored `full` derivative and are never written back: what comes out is fed
// straight to the collage renderer, so the copy's and the stamp's own photo stay as they were.

/** How many blocks a pixelated cover is across its shorter side. Few enough that a portrait or a
 *  symbol cannot be read back out of it, many enough that it still reads as a covered stamp. */
const PIXELATE_BLOCKS = 6;

/** A blur's strength as a share of the cover's shorter side — strong enough to leave only colour. */
const BLUR_SIGMA_SHARE = 0.2;

const BAR_COLOR = "#000000";

interface Raw {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

/** The cover's box in pixels, clipped to the image and never empty. */
function pixelBox(cover: PhotoCover, width: number, height: number) {
  const left = Math.min(width - 1, Math.max(0, Math.floor(cover.x * width)));
  const top = Math.min(height - 1, Math.max(0, Math.floor(cover.y * height)));
  const right = Math.min(width, Math.max(left + 1, Math.ceil((cover.x + cover.width) * width)));
  const bottom = Math.min(height, Math.max(top + 1, Math.ceil((cover.y + cover.height) * height)));
  return { left, top, width: right - left, height: bottom - top };
}

async function coveredRegion(
  image: Raw,
  cover: PhotoCover,
  box: { left: number; top: number; width: number; height: number }
): Promise<Buffer> {
  const raw = { width: image.width, height: image.height, channels: image.channels };
  if (cover.style === "bar") {
    return sharp({
      create: { width: box.width, height: box.height, channels: 3, background: BAR_COLOR },
    })
      .png()
      .toBuffer();
  }
  const region = await sharp(image.data, { raw }).extract(box).png().toBuffer();
  const shorter = Math.min(box.width, box.height);
  if (cover.style === "blur") {
    return sharp(region)
      .blur(Math.max(1, shorter * BLUR_SIGMA_SHARE))
      .png()
      .toBuffer();
  }
  // Pixelate: average down to a handful of blocks, then blow them back up without smoothing.
  const block = Math.max(1, Math.ceil(shorter / PIXELATE_BLOCKS));
  const small = await sharp(region)
    .resize(Math.max(1, Math.ceil(box.width / block)), Math.max(1, Math.ceil(box.height / block)), {
      fit: "fill",
    })
    .png()
    .toBuffer();
  return sharp(small)
    .resize(box.width, box.height, { fit: "fill", kernel: "nearest" })
    .png()
    .toBuffer();
}

/** Cuts an ellipse out of a covered box: everything outside the ellipse inscribed in it becomes
 *  transparent, so the photo shows through at the corners. */
async function maskEllipse(region: Buffer, width: number, height: number): Promise<Buffer> {
  const svg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">` +
      `<ellipse cx="${width / 2}" cy="${height / 2}" rx="${width / 2}" ry="${height / 2}" fill="#fff"/></svg>`
  );
  return sharp(region)
    .ensureAlpha()
    .composite([{ input: svg, blend: "dest-in" }])
    .png()
    .toBuffer();
}

/**
 * The photo with its covers drawn in, losslessly encoded, at the photo's own size. Returns the input
 * untouched when there is nothing to cover, so a photo without covers renders exactly as it always
 * did.
 */
export async function applyPhotoCovers(
  buffer: Buffer,
  covers: readonly PhotoCover[]
): Promise<Buffer> {
  if (covers.length === 0) return buffer;
  const { data, info } = await sharp(buffer, { failOn: "error" })
    .rotate()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const image: Raw = { data, width: info.width, height: info.height, channels: info.channels };

  const overlays: OverlayOptions[] = [];
  for (const cover of covers) {
    const box = pixelBox(cover, image.width, image.height);
    let region = await coveredRegion(image, cover, box);
    if (cover.shape === "ellipse") region = await maskEllipse(region, box.width, box.height);
    overlays.push({ input: region, left: box.left, top: box.top });
  }
  return sharp(image.data, {
    raw: { width: image.width, height: image.height, channels: image.channels },
  })
    .composite(overlays)
    .png({ compressionLevel: 1 })
    .toBuffer();
}
