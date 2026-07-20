import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  processImage,
  isAcceptedMime,
  UnsupportedImageError,
  THUMB_MAX_EDGE,
  FULL_MAX_EDGE,
} from "../../src/lib/photos/process";

async function makeImage(
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp"
): Promise<Buffer> {
  return sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 120, g: 80, b: 40 },
    },
  })
    .toFormat(format)
    .toBuffer();
}

describe("isAcceptedMime", () => {
  it("accepts jpeg/png/webp and rejects others", () => {
    assert.ok(isAcceptedMime("image/jpeg"));
    assert.ok(isAcceptedMime("image/png"));
    assert.ok(isAcceptedMime("image/webp"));
    assert.ok(!isAcceptedMime("image/gif"));
    assert.ok(!isAcceptedMime("application/pdf"));
  });
});

describe("processImage", () => {
  it("downscales a large original to the full cap and generates a thumbnail", async () => {
    const input = await makeImage(4000, 3000, "jpeg");
    const { full, thumb } = await processImage(input, "image/jpeg");

    assert.equal(full.mime, "image/jpeg");
    assert.equal(Math.max(full.width, full.height), FULL_MAX_EDGE);
    assert.equal(full.width, FULL_MAX_EDGE); // landscape → width is the long edge

    assert.equal(Math.max(thumb.width, thumb.height), THUMB_MAX_EDGE);
    assert.ok(thumb.buffer.byteLength < full.buffer.byteLength);
  });

  it("does not enlarge a small original", async () => {
    const input = await makeImage(120, 90, "png");
    const { full, thumb } = await processImage(input, "image/png");
    assert.equal(full.width, 120);
    assert.equal(full.height, 90);
    assert.equal(full.mime, "image/png");
    // Thumb also stays within the original bounds.
    assert.ok(thumb.width <= 120 && thumb.height <= 90);
  });

  it("preserves the source format for webp", async () => {
    const input = await makeImage(800, 600, "webp");
    const { full, thumb } = await processImage(input, "image/webp");
    assert.equal(full.mime, "image/webp");
    assert.equal(thumb.mime, "image/webp");
  });

  it("rejects an unsupported declared mime", async () => {
    const input = await makeImage(100, 100, "png");
    await assert.rejects(
      processImage(input, "image/gif"),
      UnsupportedImageError
    );
  });

  it("rejects bytes that are not a valid image", async () => {
    await assert.rejects(
      processImage(Buffer.from("not an image"), "image/png")
    );
  });
});
