import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { placeAnchored } from "../../src/app/anchored-placement";

// Every menu and popover opened from a control fits inside the window (#1765). The case that broke
// was a long `⋮` menu on an auction lot row near the bottom of the window: it opened downwards past
// the edge, and the page scrolling under a fixed box closes it, so the last items could not be
// reached at all.

const viewport = { width: 1200, height: 800 };
const row = (top: number) => ({ top, bottom: top + 30, left: 1100, right: 1130 });

/** Inside the window, with the default 8px margin, at the height it is drawn. */
function assertInside(p: ReturnType<typeof placeAnchored>, size: { width: number; height: number }) {
  const drawn = Math.min(size.height, p.maxHeight);
  assert.ok(p.top >= 8, `top ${p.top} above the window`);
  assert.ok(p.top + drawn <= viewport.height - 8, `bottom ${p.top + drawn} below the window`);
  assert.ok(p.left >= 8, `left ${p.left} off the window`);
  assert.ok(p.left + Math.min(size.width, p.maxWidth) <= viewport.width - 8, "right off the window");
}

describe("placeAnchored", () => {
  it("opens below the control when it fits there", () => {
    const size = { width: 200, height: 300 };
    const p = placeAnchored({ anchor: row(100), size, viewport, align: "end" });
    assert.equal(p.top, 134);
    assert.equal(p.left, 930);
    assertInside(p, size);
  });

  it("opens above a row near the bottom of the window, whole", () => {
    const size = { width: 200, height: 400 };
    const p = placeAnchored({ anchor: row(700), size, viewport, align: "end" });
    assert.equal(p.top, 700 - 4 - 400);
    assert.ok(p.maxHeight >= 400, "a menu with room above is not cut");
    assertInside(p, size);
  });

  it("scrolls inside itself when neither side holds it, on the side with more room", () => {
    const size = { width: 200, height: 1000 };
    const low = placeAnchored({ anchor: row(500), size, viewport });
    assert.equal(low.top, 8, "above, from the window's top edge");
    assert.equal(low.maxHeight, 500 - 4 - 8);
    assertInside(low, size);

    const high = placeAnchored({ anchor: row(200), size, viewport });
    assert.equal(high.top, 234, "below, under the control");
    assert.equal(high.maxHeight, 800 - 230 - 4 - 8);
    assertInside(high, size);
  });

  it("stays below when it does not fit but below is still the roomier side", () => {
    const p = placeAnchored({ anchor: row(300), size: { width: 200, height: 600 }, viewport });
    assert.equal(p.top, 334);
    assert.equal(p.maxHeight, 800 - 330 - 12);
  });

  it("keeps to the window's edges horizontally", () => {
    const size = { width: 300, height: 100 };
    const right = placeAnchored({
      anchor: { top: 100, bottom: 130, left: 1100, right: 1190 },
      size,
      viewport,
      align: "start",
    });
    assert.equal(right.left, 1200 - 8 - 300, "slid left from a trigger near the right edge");

    const left = placeAnchored({
      anchor: { top: 100, bottom: 130, left: 2, right: 40 },
      size,
      viewport,
      align: "end",
    });
    assert.equal(left.left, 8, "slid right from a trigger near the left edge");

    const wide = placeAnchored({ anchor: row(100), size: { width: 2000, height: 100 }, viewport });
    assert.equal(wide.left, 8);
    assert.equal(wide.maxWidth, 1200 - 16);
  });

  it("keeps a ceiling of its own, and decides the side by the height it will be drawn at", () => {
    // 600 natural, capped at 320: fits the 330 below, so it stays below although 600 would not.
    const p = placeAnchored({
      anchor: { top: 430, bottom: 458, left: 100, right: 300 },
      size: { width: 200, height: 600 },
      viewport,
      maxHeight: 320,
    });
    assert.equal(p.top, 462);
    assert.equal(p.maxHeight, 320);
  });

  it("sets a panel beside a sidebar control, inside the window vertically", () => {
    const size = { width: 352, height: 500 };
    const p = placeAnchored({
      anchor: { top: 600, bottom: 630, left: 200, right: 230 },
      size,
      viewport,
      side: "right",
    });
    assert.equal(p.left, 234);
    assert.equal(p.top, 800 - 8 - 500, "lifted so its bottom stays in the window");
    assert.equal(p.maxHeight, 800 - 16);
    assertInside(p, size);
  });

  it("never asks for a negative height in a window too short for anything", () => {
    const p = placeAnchored({
      anchor: { top: 0, bottom: 30, left: 0, right: 30 },
      size: { width: 100, height: 100 },
      viewport: { width: 300, height: 30 },
    });
    assert.ok(p.maxHeight >= 0);
  });
});
