import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { cutSheet, extractSheetRegion } from "../../src/lib/photos/sheet";

/** A card with one distinctly coloured patch on it, so a crop can be checked by its colour rather
 * than by trusting the numbers that produced it. */
async function cardWithPatch(): Promise<Buffer> {
  const patch = await sharp({
    create: { width: 80, height: 60, channels: 3, background: { r: 220, g: 30, b: 30 } },
  })
    .png()
    .toBuffer();
  return sharp({
    create: { width: 400, height: 200, channels: 3, background: { r: 20, g: 20, b: 20 } },
  })
    .composite([{ input: patch, left: 100, top: 50 }])
    .png()
    .toBuffer();
}

const PATCH = { x: 100, y: 50, w: 80, h: 60 };

describe("extractSheetRegion", () => {
  it("returns the region asked for, at the width asked for", async () => {
    const region = await extractSheetRegion(await cardWithPatch(), PATCH, 40);
    assert.equal(region.width, 40);
    assert.equal(region.height, 30);
    // The patch's colour and nothing of the near-black card around it. `dominant` is binned, so it
    // is compared loosely — the point is *which* part of the card came back, not its exact value.
    const { dominant } = await sharp(region.buffer).stats();
    assert.ok(dominant.r > 200 && dominant.g < 60 && dominant.b < 60, JSON.stringify(dominant));
  });

  it("does not enlarge — a request for more pixels than the original holds is capped by it", async () => {
    const region = await extractSheetRegion(await cardWithPatch(), PATCH, 4000);
    assert.equal(region.width, PATCH.w);
    assert.equal(region.height, PATCH.h);
  });

  it("is the same pixels the cut itself would take", async () => {
    // The point of serving detail from the original: what the collector zooms into has to be what
    // `extract` will hand `processImage` when the cut is committed, not a near neighbour of it.
    const card = await cardWithPatch();
    const [region, crops] = await Promise.all([
      extractSheetRegion(card, PATCH, PATCH.w),
      cutSheet(card, [PATCH]),
    ]);
    assert.deepEqual(crops[0].original, { width: PATCH.w, height: PATCH.h });
    const [a, b] = await Promise.all([
      sharp(region.buffer).raw().toBuffer(),
      // The crop's `full` derivative: PNG and well under the pipeline's cap, so it is these very
      // pixels re-encoded losslessly rather than a resample of them.
      sharp(crops[0].full.buffer).raw().toBuffer(),
    ]);
    assert.deepEqual(a, b);
  });
});
