import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  arrangeFacebookLotPhoto,
  lotPhotoSeparatorColor,
  type LotPhotoCollage,
  type LotPhotoImage,
} from "../../src/lib/facebook-lot-photo-rules";

// A lot's one photo in a captioned Facebook post (#1841): its only image as it is, or its images
// joined — fronts and backs as two halves of one grid, a separator between them, side by side or
// stacked toward the offer's collage shape. The pixels are `facebook-lot-photos.ts`'.

const auto = (gridShape: LotPhotoCollage["gridShape"]): LotPhotoCollage => ({
  gridMode: "auto",
  gridShape,
  columns: 4,
  gapPercent: 0,
});

const img = (side: string | null, pairKey: string | null, width = 300, height = 100): LotPhotoImage => ({
  side,
  pairKey,
  width,
  height,
});

describe("arrangeFacebookLotPhoto (#1841)", () => {
  it("uses a lot that already is one photo as it is", () => {
    assert.deepEqual(arrangeFacebookLotPhoto([img("front", "g1")], auto("landscape")), { kind: "asIs", image: 0 });
    assert.equal(arrangeFacebookLotPhoto([], auto("landscape")), null);
  });

  it("joins a front and its back with a separator, toward the collage's shape", () => {
    // A 3:2 front/back pair: side by side is 3:1, stacked 3:4 — square takes stacked, landscape
    // side by side.
    const images = [img("front", "g1", 300, 200), img("back", "g1", 300, 200)];
    const square = arrangeFacebookLotPhoto(images, auto("square"));
    assert.equal(square?.kind, "joined");
    if (square?.kind !== "joined") return;
    assert.equal(square.direction, "stacked");
    assert.ok(square.separator && square.separator.height < square.separator.width);
    const landscape = arrangeFacebookLotPhoto(images, auto("landscape"));
    assert.equal(landscape?.kind === "joined" && landscape.direction, "sideBySide");
    // A 1:3 pair stacked would be 1:6; side by side, 2:3, is inside the portrait band.
    const tall = [img("front", "g1", 100, 300), img("back", "g1", 100, 300)];
    const portrait = arrangeFacebookLotPhoto(tall, auto("portrait"));
    assert.equal(portrait?.kind === "joined" && portrait.direction, "sideBySide");
    // A 2:1 pair: stacked is 1:1, side by side 4:1 — portrait comes closest stacked.
    const wide = [img("front", "g1", 200, 100), img("back", "g1", 200, 100)];
    const upright = arrangeFacebookLotPhoto(wide, auto("portrait"));
    assert.equal(upright?.kind === "joined" && upright.direction, "stacked");
  });

  it("puts each back where its front is in the other half", () => {
    const images = [
      img("front", "g1"),
      img("back", "g1"),
      img("front", "g2", 200, 100),
      img("back", "g2", 200, 100),
    ];
    const out = arrangeFacebookLotPhoto(images, { ...auto("square"), gapPercent: 10 });
    assert.ok(out?.kind === "joined");
    if (out?.kind !== "joined") return;
    const at = new Map(out.placements.map((p) => [p.image, p]));
    const dx = at.get(1)!.x - at.get(0)!.x;
    const dy = at.get(1)!.y - at.get(0)!.y;
    // The same offset carries every front onto its back: one grid, two halves.
    assert.equal(at.get(3)!.x - at.get(2)!.x, dx);
    assert.equal(at.get(3)!.y - at.get(2)!.y, dy);
    assert.ok(dx > 0 || dy > 0);
  });

  it("has one half and no separator when the lot photographs fronts only", () => {
    const out = arrangeFacebookLotPhoto([img("front", "g1"), img("front", "g2"), img(null, null)], auto("landscape"));
    assert.ok(out?.kind === "joined");
    if (out?.kind !== "joined") return;
    assert.equal(out.direction, null);
    assert.equal(out.separator, null);
    assert.equal(out.placements.length, 3);
  });

  it("keeps the offer's own column count on a fixed grid, and aims at square", () => {
    const images = [img("front", "a"), img("front", "b"), img("front", "c")];
    const out = arrangeFacebookLotPhoto(images, { gridMode: "fixed", gridShape: "landscape", columns: 1, gapPercent: 0 });
    assert.ok(out?.kind === "joined");
    if (out?.kind !== "joined") return;
    assert.equal(out.columns, 1);
    assert.equal(out.width, 300);
    assert.equal(out.height, 300);
  });

  it("keeps a back whose front is held back as a photo of its own", () => {
    const out = arrangeFacebookLotPhoto([img("front", "a"), img("back", "b")], auto("landscape"));
    assert.ok(out?.kind === "joined");
    if (out?.kind !== "joined") return;
    assert.equal(out.direction, null);
    assert.deepEqual(out.placements.map((p) => p.image).sort(), [0, 1]);
  });
});

describe("lotPhotoSeparatorColor (#1841)", () => {
  it("leans away from the background", () => {
    assert.equal(lotPhotoSeparatorColor("#000000"), "#a6a6a6");
    assert.equal(lotPhotoSeparatorColor("#ffffff"), "#595959");
  });
});
