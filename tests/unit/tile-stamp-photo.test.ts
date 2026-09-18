import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  effectiveStampPhotoChoice,
  stampPhotoDefaultOn,
  stampPhotoFormValue,
} from "../../src/lib/tile-stamp-photo";

// The identification dialog's *use the tile's photo as the stamp's photo* (#1340). The default is
// today's behaviour — on for a stamp with no photo, off for one with — so nothing is replaced unless
// the collector turns it on.

describe("the stamp photo option's default (#1340)", () => {
  it("is on for a stamp with no photo, off for one with, and unknown while loading", () => {
    assert.equal(stampPhotoDefaultOn(0), true);
    assert.equal(stampPhotoDefaultOn(1), false);
    assert.equal(stampPhotoDefaultOn(3), false);
    assert.equal(stampPhotoDefaultOn(undefined), undefined);
  });

  it("takes the collector's answer for the stamp it was given for, and only that one", () => {
    const choice = { stampId: "s1", on: true, tileId: "t2" };
    assert.deepEqual(
      effectiveStampPhotoChoice({ stampId: "s1", choice, stampPhotoCount: 2, defaultTileId: "t1" }),
      { on: true, tileId: "t2" }
    );
    // Another stamp picked is another question: its own default, from the first tile.
    assert.deepEqual(
      effectiveStampPhotoChoice({ stampId: "s2", choice, stampPhotoCount: 2, defaultTileId: "t1" }),
      { on: false, tileId: "t1" }
    );
    assert.deepEqual(
      effectiveStampPhotoChoice({ stampId: "s2", choice: null, stampPhotoCount: 0, defaultTileId: "t1" }),
      { on: true, tileId: "t1" }
    );
  });
});

describe("what the form sends as stampPhotoTileId (#1340)", () => {
  it("names the tile when on, and says no when off", () => {
    assert.equal(stampPhotoFormValue({ offered: true, on: true, tileId: "t1" }), "t1");
    assert.equal(stampPhotoFormValue({ offered: true, on: false, tileId: "t1" }), "");
  });

  it("leaves the field out while the default is unknown, so the server's seed — the default — runs", () => {
    assert.equal(stampPhotoFormValue({ offered: true, on: undefined, tileId: "t1" }), undefined);
  });

  it("says no for a piece in another format, whatever the option said (#346)", () => {
    assert.equal(stampPhotoFormValue({ offered: false, on: true, tileId: "t1" }), "");
    assert.equal(stampPhotoFormValue({ offered: false, on: undefined, tileId: "t1" }), "");
  });
});
