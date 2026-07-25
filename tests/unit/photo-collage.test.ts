import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  COLLAGE_MIME,
  COLLAGE_QUALITY_MAX,
  EmptyCollageError,
  renderCollage,
  type CollageTileSource,
} from "../../src/lib/photos/collage";

/** A flat-colour scan stand-in. Flat colours compress to almost nothing, so file-size tests use
 * `noise()` below instead. */
async function scan(width: number, height: number): Promise<CollageTileSource> {
  const buffer = await sharp({
    create: { width, height, channels: 3, background: { r: 20, g: 60, b: 200 } },
  })
    .jpeg()
    .toBuffer();
  return { buffer };
}

/** An incompressible scan: random pixels, so a byte limit actually bites. */
async function noise(width: number, height: number): Promise<CollageTileSource> {
  const pixels = Buffer.allocUnsafe(width * height * 3);
  for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 2654435761) % 251;
  const buffer = await sharp(pixels, { raw: { width, height, channels: 3 } })
    .jpeg({ quality: 100 })
    .toBuffer();
  return { buffer };
}

const style = { columns: 2, gap: 10, labelStripHeight: 20, background: "#ffffff" };

const noLimits = { maxEdge: null, maxBytes: null };

describe("renderCollage", () => {
  it("renders a single stamp as a 1×1 collage", async () => {
    const rendered = await renderCollage([await scan(100, 140)], style, noLimits);

    assert.equal(rendered.mime, COLLAGE_MIME);
    assert.equal(rendered.quality, COLLAGE_QUALITY_MAX);
    assert.equal(rendered.width, 120);
    assert.equal(rendered.height, 180);
    assert.equal(rendered.layout.rowCount, 1);
    assert.equal(rendered.exceedsFileSizeLimit, false);

    const meta = await sharp(rendered.buffer).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, 120);
  });

  it("preserves true relative sizes — a stamp twice as wide stays twice as wide", async () => {
    const rendered = await renderCollage([await scan(100, 100), await scan(200, 100)], style, noLimits);

    const [small, large] = rendered.layout.tiles;
    assert.equal(large.width, small.width * 2);
    // Canvas grew to hold both at native size; nothing was rescaled to a uniform cell.
    assert.equal(rendered.width, 100 + 10 + 200 + 10 * 2);
  });

  it("shrinks the canvas to the contents and stacks rows past the column count", async () => {
    const rendered = await renderCollage(
      [await scan(100, 100), await scan(100, 100), await scan(100, 100)],
      style,
      noLimits
    );

    assert.equal(rendered.layout.rowCount, 2);
    assert.equal(rendered.width, 100 + 10 + 100 + 10 * 2);
    assert.equal(rendered.height, 100 + 20 + 10 + 100 + 20 + 10 * 2);
  });

  it("paints the configured background between the tiles", async () => {
    const rendered = await renderCollage([await scan(40, 40)], { ...style, background: "#ff0000" }, noLimits);

    // Top-left corner is margin, so it is pure background.
    const { data } = await sharp(rendered.buffer)
      .extract({ left: 0, top: 0, width: 4, height: 4 })
      .raw()
      .toBuffer({ resolveWithObject: true });
    assert.ok(data[0] > 240 && data[1] < 15 && data[2] < 15, `corner was ${data.subarray(0, 3).join()}`);
  });

  it("fits the longest edge when the platform caps it, and never enlarges", async () => {
    const capped = await renderCollage([await scan(600, 300)], style, {
      maxEdge: 200,
      maxBytes: null,
    });
    assert.equal(Math.max(capped.width, capped.height), 200);
    assert.equal(capped.layout.width, 620); // the layout still reports native geometry

    const small = await renderCollage([await scan(60, 40)], style, {
      maxEdge: 4000,
      maxBytes: null,
    });
    assert.equal(small.width, 80);
  });

  it("drops quality until the encoded bytes fit the platform's file-size limit", async () => {
    const tiles = [await noise(700, 700), await noise(700, 700)];
    const unbounded = await renderCollage(tiles, style, noLimits);
    const maxBytes = Math.floor(unbounded.buffer.byteLength / 2);

    const fitted = await renderCollage(tiles, style, { maxEdge: null, maxBytes });

    assert.ok(fitted.buffer.byteLength <= maxBytes, `${fitted.buffer.byteLength} > ${maxBytes}`);
    assert.equal(fitted.exceedsFileSizeLimit, false);
    assert.ok(fitted.quality < COLLAGE_QUALITY_MAX);
    // Quality alone was enough; the canvas kept its full size.
    assert.equal(fitted.width, unbounded.width);
  });

  it("shrinks the canvas when even the lowest quality is too heavy", async () => {
    const tiles = [await noise(700, 700), await noise(700, 700)];
    const unbounded = await renderCollage(tiles, style, noLimits);
    const maxBytes = Math.floor(unbounded.buffer.byteLength / 12);

    const fitted = await renderCollage(tiles, style, { maxEdge: null, maxBytes });

    assert.ok(fitted.buffer.byteLength <= maxBytes, `${fitted.buffer.byteLength} > ${maxBytes}`);
    assert.equal(fitted.exceedsFileSizeLimit, false);
    assert.ok(fitted.width < unbounded.width);
  });

  it("reports its best effort rather than looping when the limit is unreachable", async () => {
    const fitted = await renderCollage([await noise(600, 600)], style, {
      maxEdge: null,
      maxBytes: 200,
    });

    assert.equal(fitted.exceedsFileSizeLimit, true);
    assert.ok(fitted.buffer.byteLength > 0);
  });

  it("skips each limit stage when the platform states none", async () => {
    const rendered = await renderCollage([await noise(400, 400)], style, noLimits);

    assert.equal(rendered.quality, COLLAGE_QUALITY_MAX);
    assert.equal(rendered.width, 420);
  });

  it("rejects an empty collage", async () => {
    await assert.rejects(() => renderCollage([], style, noLimits), EmptyCollageError);
  });
});
