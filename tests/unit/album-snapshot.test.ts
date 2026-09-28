import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { ALBUM_SNAPSHOT_VERSION, parseAlbumSnapshot } from "../../src/lib/album-snapshot";
import { DEFAULT_ALBUM_PRESET } from "../../src/lib/album-template-rules";
import { albumBuiltinOrnament } from "../../src/lib/album-ornaments";

// A printed card read back (#778). What is pinned here is the reading of cards stored before a
// template value existed: filled in with what they were printed with, never refused.

function stored(preset: object, extra: Record<string, unknown> = {}) {
  return {
    version: ALBUM_SNAPSHOT_VERSION,
    albumName: "Polska",
    language: "pl",
    preset,
    range: "PL 1-2",
    chapterKey: "1950",
    page: { kind: "live", boxes: [], blocks: [], placement: "top" },
    footer: null,
    ...extra,
  };
}

describe("a card stored before ornamental frames (#1427)", () => {
  const before: Record<string, unknown> = { ...DEFAULT_ALBUM_PRESET };
  delete before.borderGapMm;
  delete before.frameOrnament;
  delete before.frameOrnamentSizeMm;

  it("reads as the frame it was printed with: no ornament, the pair 1.2 mm apart", () => {
    const card = parseAlbumSnapshot(stored(before));
    assert.equal(card.preset.borderGapMm, 1.2);
    assert.equal(card.preset.frameOrnament, "none");
    assert.equal(card.preset.frameOrnamentSizeMm, 25);
    assert.equal(card.frameOrnament, null);
  });

  it("keeps the drawing a newer card stored, whatever the album now says", () => {
    const drawing = albumBuiltinOrnament("square");
    const card = parseAlbumSnapshot(stored(DEFAULT_ALBUM_PRESET, { frameOrnament: drawing }));
    assert.deepEqual(card.frameOrnament, drawing);
    assert.equal(card.preset.frameOrnament, "rosette");
  });
});
