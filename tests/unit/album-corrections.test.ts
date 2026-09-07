import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  albumCorrectedStampSize,
  asAlbumBlockBreak,
  asAlbumTextBlockSide,
  asAlbumTextRole,
  isEmptyBoxAdjustment,
  parseAlbumCorrectionMm,
  ALBUM_BOX_DELTA_MAX_MM,
  ALBUM_BOX_DELTA_MIN_MM,
  ALBUM_SPACE_MAX_MM,
  ALBUM_SPACE_MIN_MM,
} from "../../src/lib/album-corrections";
import { planHawidBox } from "../../src/lib/hawid";

describe("parseAlbumCorrectionMm", () => {
  it("takes either decimal separator, as every other decimal in this app does", () => {
    assert.deepEqual(parseAlbumCorrectionMm("2,5", "Width", -10, 10), { ok: true, value: 2.5 });
    assert.deepEqual(parseAlbumCorrectionMm("2.5", "Width", -10, 10), { ok: true, value: 2.5 });
  });

  it("takes a negative, which is what separates a correction from a strip height", () => {
    assert.deepEqual(parseAlbumCorrectionMm("-6", "Space", -50, 200), { ok: true, value: -6 });
  });

  it("reads a blank field as zero, because clearing it is how a correction is taken back", () => {
    assert.deepEqual(parseAlbumCorrectionMm("", "Space", -50, 200), { ok: true, value: 0 });
    // A lone minus is a field halfway through being typed, not a mistake to report.
    assert.deepEqual(parseAlbumCorrectionMm("-", "Space", -50, 200), { ok: true, value: 0 });
  });

  it("refuses more than a tenth of a millimetre", () => {
    const result = parseAlbumCorrectionMm("2.55", "Width", -10, 10);
    assert.equal(result.ok, false);
  });

  it("refuses a figure outside its rails, naming them", () => {
    const result = parseAlbumCorrectionMm("500", "Space", ALBUM_SPACE_MIN_MM, ALBUM_SPACE_MAX_MM);
    assert.equal(result.ok, false);
    if (!result.ok) assert.match(result.message, /between -50 and 200 mm/);
  });
});

describe("the correction vocabularies", () => {
  it("reads an unknown break as the packer's own answer rather than throwing", () => {
    assert.equal(asAlbumBlockBreak("always"), "always");
    assert.equal(asAlbumBlockBreak("avoid"), "avoid");
    // A value written by an older build must degrade to the automatic layout, never to a screen
    // that throws — `parseRecentEntities`' rule, and the stakes here are a page.
    assert.equal(asAlbumBlockBreak("sometimes"), "auto");
  });

  it("reads an unknown role as the ordinary block heading", () => {
    assert.equal(asAlbumTextRole("footer"), "footer");
    assert.equal(asAlbumTextRole("marginalia"), "heading");
  });

  it("reads an unknown anchor side as `after`, which is what every row written before it meant", () => {
    assert.equal(asAlbumTextBlockSide("before"), "before");
    assert.equal(asAlbumTextBlockSide("after"), "after");
    assert.equal(asAlbumTextBlockSide(""), "after");
  });
});

describe("albumCorrectedStampSize", () => {
  const size = { widthMm: 26, heightMm: 32 };

  it("leaves a stamp alone when there is nothing to correct", () => {
    assert.deepEqual(albumCorrectedStampSize(size, null), size);
    assert.deepEqual(
      albumCorrectedStampSize(size, { widthDeltaMm: 0, heightDeltaMm: 0 }),
      size
    );
    assert.ok(isEmptyBoxAdjustment({ widthDeltaMm: 0, heightDeltaMm: 0 }));
  });

  it("clamps a negative correction bigger than the stamp rather than refusing it", () => {
    // A drag that overshot. A negative size is not a figure anything downstream can use, and the
    // collector let go of the handle where they let go of it.
    assert.deepEqual(albumCorrectedStampSize(size, { widthDeltaMm: -99, heightDeltaMm: -99 }), {
      widthMm: 0,
      heightMm: 0,
    });
  });

  it("rounds to a tenth before anything compares it", () => {
    // `hawid.ts`'s rule, one step earlier: `23.9 + 0.1` is not `24` in binary floating point, and the
    // strip that mismatch picks is a taller one — material spent on an arithmetic artefact.
    const corrected = albumCorrectedStampSize(
      { widthMm: 23.9, heightMm: 23.9 },
      { widthDeltaMm: 0.1, heightDeltaMm: 0.1 }
    );
    assert.equal(corrected.widthMm, 24);
    assert.equal(corrected.heightMm, 24);
  });

  it("is bounded the way the fields that write it are", () => {
    assert.ok(ALBUM_BOX_DELTA_MIN_MM < 0 && ALBUM_BOX_DELTA_MAX_MM > 0);
  });
});

describe("a corrected box still comes out of the drawer", () => {
  // The whole point of correcting the **stamp** rather than the box. A hawid box's height is not a
  // chosen number: it is the whole height of the shortest strip in stock the piece fits into,
  // because hawid is sold as strips of a fixed height that are cut across. A correction applied to
  // the finished box would draw one at a height no strip has — the page-disagrees-with-the-desk
  // failure #765 exists to prevent.
  // Packets of 24, 29 and 41 mm, each with a 4 mm border, so the strips themselves are 28, 33 and
  // 45 mm tall — and it is those the box is drawn at (#793).
  const stock = [
    { heightMm: 24, totalHeightMm: 28, stockLengthMm: 210 },
    { heightMm: 29, totalHeightMm: 33, stockLengthMm: 210 },
    { heightMm: 41, totalHeightMm: 45, stockLengthMm: 210 },
  ];
  const margins = { verticalClearanceMm: 4, horizontalMarginMm: 4 };
  const box = (adjustment: { widthDeltaMm: number; heightDeltaMm: number } | null) =>
    planHawidBox(
      albumCorrectedStampSize({ widthMm: 26, heightMm: 20 }, adjustment),
      margins,
      stock
    );

  it("moves the height in strip steps, not continuously", () => {
    // 20 + 4 = 24 mm of strip, which the 24 mm packet supplies — 28 mm of hawid. Five more
    // millimetres on the piece is 29, which no longer fits inside it, so the box jumps to the 29 mm
    // packet and is drawn at 33: the drag that asked for 5 got 5 of stamp and 5 of box. That is the
    // correct answer and the screen has to be able to say so.
    assert.equal(box(null).heightMm, 28);
    assert.equal(box({ widthDeltaMm: 0, heightDeltaMm: 5 }).heightMm, 33);
    // And a correction the current strip absorbs changes nothing at all.
    assert.equal(box({ widthDeltaMm: 0, heightDeltaMm: -1 }).heightMm, 28);
  });

  it("moves the width continuously, because that axis is the cut", () => {
    assert.equal(box(null).widthMm, 30);
    assert.equal(box({ widthDeltaMm: 2.5, heightDeltaMm: 0 }).widthMm, 32.5);
  });

  it("makes a box nothing can supply a pocket, which is an answer rather than an error", () => {
    // Raised past the tallest strip: no strip fits, so the box takes its own size and no strip, and
    // #770 says *pocket* rather than naming a cut nobody can make.
    const raised = box({ widthDeltaMm: 0, heightDeltaMm: 45 });
    assert.equal(raised.strip, null);
    assert.equal(raised.heightMm, 69);

    // Widened past the stock length: a 210 mm strip cannot yield a 240 mm piece however tall it is.
    const widened = box({ widthDeltaMm: 190, heightDeltaMm: 0 });
    assert.equal(widened.strip, null);
  });
});
