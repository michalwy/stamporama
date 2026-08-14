import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MIN_BOX_EDGE_PX,
  boxContains,
  boxesIntersect,
  mergeBoxes,
  normalizeBox,
  pairByPosition,
  readingOrder,
  splitBox,
  type Box,
} from "../../src/lib/scan-boxes";

const box = (x: number, y: number, w: number, h: number): Box => ({ x, y, w, h });
const sheet = (width: number, height: number) => ({ width, height });

describe("normalizeBox", () => {
  it("accepts a drag made up-and-left, which is as ordinary as the other direction", () => {
    assert.deepEqual(
      normalizeBox({ x: 300, y: 200, w: -100, h: -80 }, sheet(1000, 1000)),
      box(200, 120, 100, 80)
    );
  });

  it("clamps to the sheet rather than cropping past its edge", () => {
    // A drag off the left/top of the card: `sharp.extract` would throw on a negative origin, so the
    // clamp has to happen before anything downstream sees the box.
    assert.deepEqual(
      normalizeBox({ x: -50, y: -30, w: 200, h: 200 }, sheet(1000, 800)),
      box(0, 0, 150, 170)
    );
    assert.deepEqual(
      normalizeBox({ x: 900, y: 700, w: 400, h: 400 }, sheet(1000, 800)),
      box(900, 700, 100, 100)
    );
  });

  it("refuses a box under the minimum edge, and one wholly off the sheet", () => {
    assert.equal(normalizeBox({ x: 10, y: 10, w: MIN_BOX_EDGE_PX - 1, h: 50 }, sheet(100, 100)), null);
    assert.equal(normalizeBox({ x: 10, y: 10, w: 50, h: MIN_BOX_EDGE_PX - 1 }, sheet(100, 100)), null);
    assert.equal(normalizeBox({ x: 200, y: 200, w: 50, h: 50 }, sheet(100, 100)), null);
  });

  it("rounds to whole pixels", () => {
    assert.deepEqual(
      normalizeBox({ x: 10.4, y: 20.6, w: 30.4, h: 40.2 }, sheet(1000, 1000)),
      box(10, 21, 31, 40)
    );
  });
});

describe("readingOrder", () => {
  it("orders a tidy grid left to right, top to bottom", () => {
    const boxes = [
      box(400, 10, 90, 120), // r0c2
      box(10, 10, 90, 120), // r0c0
      box(10, 200, 90, 120), // r1c0
      box(200, 10, 90, 120), // r0c1
      box(200, 200, 90, 120), // r1c1
    ];
    assert.deepEqual(readingOrder(boxes), [1, 3, 0, 2, 4]);
  });

  it("keeps a crooked row together", () => {
    // Stamps laid by hand sit a few pixels apart vertically; half a typical height absorbs that.
    const boxes = [box(10, 10, 90, 120), box(200, 28, 90, 120), box(400, 4, 90, 120)];
    assert.deepEqual(readingOrder(boxes), [0, 1, 2]);
  });

  it("takes the row tolerance from the median height, not the maximum", () => {
    // A block of four (400 tall) beside small definitives (100 tall), in two rows 150 apart. Half
    // the *tallest* box is 200, which would swallow both rows of definitives into one and reorder
    // the whole card; half the *median* is 50, which does not.
    const boxes = [
      box(600, 10, 300, 400), // 0 — the block, row 0
      box(10, 10, 80, 100), // 1 — row 0
      box(120, 10, 80, 100), // 2 — row 0
      box(10, 160, 80, 100), // 3 — row 1
      box(120, 160, 80, 100), // 4 — row 1
    ];
    assert.deepEqual(readingOrder(boxes), [1, 2, 0, 3, 4]);
  });

  it("is stable when two boxes share a top edge", () => {
    const boxes = [box(200, 50, 60, 60), box(10, 50, 60, 60)];
    assert.deepEqual(readingOrder(boxes), [1, 0]);
  });

  it("handles an empty card and a single box", () => {
    assert.deepEqual(readingOrder([]), []);
    assert.deepEqual(readingOrder([box(5, 5, 50, 50)]), [0]);
  });
});

describe("splitBox", () => {
  it("cuts two touching stamps apart vertically", () => {
    assert.deepEqual(splitBox(box(100, 100, 200, 150), "vertical", 190), [
      box(100, 100, 90, 150),
      box(190, 100, 110, 150),
    ]);
  });

  it("cuts horizontally", () => {
    assert.deepEqual(splitBox(box(100, 100, 200, 150), "horizontal", 170), [
      box(100, 100, 200, 70),
      box(100, 170, 200, 80),
    ]);
  });

  it("refuses a cut that would leave a sliver, and one outside the box", () => {
    assert.equal(splitBox(box(100, 100, 200, 150), "vertical", 103), null);
    assert.equal(splitBox(box(100, 100, 200, 150), "vertical", 299), null);
    assert.equal(splitBox(box(100, 100, 200, 150), "vertical", 500), null);
  });
});

describe("mergeBoxes", () => {
  it("takes the bounding box of two halves of one stamp", () => {
    assert.deepEqual(mergeBoxes([box(100, 100, 80, 200), box(175, 110, 90, 180)]), box(100, 100, 165, 200));
  });

  it("returns null for nothing to merge", () => {
    assert.equal(mergeBoxes([]), null);
  });
});

describe("boxesIntersect / boxContains", () => {
  it("distinguishes touching, overlapping and separate", () => {
    assert.equal(boxesIntersect(box(0, 0, 10, 10), box(10, 0, 10, 10)), false);
    assert.equal(boxesIntersect(box(0, 0, 10, 10), box(9, 0, 10, 10)), true);
    assert.equal(boxContains(box(0, 0, 100, 100), box(10, 10, 20, 20)), true);
    assert.equal(boxContains(box(0, 0, 100, 100), box(90, 90, 20, 20)), false);
  });
});

describe("pairByPosition", () => {
  // A three-stamp card. Each stamp is turned over **in place**, so the back scan has the same
  // layout in the same order — the whole premise of positional pairing.
  const front = [box(100, 100, 80, 100), box(300, 100, 80, 100), box(500, 100, 80, 100)];

  it("pairs each stamp to the back in its own position", () => {
    const back = [box(104, 98, 80, 100), box(297, 103, 80, 100), box(502, 101, 80, 100)];
    const result = pairByPosition(front, sheet(1000, 400), back, sheet(1000, 400));
    assert.deepEqual(result.pairs, [
      { frontIndex: 0, backIndex: 0 },
      { frontIndex: 1, backIndex: 1 },
      { frontIndex: 2, backIndex: 2 },
    ]);
    assert.deepEqual(result.frontUnmatched, []);
    assert.deepEqual(result.backUnmatched, []);
  });

  it("does not mirror the back scan", () => {
    // The reference implementation warns about mirroring because it turned whole *groups* over.
    // Here each stamp is turned in place, so a mirror would pair stamp 1 with stamp 3. The back
    // boxes are handed over in a reversed array to make the point that neither index order nor a
    // mirror is what decides: position is.
    const back = [box(502, 101, 80, 100), box(297, 103, 80, 100), box(104, 98, 80, 100)];
    const result = pairByPosition(front, sheet(1000, 400), back, sheet(1000, 400));
    assert.deepEqual(result.pairs, [
      { frontIndex: 0, backIndex: 2 },
      { frontIndex: 1, backIndex: 1 },
      { frontIndex: 2, backIndex: 0 },
    ]);
  });

  it("reports what found no partner instead of forcing a pairing", () => {
    // Backs scanned for the first and last stamp only — the sparse case. The middle front stays
    // unmatched rather than stealing a neighbour's back.
    const back = [box(104, 98, 80, 100), box(502, 101, 80, 100)];
    const result = pairByPosition(front, sheet(1000, 400), back, sheet(1000, 400));
    assert.deepEqual(result.pairs, [
      { frontIndex: 0, backIndex: 0 },
      { frontIndex: 2, backIndex: 1 },
    ]);
    assert.deepEqual(result.frontUnmatched, [1]);
    assert.deepEqual(result.backUnmatched, []);
  });

  it("leaves a back with no front over, for manual pairing", () => {
    // Four backs against three fronts — a region drawn split, or a stamp that fell out of the
    // front scan. The extra is reported, and becomes a back-only tile to be dragged onto a front.
    const back = [
      box(104, 98, 80, 100),
      box(297, 103, 80, 100),
      box(502, 101, 80, 100),
      box(700, 100, 80, 100),
    ];
    const result = pairByPosition(front, sheet(1000, 400), back, sheet(1000, 400));
    assert.equal(result.pairs.length, 3);
    assert.deepEqual(result.backUnmatched, [3]);
    assert.deepEqual(result.frontUnmatched, []);
  });

  it("mutuality stops two fronts sharing one back", () => {
    // Two fronts, one back sitting nearer the second. Both fronts call it their nearest; only the
    // one it calls back gets it.
    const twoFronts = [box(100, 100, 80, 100), box(300, 100, 80, 100)];
    const back = [box(290, 100, 80, 100)];
    const result = pairByPosition(twoFronts, sheet(1000, 400), back, sheet(1000, 400));
    assert.deepEqual(result.pairs, [{ frontIndex: 1, backIndex: 0 }]);
    assert.deepEqual(result.frontUnmatched, [0]);
  });

  it("compares in fractional coordinates, so a back scanned at another size still lines up", () => {
    // The same card scanned at double the resolution. In absolute pixels nothing would match.
    const back = front.map((b) => box(b.x * 2, b.y * 2, b.w * 2, b.h * 2));
    const result = pairByPosition(front, sheet(1000, 400), back, sheet(2000, 800));
    assert.deepEqual(result.pairs, [
      { frontIndex: 0, backIndex: 0 },
      { frontIndex: 1, backIndex: 1 },
      { frontIndex: 2, backIndex: 2 },
    ]);
  });

  it("handles an empty side", () => {
    const none = pairByPosition(front, sheet(1000, 400), [], sheet(1000, 400));
    assert.deepEqual(none.pairs, []);
    assert.deepEqual(none.frontUnmatched, [0, 1, 2]);
    const noFront = pairByPosition([], sheet(1000, 400), front, sheet(1000, 400));
    assert.deepEqual(noFront.pairs, []);
    assert.deepEqual(noFront.backUnmatched, [0, 1, 2]);
  });
});
