import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cardSide,
  stripPicture,
  withCardSide,
  withSectionSide,
  type StripSides,
  type StripTilePictures,
} from "../../src/lib/scan-strip-side";

const FRONTS: StripSides = { side: "front", cardSides: {} };

describe("cardSide", () => {
  it("is the section's side for a card not switched on its own", () => {
    assert.equal(cardSide(FRONTS, 3), "front");
    assert.equal(cardSide({ side: "back", cardSides: {} }, 3), "back");
  });

  it("is the card's own choice where it made one", () => {
    assert.equal(cardSide({ side: "front", cardSides: { "3": "back" } }, 3), "back");
    assert.equal(cardSide({ side: "front", cardSides: { "3": "back" } }, 4), "front");
  });
});

describe("withCardSide", () => {
  it("turns only that card", () => {
    const next = withCardSide(FRONTS, 2, "back");
    assert.equal(cardSide(next, 2), "back");
    assert.equal(cardSide(next, 1), "front");
    assert.equal(next.side, "front");
  });

  it("drops the card's choice once it matches the section again", () => {
    const turned = withCardSide(FRONTS, 2, "back");
    assert.deepEqual(withCardSide(turned, 2, "front"), FRONTS);
  });
});

describe("withSectionSide", () => {
  it("sets every card, the ones switched on their own included", () => {
    const mixed: StripSides = { side: "front", cardSides: { "1": "back", "5": "back" } };
    assert.equal(cardSide(mixed, 1), "back");
    const backs = withSectionSide("back");
    assert.deepEqual(backs, { side: "back", cardSides: {} });
    for (const batchNo of [1, 2, 5]) assert.equal(cardSide(backs, batchNo), "back");
    // …and back to fronts, every card again — not only the ones that were not exceptions.
    const fronts = withSectionSide("front");
    for (const batchNo of [1, 2, 5]) assert.equal(cardSide(fronts, batchNo), "front");
  });

  it("leaves a card switched afterwards different from it", () => {
    const next = withCardSide(withSectionSide("back"), 4, "front");
    assert.equal(cardSide(next, 4), "front");
    assert.equal(cardSide(next, 1), "back");
  });
});

describe("stripPicture", () => {
  const BOTH: StripTilePictures = { frontPhotoId: "f", backPhotoId: "b", item: null };
  const FRONT_ONLY: StripTilePictures = { frontPhotoId: "f", backPhotoId: null, item: null };

  it("shows the front on Fronts", () => {
    assert.deepEqual(stripPicture(BOTH, "front"), { photoId: "f", shown: "front", noBack: false });
  });

  it("shows the back on Backs", () => {
    assert.deepEqual(stripPicture(BOTH, "back"), { photoId: "b", shown: "back", noBack: false });
  });

  it("keeps the front of a tile with no back, marked no back", () => {
    assert.deepEqual(stripPicture(FRONT_ONLY, "back"), {
      photoId: "f",
      shown: "front",
      noBack: true,
    });
    // On Fronts nothing is missing.
    assert.equal(stripPicture(FRONT_ONLY, "front").noBack, false);
  });

  it("reads a consumed tile's sides through the copy it became", () => {
    const consumed: StripTilePictures = {
      frontPhotoId: null,
      backPhotoId: null,
      item: { frontPhotoId: "cf", backPhotoId: "cb" },
    };
    assert.equal(stripPicture(consumed, "front").photoId, "cf");
    assert.deepEqual(stripPicture(consumed, "back"), { photoId: "cb", shown: "back", noBack: false });
    const noBack: StripTilePictures = { ...consumed, item: { frontPhotoId: "cf", backPhotoId: null } };
    assert.deepEqual(stripPicture(noBack, "back"), { photoId: "cf", shown: "front", noBack: true });
  });
});
