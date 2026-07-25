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

// 10% and 20% of the stamp: with the 100-tall tiles below that is a 10 px gap and a 20 px strip.
const style = { columns: 2, gapPercent: 10, labelPercent: 20, background: "#ffffff" };

const noLimits = { maxEdge: null, maxBytes: null };

describe("renderCollage", () => {
  it("renders a single stamp as a 1×1 collage", async () => {
    const rendered = await renderCollage([await scan(100, 140)], style, noLimits);

    assert.equal(rendered.mime, COLLAGE_MIME);
    assert.equal(rendered.quality, COLLAGE_QUALITY_MAX);
    // One 140-tall stamp: gap 14, strip 28.
    assert.equal(rendered.width, 100 + 14 * 2);
    assert.equal(rendered.height, 140 + 28 + 14 * 2);
    assert.equal(rendered.layout.rowCount, 1);
    assert.equal(rendered.exceedsFileSizeLimit, false);

    const meta = await sharp(rendered.buffer).metadata();
    assert.equal(meta.format, "jpeg");
    assert.equal(meta.width, 128);
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
    // The layout still reports native geometry: a 300-tall stamp gives a 30 px gap.
    assert.equal(capped.layout.width, 600 + 30 * 2);

    const small = await renderCollage([await scan(60, 40)], style, {
      maxEdge: 4000,
      maxBytes: null,
    });
    assert.equal(small.width, 60 + 4 * 2);
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
    assert.equal(rendered.width, 400 + 40 * 2);
  });

  it("draws each tile's labels on the strip below it, and nothing on an unlabelled one", async () => {
    // Needs a font on the host to draw anything at all — the app image installs DejaVu Sans (#312).
    const rendered = await renderCollage(
      [
        { ...(await scan(100, 100)), labels: { left: "A234", right: "Mi 200" } },
        { ...(await scan(100, 100)), labels: null },
      ],
      { ...style, background: "#ffffff", labelPercent: 30 },
      noLimits
    );

    const ink = async (tile: (typeof rendered.layout.tiles)[number]) => {
      const data = await sharp(rendered.buffer)
        .extract({
          left: tile.label.x,
          top: tile.label.y,
          width: tile.label.width,
          height: tile.label.height,
        })
        .raw()
        .toBuffer();
      let dark = 0;
      for (let i = 0; i < data.length; i += 3) if (data[i] < 128) dark += 1;
      return dark;
    };

    assert.ok((await ink(rendered.layout.tiles[0])) > 20, "the labelled tile's strip has no text");
    assert.equal(await ink(rendered.layout.tiles[1]), 0);
  });

  it("rejects an empty collage", async () => {
    await assert.rejects(() => renderCollage([], style, noLimits), EmptyCollageError);
  });
});
