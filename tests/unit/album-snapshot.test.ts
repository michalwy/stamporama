import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALBUM_SNAPSHOT_VERSION,
  parseAlbumSnapshot,
  snapshotChapterHeadingKey,
} from "../../src/lib/album-snapshot";
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

describe("a card stored before the title could sit in the frame line (#1428)", () => {
  const before: Record<string, unknown> = { ...DEFAULT_ALBUM_PRESET };
  delete before.titlePlacement;
  delete before.titleFrameGapMm;

  it("reads as printed below the frame, with the migration's gap", () => {
    const card = parseAlbumSnapshot(stored(before));
    assert.equal(card.preset.titlePlacement, "below-frame");
    assert.equal(card.preset.titleFrameGapMm, 5);
  });
});

describe("a card stored before the footer was placed on its own (#1457)", () => {
  const before: Record<string, unknown> = { ...DEFAULT_ALBUM_PRESET };
  delete before.footerPlacement;
  delete before.footerOffsetMm;
  delete before.footerFrameGapMm;

  it("reads as printed inside the frame, its foot on its own bottom margin", () => {
    const card = parseAlbumSnapshot(stored(before));
    assert.equal(card.preset.footerPlacement, "inside-frame");
    // 10 mm margin, the double rule's inside at 6.8 mm: the migration's figure for its album.
    assert.equal(card.preset.footerOffsetMm, 3.2);
    assert.equal(card.preset.footerFrameGapMm, 5);
  });

  it("works the offset out from the card's own margin and frame, as the migration did its album's", () => {
    const card = parseAlbumSnapshot(
      stored({ ...before, marginBottomMm: 15, borderStyle: "single", borderWidthMm: 0.4 })
    );
    assert.equal(card.preset.footerOffsetMm, 9.8);
    // One older still, whose double rule was 1.2 mm apart before the gap was a value (#1427).
    const older: Record<string, unknown> = { ...before };
    delete older.borderGapMm;
    assert.equal(parseAlbumSnapshot(stored(older)).preset.footerOffsetMm, 3.2);
  });
});

describe("the chapter heading a card carries (#1498)", () => {
  const year = { role: "chapter", lines: ["1950"], xMm: 10, yMm: 31, widthMm: 190, heightMm: 12 };

  it("names the chapter of a card that printed its heading, alone or above a series", () => {
    const alone = parseAlbumSnapshot(
      stored(DEFAULT_ALBUM_PRESET, {
        page: { kind: "live", boxes: [], blocks: [], placement: "top", chapter: year },
      })
    );
    assert.equal(snapshotChapterHeadingKey(alone), "1950");
  });

  it("names none for a card that printed no heading", () => {
    assert.equal(snapshotChapterHeadingKey(parseAlbumSnapshot(stored(DEFAULT_ALBUM_PRESET))), null);
  });

  it("names none for a free page, whatever it printed: it never carries the year (ADR-0058)", () => {
    const free = parseAlbumSnapshot(
      stored(DEFAULT_ALBUM_PRESET, {
        page: {
          kind: "live",
          boxes: [],
          blocks: [],
          placement: "top",
          chapter: year,
          free: { id: "fp", elements: [] },
        },
      })
    );
    assert.equal(snapshotChapterHeadingKey(free), null);
  });
});
