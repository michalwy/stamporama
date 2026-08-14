import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tileSideViews, type TileSheetRef, type TileViewSource } from "../../src/lib/scan-tile-view";

// A batch as it is on screen: two scans of one stockbook card, and a tile cut from both.
const FRONT_SHEET: TileSheetRef = { id: "sheet-front", purged: false };
const BACK_SHEET: TileSheetRef = { id: "sheet-back", purged: false };
const SHEETS = { front: FRONT_SHEET, back: BACK_SHEET };

const TILE: TileViewSource = {
  position: 3,
  frontPhotoId: "photo-front",
  backPhotoId: "photo-back",
  frontBox: { x: 1200, y: 800, w: 1400, h: 1600 },
  backBox: { x: 4100, y: 810, w: 1390, h: 1610 },
  item: null,
};

describe("tileSideViews", () => {
  it("shows both sides, each pointing at its own scan and its own crop", () => {
    const sides = tileSideViews(TILE, SHEETS);
    assert.deepEqual(
      sides.map((s) => [s.side, s.photoId, s.sheetId]),
      [
        ["front", "photo-front", "sheet-front"],
        ["back", "photo-back", "sheet-back"],
      ]
    );
    // The crop is the region route's own coordinate space, so it travels untouched.
    assert.deepEqual(sides[0].box, TILE.frontBox);
    assert.deepEqual(sides[1].box, TILE.backBox);
  });

  it("is one side for a tile with only a front", () => {
    const sides = tileSideViews({ ...TILE, backPhotoId: null, backBox: null }, SHEETS);
    assert.deepEqual(sides.map((s) => s.side), ["front"]);
  });

  it("is one side for an unmatched back", () => {
    const sides = tileSideViews({ ...TILE, frontPhotoId: null, frontBox: null }, SHEETS);
    assert.deepEqual(sides.map((s) => s.side), ["back"]);
    assert.equal(sides[0].sheetId, "sheet-back");
  });
});

// The case #578 made reachable, and the one that would otherwise first run in production: the
// batch was worked through, the retention sweep took the scans' bytes, and both scan routes now
// answer 404 deliberately. The dialog must fall back to the tile's own photo rather than fail.
describe("tileSideViews, once the scans have been swept (#578)", () => {
  it("still shows the tile, with no deeper source to escalate to", () => {
    const sides = tileSideViews(TILE, {
      front: { id: "sheet-front", purged: true },
      back: { id: "sheet-back", purged: true },
    });
    assert.deepEqual(sides.map((s) => s.photoId), ["photo-front", "photo-back"]);
    assert.deepEqual(sides.map((s) => s.sheetId), [null, null]);
    // The crop survives the sweep, because it is what the tile's own photo *is*: `1:1` still means
    // one screen pixel per scan pixel after the bytes behind it are gone.
    assert.deepEqual(sides[0].box, TILE.frontBox);
  });

  it("takes each side on its own — one sheet swept does not silence the other", () => {
    const sides = tileSideViews(TILE, {
      front: { id: "sheet-front", purged: true },
      back: BACK_SHEET,
    });
    assert.deepEqual(sides.map((s) => s.sheetId), [null, "sheet-back"]);
  });

  it("asks for nothing when the batch has no such sheet at all", () => {
    const sides = tileSideViews(TILE, { front: null, back: null });
    assert.deepEqual(sides.map((s) => s.sheetId), [null, null]);
  });
});

describe("tileSideViews, on a tile that has been worked through", () => {
  it("follows a consumed tile's images to the copy that owns them now", () => {
    const consumed: TileViewSource = {
      ...TILE,
      frontPhotoId: null,
      backPhotoId: null,
      item: { frontPhotoId: "photo-front", backPhotoId: "photo-back" },
    };
    const sides = tileSideViews(consumed, SHEETS);
    assert.deepEqual(sides.map((s) => s.photoId), ["photo-front", "photo-back"]);
    // …and does not escalate to the card: the copy's front can have been replaced since, and
    // nothing on the tile would say so. A sharp crop of the card over a photograph of something
    // else is the one failure this escalation must not have.
    assert.deepEqual(sides.map((s) => s.sheetId), [null, null]);
  });

  it("shows nothing for a consumed tile whose copy was deleted", () => {
    const sides = tileSideViews(
      { ...TILE, frontPhotoId: null, backPhotoId: null, item: null },
      SHEETS
    );
    assert.deepEqual(sides, []);
  });
});

describe("tileSideViews, without a recorded box", () => {
  it("shows the picture and asks the card for nothing", () => {
    const sides = tileSideViews({ ...TILE, frontBox: null, backPhotoId: null }, SHEETS);
    assert.equal(sides.length, 1);
    assert.equal(sides[0].box, null);
    // Nothing names which part of the card the photo is, so a region request could only be a crop
    // of somewhere else.
    assert.equal(sides[0].sheetId, null);
  });
});
