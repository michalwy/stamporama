import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { DEFAULT_PHOTO_COVER_STRENGTH, type PhotoCover } from "../../src/lib/photo-cover-rules";
import {
  averageDown,
  blurSigma,
  BLUR_SIGMA_SHARE_BY_STRENGTH,
  BLUR_WORK_SIDE,
  coverPixelBox,
  gaussianBlur,
  gaussianKernel,
  paintCover,
  pixelateGrid,
  PIXELATE_BLOCKS_BY_STRENGTH,
  type Rgba,
} from "../../src/lib/photo-cover-render";
import { applyPhotoCovers } from "../../src/lib/photos/covers";

// The screen draws a cover with the numbers the server draws it with (#2586): these compare what the
// editor would paint with what `applyPhotoCovers` actually puts on an offer image.

const D = DEFAULT_PHOTO_COVER_STRENGTH;

const W = 160;
const H = 120;

/** A photo with detail to cover: smooth gradients under a dark cross and a light disc. */
function photoPixels(): Rgba {
  const data = new Uint8ClampedArray(W * H * 4);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const o = (y * W + x) * 4;
      const cross = Math.abs(x - 80) < 4 || Math.abs(y - 60) < 4;
      const disc = (x - 60) ** 2 + (y - 45) ** 2 < 15 ** 2;
      data[o] = cross ? 20 : disc ? 240 : (x * 255) / W;
      data[o + 1] = cross ? 20 : disc ? 230 : (y * 255) / H;
      data[o + 2] = cross ? 40 : disc ? 200 : 128;
      data[o + 3] = 255;
    }
  }
  return { data, width: W, height: H };
}

async function serverCovered(cover: PhotoCover): Promise<Rgba> {
  const src = photoPixels();
  const png = await sharp(Buffer.from(src.data), { raw: { width: W, height: H, channels: 4 } }).png().toBuffer();
  const out = await sharp(await applyPhotoCovers(png, [cover]))
    .ensureAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data: new Uint8ClampedArray(out.data), width: out.info.width, height: out.info.height };
}

function crop(img: Rgba, box: { left: number; top: number; width: number; height: number }): Rgba {
  const data = new Uint8ClampedArray(box.width * box.height * 4);
  for (let y = 0; y < box.height; y++) {
    const from = ((box.top + y) * img.width + box.left) * 4;
    data.set(img.data.subarray(from, from + box.width * 4), y * box.width * 4);
  }
  return { data, width: box.width, height: box.height };
}

/** The biggest difference in any channel between two pixels' colours. */
function diff(a: Uint8ClampedArray, ai: number, b: Uint8ClampedArray, bi: number): number {
  return Math.max(Math.abs(a[ai] - b[bi]), Math.abs(a[ai + 1] - b[bi + 1]), Math.abs(a[ai + 2] - b[bi + 2]));
}

const cover = (over: Partial<PhotoCover>): PhotoCover => ({
  shape: "rect",
  style: "pixelate",
  x: 0.25,
  y: 0.25,
  width: 0.3,
  height: 0.3,
  ...over,
});

describe("a cover painted on screen (#2586)", () => {
  it("pixelates into the server's blocks, each the colour the server gives it", async () => {
    // 48 × 36 px: six rows of six-pixel blocks, eight across.
    const c = cover({ x: 40 / W, y: 30 / H, width: 48 / W, height: 36 / H });
    const box = coverPixelBox(c, W, H);
    assert.deepEqual(box, { left: 40, top: 30, width: 48, height: 36 });
    assert.deepEqual(pixelateGrid(box, D), { columns: 8, rows: 6 });

    const painted = paintCover("pixelate", crop(photoPixels(), box), box, D);
    assert.equal(painted.width, 8);
    assert.equal(painted.height, 6);

    const server = crop(await serverCovered(c), box);
    let total = 0;
    for (let y = 0; y < box.height; y++) {
      for (let x = 0; x < box.width; x++) {
        const at = (y * box.width + x) * 4;
        // The same blocks: every pixel of the server's is the colour of its block's corner.
        const corner = ((y - (y % 6)) * box.width + (x - (x % 6))) * 4;
        assert.equal(diff(server.data, at, server.data, corner), 0, `the server's block breaks at ${x},${y}`);
        total += diff(server.data, at, painted.data, (Math.floor(y / 6) * 8 + Math.floor(x / 6)) * 4);
      }
    }
    // The server averages with sharp's Lanczos resampler, which overshoots a little at hard edges, the
    // screen with a plain mean: a shade apart on the whole, even over this hard-edged cross.
    const mean = total / (box.width * box.height);
    assert.ok(mean <= 10, `the blocks are ${mean.toFixed(1)} levels off the server's on average`);
  });

  it("blurs as strongly as the server does", async () => {
    const c = cover({ style: "blur", x: 40 / W, y: 30 / H, width: 50 / W, height: 40 / H });
    const box = coverPixelBox(c, W, H);
    // Small enough to be worked at its own size, so every pixel can be compared.
    assert.ok(Math.min(box.width, box.height) <= BLUR_WORK_SIDE);
    const painted = paintCover("blur", crop(photoPixels(), box), box, D);
    assert.equal(painted.width, box.width);

    const server = crop(await serverCovered(c), box);
    let worst = 0;
    for (let i = 0; i < box.width * box.height * 4; i += 4) worst = Math.max(worst, diff(server.data, i, painted.data, i));
    assert.ok(worst <= 6, `the blur is ${worst} levels off the server's`);
  });

  it("works a large blur at a small size without changing its strength", () => {
    const flat: Rgba = { data: new Uint8ClampedArray(400 * 300 * 4).fill(100), width: 400, height: 300 };
    const painted = paintCover("blur", flat, { width: 400, height: 300 }, D);
    assert.equal(Math.min(painted.width, painted.height), BLUR_WORK_SIDE);
    assert.equal(painted.data[0], 100);
  });

  it("shows a blur and a pixelation over the same area as clearly different", () => {
    const box = { left: 30, top: 20, width: 60, height: 60 };
    const region = crop(photoPixels(), box);
    const blocks = paintCover("pixelate", region, box, D);
    const blur = paintCover("blur", region, box, D);
    assert.equal(blocks.width, 6);
    assert.equal(blur.width, 60);
  });
});

/** How far apart a picture's pixels are: the mean distance of each channel from its average. */
function spread(img: Rgba): number {
  const n = img.width * img.height;
  let total = 0;
  for (let c = 0; c < 3; c++) {
    let mean = 0;
    for (let i = 0; i < n; i++) mean += img.data[i * 4 + c];
    mean /= n;
    for (let i = 0; i < n; i++) total += Math.abs(img.data[i * 4 + c] - mean);
  }
  return total / (n * 3);
}

describe("a cover's strength (#2587)", () => {
  const strengths = Array.from(PIXELATE_BLOCKS_BY_STRENGTH, (_, i) => i + 1);

  it("is today's six blocks and fifth-of-a-side blur at the default step", () => {
    assert.equal(PIXELATE_BLOCKS_BY_STRENGTH[D - 1], 6);
    assert.equal(BLUR_SIGMA_SHARE_BY_STRENGTH[D - 1], 0.2);
    assert.equal(blurSigma({ width: 100, height: 50 }, D), 10);
    assert.equal(BLUR_SIGMA_SHARE_BY_STRENGTH.length, PIXELATE_BLOCKS_BY_STRENGTH.length);
  });

  it("breaks a pixelation into fewer, larger blocks at each step up, down to two across", () => {
    const box = { width: 120, height: 96 };
    const across = strengths.map((s) => pixelateGrid(box, s).rows);
    for (let i = 1; i < across.length; i++) assert.ok(across[i] < across[i - 1], `step ${i + 1}: ${across}`);
    assert.equal(across.at(-1), 2);
  });

  it("blurs harder at each step up, and the last leaves one plain colour", () => {
    const box = { left: 30, top: 20, width: 60, height: 60 };
    const region = crop(photoPixels(), box);
    const spreads = strengths.map((s) => spread(paintCover("blur", region, box, s)));
    for (let i = 1; i < spreads.length; i++) assert.ok(spreads[i] < spreads[i - 1], `step ${i + 1}: ${spreads}`);
    const plain = paintCover("blur", region, box, strengths.length);
    assert.equal(plain.width * plain.height, 1);
    assert.deepEqual([...plain.data], [...averageDown(region, 1, 1).data]);
  });

  it("reads an unknown step as the default rather than drawing nothing", () => {
    assert.deepEqual(pixelateGrid({ width: 60, height: 60 }, 99), pixelateGrid({ width: 60, height: 60 }, D));
  });

  it("comes out on the server as the screen draws it, at every step", async () => {
    const c = cover({ x: 40 / W, y: 30 / H, width: 48 / W, height: 36 / H });
    const box = coverPixelBox(c, W, H);
    const region = crop(photoPixels(), box);
    for (const strength of strengths) {
      // Pixelation: the server's blocks are the screen's grid.
      const { columns, rows } = pixelateGrid(box, strength);
      const server = crop(await serverCovered({ ...c, strength }), box);
      const painted = paintCover("pixelate", region, box, strength);
      assert.equal(painted.width, columns);
      assert.equal(painted.height, rows);
      const blockW = box.width / columns;
      const blockH = box.height / rows;
      let total = 0;
      for (let y = 0; y < box.height; y++) {
        for (let x = 0; x < box.width; x++) {
          const at = (y * box.width + x) * 4;
          total += diff(server.data, at, painted.data, (Math.floor(y / blockH) * columns + Math.floor(x / blockW)) * 4);
        }
      }
      const mean = total / (box.width * box.height);
      // Sharp's Lanczos against the screen's plain mean, over the hard-edged cross: larger blocks take
      // in more of its edges, so a few levels more apart than the default step, still a shade.
      assert.ok(mean <= 12, `pixelate ${strength}: ${mean.toFixed(1)} levels off the server's on average`);

      // Blur, worked at the box's own size here, so every pixel can be compared.
      const blurServer = crop(await serverCovered({ ...c, style: "blur", strength }), box);
      const blurred = paintCover("blur", region, box, strength);
      let worst = 0;
      for (let y = 0; y < box.height; y++) {
        for (let x = 0; x < box.width; x++) {
          const px = Math.min(blurred.width - 1, Math.floor((x * blurred.width) / box.width));
          const py = Math.min(blurred.height - 1, Math.floor((y * blurred.height) / box.height));
          worst = Math.max(worst, diff(blurServer.data, (y * box.width + x) * 4, blurred.data, (py * blurred.width + px) * 4));
        }
      }
      assert.ok(worst <= 6, `blur ${strength}: ${worst} levels off the server's`);
    }
  });
});

describe("the screen's resampling and blur", () => {
  it("averages each target pixel over the area it covers", () => {
    const src: Rgba = { data: new Uint8ClampedArray([0, 0, 0, 255, 200, 100, 50, 255]), width: 2, height: 1 };
    const out = averageDown(src, 1, 1);
    assert.deepEqual([...out.data], [100, 50, 25, 255]);
  });

  it("cuts the Gaussian's mask where sharp does and keeps it summing to one", () => {
    const kernel = gaussianKernel(10);
    // exp(-r² / 200) ≥ 0.2 holds up to r = 17.
    assert.equal(kernel.length, 35);
    assert.ok(Math.abs(kernel.reduce((s, v) => s + v, 0) - 1) < 1e-5);
  });

  it("leaves a flat colour as it is, edges included", () => {
    const flat: Rgba = { data: new Uint8ClampedArray(10 * 10 * 4).fill(77), width: 10, height: 10 };
    const out = gaussianBlur(flat, 3);
    assert.ok(out.data.every((v) => v === 77));
  });
});
