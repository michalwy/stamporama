import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { fillableTiles, sectionFill, sectionUnmarkedHint } from "../../src/lib/tile-mark-fill";
import type { TileMark } from "../../src/lib/tile-marks";

// What *Mark all unmarked* reaches on the strip: one card (#1556), or every card at once from the
// section's header (#2456). The writes themselves — each half only where a tile has none — are
// `fillPatch`'s and pinned in `tile-marks.test.ts` and the integration suite.

const BOX = { x: 0, y: 0, w: 10, h: 10 };
let next = 0;
const tile = (
  state: string,
  mark: TileMark | null = null,
  { front = true, cutUnreviewed = false } = {}
) => ({ id: `t${next++}`, state, mark, frontBox: front ? BOX : null, cutUnreviewed });
const mark = (conditionId: string | null, certificateStatusId: string | null = null): TileMark => ({
  conditionId,
  certificateStatusId,
});

describe("fillableTiles (#1556)", () => {
  it("reaches the open fronts only — never an unpaired back, never a tile already dealt with", () => {
    const waiting = tile("unidentified");
    const parked = tile("parked");
    const tiles = [
      waiting,
      parked,
      tile("consumed"),
      tile("discarded"),
      tile("unidentified", null, { front: false }),
    ];
    assert.deepEqual(
      fillableTiles(tiles, "all").map((t) => t.id),
      [waiting.id, parked.id]
    );
  });

  it("reaches only what the chip is showing", () => {
    const waiting = tile("unidentified");
    const tiles = [waiting, tile("parked")];
    assert.deepEqual(
      fillableTiles(tiles, "waiting").map((t) => t.id),
      [waiting.id]
    );
  });
});

describe("sectionFill (#2456)", () => {
  it("gathers every card's open fronts, counting each half's tiles and scans", () => {
    const a = [tile("unidentified"), tile("unidentified", mark("mnh"))];
    const b = [tile("unidentified", mark(null, "cert")), tile("consumed")];
    const c = [tile("unidentified", mark("mnh", "cert"))];
    const fill = sectionFill([{ tiles: a }, { tiles: b }, { tiles: c }, { tiles: [] }], "all");
    assert.deepEqual(fill.tileIds, [a[0].id, a[1].id, b[0].id, c[0].id]);
    assert.deepEqual(fill.condition, { tiles: 2, scans: 2 }, "a[0] and b[0], on two cards");
    assert.deepEqual(fill.certificate, { tiles: 2, scans: 1 }, "both on the first card");
  });

  it("leaves out the tiles the chip hides", () => {
    const a = [tile("unidentified"), tile("parked")];
    const fill = sectionFill([{ tiles: a }], "parked");
    assert.deepEqual(fill.tileIds, [a[1].id]);
  });
});

describe("sectionUnmarkedHint (#2456)", () => {
  const none = { hiddenByChip: false, preparing: 0 };

  it("names how many tiles each half reaches, and on how many scans", () => {
    const fill = sectionFill(
      [
        { tiles: [tile("unidentified"), tile("unidentified")] },
        { tiles: [tile("unidentified", mark(null, "cert"))] },
      ],
      "all"
    );
    assert.equal(
      sectionUnmarkedHint(fill, none),
      "Mark 3 unmarked tiles on 2 scans with a condition, or 2 on 1 with a certificate, in one pick — tiles already marked keep their mark"
    );
  });

  it("says when every tile is marked, and when there is nothing to mark", () => {
    const marked = sectionFill([{ tiles: [tile("unidentified", mark("mnh", "cert"))] }], "all");
    assert.equal(
      sectionUnmarkedHint(marked, none),
      "Every tile on every scan has a condition and a certificate marked"
    );
    assert.equal(sectionUnmarkedHint(sectionFill([], "all"), none), "No tiles to mark");
  });

  it("says what it leaves out: the tiles a chip hides, and the scans still being prepared", () => {
    const fill = sectionFill([{ tiles: [tile("unidentified")] }], "waiting");
    assert.equal(
      sectionUnmarkedHint(fill, { hiddenByChip: true, preparing: 2 }),
      "Mark 1 unmarked tile on 1 scan with a condition, or 1 on 1 with a certificate, in one pick — tiles already marked keep their mark — the tiles the chip is hiding are not reached — 2 scans still being prepared are not reached"
    );
    assert.match(sectionUnmarkedHint(fill, { hiddenByChip: false, preparing: 1 }), /1 scan still being prepared is not reached$/);
  });
});
