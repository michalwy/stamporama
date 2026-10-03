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
    assert.equal(result.mode, "positional");
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

  it("pairs nothing when the back sheet covers only some of the stamps (#647)", () => {
    // Backs scanned for the first and last stamp only — the sparse case, and the one mutuality
    // does **not** carry: box 2's back is missing, so front 2 and back 2 (the last stamp's) are
    // each other's nearest and the match is mutual, one square off. Two of the three would be
    // wrong and nothing downstream could tell. So the count decides, and the whole card is paired
    // by hand.
    const back = [box(104, 98, 80, 100), box(502, 101, 80, 100)];
    const result = pairByPosition(front, sheet(1000, 400), back, sheet(1000, 400));
    assert.equal(result.mode, "manual");
    assert.deepEqual(result.pairs, []);
    assert.deepEqual(result.frontUnmatched, [0, 1, 2]);
    assert.deepEqual(result.backUnmatched, [0, 1]);
  });

  it("pairs nothing with a back over, either — a stamp fell out or a region was drawn split", () => {
    // Four backs against three fronts. Three of them would pair, but the count says the two cards
    // are not the same layout, and which three is exactly what cannot be trusted.
    const back = [
      box(104, 98, 80, 100),
      box(297, 103, 80, 100),
      box(502, 101, 80, 100),
      box(700, 100, 80, 100),
    ];
    const result = pairByPosition(front, sheet(1000, 400), back, sheet(1000, 400));
    assert.equal(result.mode, "manual");
    assert.deepEqual(result.pairs, []);
    assert.deepEqual(result.backUnmatched, [0, 1, 2, 3]);
  });

  it("mutuality stops two fronts sharing one back", () => {
    // Two fronts and two backs, both backs sitting over the second stamp — the first was turned
    // over onto its neighbour, or a shadow was boxed. The nearer one wins the front it calls back,
    // and the other is left over rather than forced onto the front that has none.
    const twoFronts = [box(100, 100, 80, 100), box(300, 100, 80, 100)];
    const back = [box(290, 100, 80, 100), box(295, 100, 80, 100)];
    const result = pairByPosition(twoFronts, sheet(1000, 400), back, sheet(1000, 400));
    assert.deepEqual(result.pairs, [{ frontIndex: 1, backIndex: 1 }]);
    assert.deepEqual(result.frontUnmatched, [0]);
    assert.deepEqual(result.backUnmatched, [0]);
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

  // A whole card turned over (#1555). A 3 × 2 card, laid off-centre on the glass — its stamps span
  // x 100–580 of a 1000-wide scan and y 100–330 of a 400-high one — so a mirror about the scan's
  // edges would put every back well away from where it is.
  const grid = [
    box(100, 100, 80, 100), // 0 top-left
    box(300, 100, 80, 100), // 1 top-middle
    box(500, 100, 80, 100), // 2 top-right
    box(100, 230, 80, 100), // 3 bottom-left
    box(300, 230, 80, 100), // 4 bottom-middle
    box(500, 230, 80, 100), // 5 bottom-right
  ];
  /** The grid's backs after the card was turned over, then moved by `dx, dy` on the glass: each
   * box mirrored about the card's own extent, in the same array order as the fronts so a back's
   * index names the stamp it belongs to. */
  const turned = (axis: "left_right" | "top_bottom", dx: number, dy: number) =>
    grid.map((b) =>
      axis === "left_right"
        ? box(100 + 580 - (b.x + b.w) + dx, b.y + dy, b.w, b.h)
        : box(b.x + dx, 100 + 330 - (b.y + b.h) + dy, b.w, b.h)
    );
  const ownPairs = grid.map((_, i) => ({ frontIndex: i, backIndex: i }));

  it("pairs a card turned left to right across its vertical axis, shifted between the scans", () => {
    const back = turned("left_right", 140, -30);
    const result = pairByPosition(grid, sheet(1000, 400), back, sheet(1000, 400), "card_left_right");
    assert.equal(result.mode, "positional");
    assert.deepEqual(result.pairs, ownPairs);
  });

  it("pairs a card turned top to bottom across its horizontal axis, shifted between the scans", () => {
    const back = turned("top_bottom", -60, 25);
    const result = pairByPosition(grid, sheet(1000, 400), back, sheet(1000, 400), "card_top_bottom");
    assert.equal(result.mode, "positional");
    assert.deepEqual(result.pairs, ownPairs);
  });

  it("pairs a turned card's backs to the wrong fronts when told they were turned in place", () => {
    // The failure #1555 was raised for: the back of the top-left stamp sits top-right, and
    // position alone pairs it there.
    const back = turned("left_right", 0, 0);
    const result = pairByPosition(grid, sheet(1000, 400), back, sheet(1000, 400));
    assert.notDeepEqual(result.pairs, ownPairs);
    assert.deepEqual(result.pairs.find((p) => p.frontIndex === 0), { frontIndex: 0, backIndex: 2 });
  });

  it("does not stretch a single column's few pixels of drift across the card", () => {
    // One column, turned left to right: the centres across are a few pixels apart, and measured
    // against their own spread they would land at opposite edges. Measured against the boxes'
    // extent they stay in the middle and the rows decide.
    const column = [box(100, 50, 80, 100), box(103, 170, 80, 100), box(98, 290, 80, 100)];
    const back = [box(402, 52, 80, 100), box(404, 171, 80, 100), box(399, 289, 80, 100)];
    const result = pairByPosition(column, sheet(1000, 400), back, sheet(1000, 400), "card_left_right");
    assert.deepEqual(result.pairs, [
      { frontIndex: 0, backIndex: 0 },
      { frontIndex: 1, backIndex: 1 },
      { frontIndex: 2, backIndex: 2 },
    ]);
  });

  it("still pairs nothing on a turned card when the counts differ", () => {
    const back = turned("top_bottom", 0, 0).slice(0, 5);
    const result = pairByPosition(grid, sheet(1000, 400), back, sheet(1000, 400), "card_top_bottom");
    assert.equal(result.mode, "manual");
    assert.deepEqual(result.pairs, []);
    assert.deepEqual(result.backUnmatched, [0, 1, 2, 3, 4]);
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
