import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { copyBackPlacement, takesDraggedBack } from "../../src/lib/late-backs";

// Where a back goes once its front has become a copy (#1995), and which squares a dragged back may be
// dropped on — the strip's half of the rule the server's pairing applies.

const BOX = { x: 0, y: 0, w: 10, h: 10 };

function tile(over: Partial<Parameters<typeof takesDraggedBack>[0]> = {}) {
  return {
    state: "unidentified",
    frontBox: BOX,
    backBox: null,
    backPhotoId: null,
    item: null,
    ...over,
  };
}

describe("copyBackPlacement (#1995)", () => {
  it("gives the back to a copy that has none", () => {
    assert.equal(copyBackPlacement({ exists: true, hasBack: false }), "copy");
  });

  it("never replaces a back the copy has", () => {
    assert.equal(copyBackPlacement({ exists: true, hasBack: true }), "copy-has-back");
  });

  it("gives nothing to a copy that was deleted", () => {
    assert.equal(copyBackPlacement({ exists: false, hasBack: false }), "copy-deleted");
  });
});

describe("takesDraggedBack (#1995)", () => {
  it("takes a back on a waiting or parked tile with none, as before", () => {
    assert.equal(takesDraggedBack(tile()), true);
    assert.equal(takesDraggedBack(tile({ state: "parked" })), true);
    assert.equal(takesDraggedBack(tile({ backPhotoId: "p", backBox: BOX })), false);
  });

  it("takes a back on a tile that became a copy with no back picture", () => {
    assert.equal(
      takesDraggedBack(tile({ state: "consumed", item: { backPhotoId: null } })),
      true
    );
  });

  it("refuses a copy that has a back picture, and a deleted copy", () => {
    assert.equal(
      takesDraggedBack(tile({ state: "consumed", item: { backPhotoId: "p" } })),
      false
    );
    assert.equal(takesDraggedBack(tile({ state: "consumed", item: null })), false);
  });

  it("refuses a consumed tile that already carries a back from a scan", () => {
    assert.equal(
      takesDraggedBack(tile({ state: "consumed", backBox: BOX, item: { backPhotoId: null } })),
      false
    );
  });

  it("refuses a discarded tile and a back-only one", () => {
    assert.equal(takesDraggedBack(tile({ state: "discarded" })), false);
    assert.equal(takesDraggedBack(tile({ frontBox: null })), false);
  });
});
