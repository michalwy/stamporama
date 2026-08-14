import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canTakeTileRoles,
  conflictingPhotoRoles,
  describeFreeSlots,
  formatTilePhotoRoles,
  parseTilePhotoRoles,
  photoRolesPresent,
  tilePhotoRoles,
} from "../../src/lib/tile-photo-roles";

// The rule behind scan-tile assignment (#567): a tile can go onto a copy only if none of the roles
// it carries is already taken there. It has two readers — the write that refuses, and the list that
// offers candidates — and they drifted once, with the list asking the weaker "has any free slot" and
// offering copies the write then refused. Pinned here because it is one predicate now.

describe("tile photo roles (#567)", () => {
  it("reads the roles present, ignoring extras and a stamp's main slot", () => {
    assert.deepEqual(photoRolesPresent([]), []);
    assert.deepEqual(photoRolesPresent([{ role: "front" }]), ["front"]);
    // Order is the canonical one, not the row order — the same set must serialize the same way.
    assert.deepEqual(photoRolesPresent([{ role: "back" }, { role: "front" }]), ["front", "back"]);
    assert.deepEqual(photoRolesPresent([{ role: null }, { role: "main" }]), []);
  });

  it("derives a tile's roles from its two crops, including the back-only case", () => {
    assert.deepEqual(tilePhotoRoles({ frontPhotoId: "p1", backPhotoId: null }), ["front"]);
    // An unpaired back, dragged onto a front later — it needs the back slot and only that.
    assert.deepEqual(tilePhotoRoles({ frontPhotoId: null, backPhotoId: "p2" }), ["back"]);
    assert.deepEqual(tilePhotoRoles({ frontPhotoId: "p1", backPhotoId: "p2" }), ["front", "back"]);
  });

  it("collides only on the roles the tile actually needs", () => {
    // The defect this replaced: a front-only tile against a copy that has a front and no back. The
    // copy *has* a free slot, and is still not a candidate.
    assert.deepEqual(conflictingPhotoRoles(["front"], ["front"]), ["front"]);
    assert.equal(canTakeTileRoles(["front"], [{ role: "front" }]), false);
    // …while the mirror case is fine: a front-only tile completes a back-only copy.
    assert.equal(canTakeTileRoles(["front"], [{ role: "back" }]), true);
    assert.equal(canTakeTileRoles(["back"], [{ role: "front" }]), true);
    // A tile with both sides needs a copy with neither.
    assert.equal(canTakeTileRoles(["front", "back"], [{ role: "back" }]), false);
    assert.equal(canTakeTileRoles(["front", "back"], [{ role: null }]), true);
  });

  it("round-trips the query encoding and drops anything unrecognised", () => {
    assert.equal(formatTilePhotoRoles(["front", "back"]), "front,back");
    assert.deepEqual(parseTilePhotoRoles("front,back"), ["front", "back"]);
    assert.deepEqual(parseTilePhotoRoles(" back "), ["back"]);
    assert.deepEqual(parseTilePhotoRoles("front,front"), ["front"]);
    assert.deepEqual(parseTilePhotoRoles("main,nonsense"), []);
    // Absent means no constraint, which the read has to be able to tell from "asked for nothing".
    assert.deepEqual(parseTilePhotoRoles(null), []);
    assert.deepEqual(parseTilePhotoRoles(""), []);
  });

  it("describes what a copy already holds", () => {
    assert.equal(describeFreeSlots([]), "no photos");
    assert.equal(describeFreeSlots([{ role: "front" }]), "front only");
    assert.equal(describeFreeSlots([{ role: "back" }]), "back only");
    assert.equal(describeFreeSlots([{ role: "front" }, { role: "back" }]), "front + back");
    // Extras are not slots, so a copy with three of them still has both sides free.
    assert.equal(describeFreeSlots([{ role: null }, { role: null }]), "no photos");
  });
});
