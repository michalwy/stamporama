import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  PHOTO_SOURCE_MAX_LENGTH,
  normalizePhotoSource,
  photoSourceTooLong,
} from "../../src/lib/photo-source";
import {
  derivePhotoChangeSet,
  type ChangeSetEntry,
} from "../../src/app/c/[collectionSlug]/inventory/photo-change-set";

/**
 * Where a photo came from (#1001): one free-text field under a length cap.
 *
 * The domain half — that the value is written, read back and refused when over the cap — is in
 * `tests/integration/photo-source.test.ts`. What is here is the editor's half: what a Save sends.
 * The defect worth guarding is the quiet one, a copy's editor (which never shows a source) clearing
 * one on every save, or the stamp editor dropping an edit because nothing else on the card changed.
 */
describe("photo source", () => {
  describe("the stored form", () => {
    it("trims, and treats blank and non-strings as none", () => {
      assert.equal(normalizePhotoSource("  https://colnect.com/x  "), "https://colnect.com/x");
      assert.equal(normalizePhotoSource("Michel Spezial 2020, p. 114"), "Michel Spezial 2020, p. 114");
      assert.equal(normalizePhotoSource("   "), null);
      assert.equal(normalizePhotoSource(""), null);
      assert.equal(normalizePhotoSource(null), null);
      assert.equal(normalizePhotoSource(undefined), null);
      assert.equal(normalizePhotoSource(42), null);
    });

    it("is capped by length and by nothing else", () => {
      assert.equal(photoSourceTooLong(null), false);
      assert.equal(photoSourceTooLong("x".repeat(PHOTO_SOURCE_MAX_LENGTH)), false);
      assert.equal(photoSourceTooLong("x".repeat(PHOTO_SOURCE_MAX_LENGTH + 1)), true);
      assert.equal(photoSourceTooLong("not a url at all"), false);
    });
  });

  describe("what the editor's Save sends", () => {
    const committed = {
      id: "p1",
      role: null,
      title: "Genuine, Colnect",
      sourceUrl: "https://colnect.com/a",
      sortOrder: 0,
    };
    const card = (over: Partial<ChangeSetEntry> = {}): ChangeSetEntry => ({
      source: "committed",
      photoId: "p1",
      status: "done",
      role: null,
      title: "Genuine, Colnect",
      sourceUrl: "https://colnect.com/a",
      turn: 0,
      ...over,
    });

    it("sends nothing for an untouched strip", () => {
      const cs = derivePhotoChangeSet([card()], [committed], ["main"], true);
      assert.deepEqual(cs, { add: [], update: [], remove: [] });
    });

    it("sends a source edit even when nothing else on the card changed", () => {
      const cs = derivePhotoChangeSet(
        [card({ sourceUrl: "https://www.delcampe.net/b" })],
        [committed],
        ["main"],
        true
      );
      assert.equal(cs.update.length, 1);
      assert.equal(cs.update[0].sourceUrl, "https://www.delcampe.net/b");
    });

    it("sends a cleared source as null", () => {
      const cs = derivePhotoChangeSet([card({ sourceUrl: "  " })], [committed], ["main"], true);
      assert.equal(cs.update.length, 1);
      assert.equal(cs.update[0].sourceUrl, null);
    });

    it("does not count whitespace around an unchanged source as an edit", () => {
      const cs = derivePhotoChangeSet(
        [card({ sourceUrl: " https://colnect.com/a " })],
        [committed],
        ["main"],
        true
      );
      assert.deepEqual(cs.update, []);
    });

    it("carries a new upload's source", () => {
      const cs = derivePhotoChangeSet(
        [card({ source: "staged", photoId: undefined, uploadId: "u1", sourceUrl: "Forum thread" })],
        [],
        ["main"],
        true
      );
      assert.equal(cs.add.length, 1);
      assert.equal(cs.add[0].sourceUrl, "Forum thread");
    });

    it("never sends a source from an editor that does not record one", () => {
      // A copy's editor opens with no source on its cards; were the key sent, its first save
      // would clear whatever the row holds.
      const retitled = derivePhotoChangeSet(
        [card({ sourceUrl: "", title: "Retitled" })],
        [committed],
        ["front", "back"],
        false
      );
      assert.equal(retitled.update.length, 1);
      assert.equal("sourceUrl" in retitled.update[0], false);

      const sourceOnly = derivePhotoChangeSet([card({ sourceUrl: "" })], [committed], ["front", "back"], false);
      assert.deepEqual(sourceOnly.update, []);

      const added = derivePhotoChangeSet(
        [card({ source: "staged", photoId: undefined, uploadId: "u1" })],
        [],
        ["front", "back"],
        false
      );
      assert.equal("sourceUrl" in added.add[0], false);
    });
  });
});
