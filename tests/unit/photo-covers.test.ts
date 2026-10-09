import { describe, it } from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import {
  carryAfterSave,
  cleanPhotoCovers,
  coverFingerprintRows,
  coverWalkPhotos,
  DEFAULT_PHOTO_COVER_COLOR,
  NO_CARRIED_COVERS,
  normalizeCoverColor,
  normalizePhotoCoverStyle,
  normalizePlatformCoverColor,
  offerNeedsCovers,
  PhotoCoverValidationError,
  proposedCovers,
  storedPhotoCover,
  type PhotoCover,
} from "../../src/lib/photo-cover-rules";
import { applyPhotoCovers } from "../../src/lib/photos/covers";
import { evaluateCoverReadiness, isCoverReadinessBlocker, isPhotoReadinessBlocker } from "../../src/lib/offer-photo-readiness";
import { fingerprintOfferPhotoInputs, type OfferPhotoFingerprintInput } from "../../src/lib/offer-photo-fingerprint";

// Covering symbols on offer photos (#1665): the pure rules, the renderer on real pixels, and the
// two places the feature reaches into the photo plan — its fingerprint and the ready gate.

/** A cover as stored: a bar carries its colour (black unless said), any other style none. */
const rect = (over: Partial<PhotoCover> = {}): PhotoCover => {
  const cover: PhotoCover = { shape: "rect", style: "bar", x: 0.25, y: 0.25, width: 0.5, height: 0.5, ...over };
  return cover.style === "bar" ? { color: DEFAULT_PHOTO_COVER_COLOR, ...cover } : cover;
};

describe("cleanPhotoCovers", () => {
  it("keeps a usable cover as it was sent", () => {
    assert.deepEqual(cleanPhotoCovers([rect()]), [rect()]);
  });

  it("clips a cover running off the photo to the photo", () => {
    const [cover] = cleanPhotoCovers([rect({ x: -0.1, y: 0.8, width: 0.4, height: 0.5 })]);
    assert.equal(cover.x, 0);
    assert.ok(Math.abs(cover.width - 0.3) < 1e-9);
    assert.equal(cover.y, 0.8);
    assert.ok(Math.abs(cover.height - 0.2) < 1e-9);
  });

  it("refuses rather than drops a cover left too small — a symbol believed hidden must not show", () => {
    assert.throws(() => cleanPhotoCovers([rect({ x: 1.2 })]), PhotoCoverValidationError);
    assert.throws(() => cleanPhotoCovers([rect({ width: 0.001 })]), PhotoCoverValidationError);
  });

  it("refuses an unknown shape or style and anything that is not a list", () => {
    assert.throws(() => cleanPhotoCovers([{ ...rect(), shape: "star" }]), PhotoCoverValidationError);
    assert.throws(() => cleanPhotoCovers([{ ...rect(), style: "emoji" }]), PhotoCoverValidationError);
    assert.throws(() => cleanPhotoCovers({}), PhotoCoverValidationError);
    assert.throws(() => cleanPhotoCovers([{ ...rect(), x: "0.1" }]), PhotoCoverValidationError);
  });

  it("accepts an empty list — nothing to cover is a decision too", () => {
    assert.deepEqual(cleanPhotoCovers([]), []);
  });
});

describe("a solid cover's colour (#1702)", () => {
  it("is kept on a bar, written the one way it is stored", () => {
    assert.equal(cleanPhotoCovers([rect({ color: "#F3EAD3" })])[0].color, "#f3ead3");
    assert.equal(cleanPhotoCovers([rect({ color: "fff" })])[0].color, "#ffffff");
  });

  it("is black on a bar sent without one — from a page opened before bars had a colour", () => {
    const bare: PhotoCover = { ...rect() };
    delete bare.color;
    assert.equal(cleanPhotoCovers([bare])[0].color, "#000000");
  });

  it("refuses a bar whose colour is not one", () => {
    assert.throws(() => cleanPhotoCovers([rect({ color: "red" })]), PhotoCoverValidationError);
    assert.throws(() => cleanPhotoCovers([rect({ color: "#12345" })]), PhotoCoverValidationError);
  });

  it("is dropped from a pixelation or a blur, which take theirs from the photo", () => {
    for (const style of ["pixelate", "blur"] as const) {
      assert.equal("color" in cleanPhotoCovers([{ ...rect({ style }), color: "#ffffff" }])[0], false);
    }
  });

  it("reads a stored row forgivingly: a bar without a usable colour is black, a blur has none", () => {
    const row = { shape: "rect", style: "bar", x: 0, y: 0, width: 0.5, height: 0.5 };
    assert.equal(storedPhotoCover({ ...row, color: null })?.color, "#000000");
    assert.equal(storedPhotoCover({ ...row, color: "#808080" })?.color, "#808080");
    assert.equal(storedPhotoCover({ ...row, style: "blur", color: "#808080" })?.color, undefined);
    assert.equal(storedPhotoCover({ ...row, style: "smudge", color: null }), null);
  });

  it("normalises a typed colour and a platform's stored one", () => {
    assert.equal(normalizeCoverColor(" #ABCDEF "), "#abcdef");
    assert.equal(normalizeCoverColor("nope"), null);
    assert.equal(normalizeCoverColor(undefined), null);
    assert.equal(normalizePlatformCoverColor("#ffffff"), "#ffffff");
    assert.equal(normalizePlatformCoverColor("garbage"), "#000000");
    assert.equal(normalizePlatformCoverColor(null), "#000000");
  });
});

describe("offerNeedsCovers", () => {
  it("follows the platform unless the offer says otherwise, either way", () => {
    assert.equal(offerNeedsCovers(null, true), true);
    assert.equal(offerNeedsCovers(null, false), false);
    assert.equal(offerNeedsCovers(false, true), false);
    assert.equal(offerNeedsCovers(true, false), true);
  });

  it("reads an unknown stored style as the default", () => {
    assert.equal(normalizePhotoCoverStyle("blur"), "blur");
    assert.equal(normalizePhotoCoverStyle("nonsense"), "pixelate");
    assert.equal(normalizePhotoCoverStyle(null), "pixelate");
  });
});

describe("coverWalkPhotos", () => {
  const copyPhotos = new Set(["f1", "b1", "f2", "x1"]);

  it("lists each copy photo the images use once, in plan order, paired backs included", () => {
    const walk = coverWalkPhotos(
      [
        { tiles: [{ photoId: "f1", itemId: "i1", pairedPhotoId: "b1" }, { photoId: "f2", itemId: "i2" }] },
        { tiles: [{ photoId: "f1", itemId: "i1" }] },
        { tiles: [{ photoId: "x1", itemId: "i1" }] },
      ],
      new Set(["b1"]),
      copyPhotos
    );
    assert.deepEqual(walk, [
      { photoId: "f1", itemId: "i1", checked: false },
      { photoId: "b1", itemId: "i1", checked: true },
      { photoId: "f2", itemId: "i2", checked: false },
      { photoId: "x1", itemId: "i1", checked: false },
    ]);
  });

  it("leaves out an image uploaded to the offer — it is not a copy's photo", () => {
    const walk = coverWalkPhotos(
      [{ tiles: [{ photoId: "up", itemId: null }, { photoId: "f1", itemId: "i1" }] }],
      new Set(),
      copyPhotos
    );
    assert.deepEqual(walk.map((w) => w.photoId), ["f1"]);
  });
});

describe("the covers in an offer's photo fingerprint", () => {
  const base: OfferPhotoFingerprintInput = {
    sets: [{ id: "s1", sortOrder: 0, items: [{ itemId: "i1", sortOrder: 0, catalogSortKey: null, frontPhotoId: "f1", backPhotoId: null }] }],
    photoSides: "front",
    photoLabelLeftTemplate: null,
    photoLabelRightTemplate: null,
    tileLabels: [],
    collage: null,
    limits: { maxPhotos: null, maxPhotoEdge: null, maxPhotoFileSizeMib: null },
  };
  const before = fingerprintOfferPhotoInputs(base);

  it("adds nothing for an offer that needs no covers, or whose photos carry none", () => {
    const covers = new Map([["f1", [rect()]]]);
    assert.equal(fingerprintOfferPhotoInputs({ ...base, covers: coverFingerprintRows(false, covers) }), before);
    assert.equal(
      fingerprintOfferPhotoInputs({ ...base, covers: coverFingerprintRows(true, new Map([["f1", []]])) }),
      before
    );
  });

  it("changes when a cover is drawn, moved or restyled", () => {
    const drawn = fingerprintOfferPhotoInputs({
      ...base,
      covers: coverFingerprintRows(true, new Map([["f1", [rect()]]])),
    });
    const moved = fingerprintOfferPhotoInputs({
      ...base,
      covers: coverFingerprintRows(true, new Map([["f1", [rect({ x: 0.3 })]]])),
    });
    const restyled = fingerprintOfferPhotoInputs({
      ...base,
      covers: coverFingerprintRows(true, new Map([["f1", [rect({ style: "blur" })]]])),
    });
    assert.notEqual(drawn, before);
    assert.notEqual(moved, drawn);
    assert.notEqual(restyled, drawn);
  });

  it("changes when a bar is recoloured, but a black bar hashes as every bar did before colours (#1702)", () => {
    const rows = (cover: PhotoCover) => coverFingerprintRows(true, new Map([["f1", [cover]]]));
    // What a bar hashed as before #1702: shape, style and box, nothing else.
    assert.deepEqual(rows(rect()), [["f1", [["rect", "bar", 0.25, 0.25, 0.5, 0.5]]]]);
    const black = fingerprintOfferPhotoInputs({ ...base, covers: rows(rect()) });
    const white = fingerprintOfferPhotoInputs({ ...base, covers: rows(rect({ color: "#ffffff" })) });
    const cream = fingerprintOfferPhotoInputs({ ...base, covers: rows(rect({ color: "#f3ead3" })) });
    assert.notEqual(white, black);
    assert.notEqual(cream, white);
  });

  it("does not depend on the order the photos were read in", () => {
    const a = coverFingerprintRows(true, new Map([["f1", [rect()]], ["b1", [rect({ y: 0 })]]]));
    const b = coverFingerprintRows(true, new Map([["b1", [rect({ y: 0 })]], ["f1", [rect()]]]));
    assert.deepEqual(a, b);
  });
});

describe("the ready gate's cover reason", () => {
  it("says how many photos are still to check, and nothing when none are", () => {
    assert.deepEqual(evaluateCoverReadiness(0), []);
    const [blocker] = evaluateCoverReadiness(3);
    assert.equal(blocker.code, "photo-covers-unchecked");
    assert.equal(blocker.count, 3);
    assert.match(blocker.title, /^3 photos/);
    assert.match(evaluateCoverReadiness(1)[0].title, /^1 photo not/);
  });

  it("is not a photo gap the Assistant could fix by generating", () => {
    const [blocker] = evaluateCoverReadiness(2);
    assert.equal(isPhotoReadinessBlocker(blocker), false);
    assert.equal(isCoverReadinessBlocker(blocker), true);
  });
});

describe("applyPhotoCovers", () => {
  /** A 100 × 80 photo, white on the left half and red on the right. */
  async function photo(): Promise<Buffer> {
    const pixels = Buffer.alloc(100 * 80 * 3);
    for (let y = 0; y < 80; y += 1) {
      for (let x = 0; x < 100; x += 1) {
        const i = (y * 100 + x) * 3;
        const red = x >= 50;
        pixels[i] = 255;
        pixels[i + 1] = red ? 0 : 255;
        pixels[i + 2] = red ? 0 : 255;
      }
    }
    return sharp(pixels, { raw: { width: 100, height: 80, channels: 3 } }).png().toBuffer();
  }

  async function pixel(buffer: Buffer, x: number, y: number): Promise<number[]> {
    const { data, info } = await sharp(buffer).raw().toBuffer({ resolveWithObject: true });
    const i = (y * info.width + x) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  }

  it("returns the photo untouched when there is nothing to cover", async () => {
    const original = await photo();
    assert.equal(await applyPhotoCovers(original, []), original);
  });

  it("draws a bar over its box and leaves the rest of the photo alone, at the photo's size", async () => {
    const covered = await applyPhotoCovers(await photo(), [rect({ x: 0.6, y: 0.25, width: 0.2, height: 0.5 })]);
    const meta = await sharp(covered).metadata();
    assert.equal(meta.width, 100);
    assert.equal(meta.height, 80);
    assert.deepEqual(await pixel(covered, 70, 40), [0, 0, 0]);
    assert.deepEqual(await pixel(covered, 90, 40), [255, 0, 0]);
    assert.deepEqual(await pixel(covered, 10, 40), [255, 255, 255]);
  });

  it("draws a bar in its own colour (#1702)", async () => {
    const covered = await applyPhotoCovers(await photo(), [
      rect({ color: "#f3ead3", x: 0.6, y: 0.25, width: 0.2, height: 0.5 }),
    ]);
    assert.deepEqual(await pixel(covered, 70, 40), [0xf3, 0xea, 0xd3]);
    assert.deepEqual(await pixel(covered, 90, 40), [255, 0, 0]);
  });

  it("an ellipse covers its middle and leaves its box's corners showing", async () => {
    const covered = await applyPhotoCovers(await photo(), [
      rect({ shape: "ellipse", x: 0.5, y: 0, width: 0.5, height: 1 }),
    ]);
    assert.deepEqual(await pixel(covered, 75, 40), [0, 0, 0]);
    assert.deepEqual(await pixel(covered, 51, 1), [255, 0, 0]);
  });

  it("pixelates and blurs across the edge they straddle, mixing what was on either side", async () => {
    for (const style of ["pixelate", "blur"] as const) {
      const covered = await applyPhotoCovers(await photo(), [rect({ style, x: 0.3, y: 0.2, width: 0.4, height: 0.6 })]);
      // Just right of the white/red edge: no longer the pure red it was.
      const [, g] = await pixel(covered, 50, 40);
      assert.ok(g > 20, `${style}: expected white mixed into the red, got green ${g}`);
      // Outside the cover nothing changed.
      assert.deepEqual(await pixel(covered, 95, 5), [255, 0, 0]);
    }
  });
});

describe("carrying covers to the next photo (#1703)", () => {
  const front = rect({ x: 0.1, y: 0.2, width: 0.3, height: 0.4 });
  const back = rect({ shape: "ellipse", style: "blur", x: 0.6, y: 0.6, width: 0.2, height: 0.2 });

  it("proposes a front's covers on the next unchecked front, as the same shares of the photo", () => {
    const carried = carryAfterSave(NO_CARRIED_COVERS, "front", [front]);
    assert.deepEqual(proposedCovers(carried, { side: "front", checked: false }), [front]);
  });

  it("keeps the sides apart: a back's covers come from the previous back, not the front", () => {
    let carried = carryAfterSave(NO_CARRIED_COVERS, "front", [front]);
    assert.equal(proposedCovers(carried, { side: "back", checked: false }), null);
    carried = carryAfterSave(carried, "back", [back]);
    assert.deepEqual(proposedCovers(carried, { side: "back", checked: false }), [back]);
    assert.deepEqual(proposedCovers(carried, { side: "front", checked: false }), [front]);
  });

  it("a photo saved with nothing to cover passes nothing on", () => {
    let carried = carryAfterSave(NO_CARRIED_COVERS, "front", [front]);
    carried = carryAfterSave(carried, "front", []);
    assert.equal(proposedCovers(carried, { side: "front", checked: false }), null);
  });

  it("never proposes over a photo already checked, nor to or from an extra", () => {
    const carried = carryAfterSave(NO_CARRIED_COVERS, "front", [front]);
    assert.equal(proposedCovers(carried, { side: "front", checked: true }), null);
    assert.equal(proposedCovers(carried, { side: null, checked: false }), null);
    assert.equal(carryAfterSave(carried, null, []), carried);
  });

  it("hands out copies, so editing a proposal leaves what is carried as it was", () => {
    const carried = carryAfterSave(NO_CARRIED_COVERS, "front", [front]);
    const proposal = proposedCovers(carried, { side: "front", checked: false })!;
    proposal[0].x = 0.9;
    assert.equal(carried.front[0].x, 0.1);
  });
});
