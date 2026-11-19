import sharp, { type OverlayOptions } from "sharp";
import { DEFAULT_PHOTO_COVER_COLOR, type PhotoCover } from "../photo-cover-rules";
import { blurSigma, coverPixelBox, pixelateGrid, type PixelBox } from "../photo-cover-render";

// Drawing a photo's covers into its pixels (#1665; ADR-0066) — for an offer image only. The bytes
// handed in are a copy's stored `full` derivative and are never written back: what comes out is fed
// straight to the collage renderer, so the copy's and the stamp's own photo stay as they were.
//
// The blocks and the blur strength are `photo-cover-render.ts`'s, which the editor draws with too, so
// what is drawn on screen is what comes out here (#2586).

interface Raw {
  data: Buffer;
  width: number;
  height: number;
  channels: 1 | 2 | 3 | 4;
}

async function coveredRegion(
  image: Raw,
  cover: PhotoCover,
  box: PixelBox
): Promise<Buffer> {
  const raw = { width: image.width, height: image.height, channels: image.channels };
  if (cover.style === "bar") {
    return sharp({
      // The bar's own colour (#1702); one stored before bars had a colour was black.
      create: { width: box.width, height: box.height, channels: 3, background: cover.color ?? DEFAULT_PHOTO_COVER_COLOR },
    })
      .png()
      .toBuffer();
  }
  const region = await sharp(image.data, { raw }).extract(box).png().toBuffer();
  if (cover.style === "blur") {
    return sharp(region)
      .blur(blurSigma(box))
      .png()
      .toBuffer();
  }
  // Pixelate: average down to a handful of blocks, then blow them back up without smoothing.
  const { columns, rows } = pixelateGrid(box);
  const small = await sharp(region)
    .resize(columns, rows, { fit: "fill" })
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
    const box = coverPixelBox(cover, image.width, image.height);
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
