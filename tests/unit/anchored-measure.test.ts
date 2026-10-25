import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { measureNaturalSize, type MeasurableBox } from "../../src/app/anchored-placement";

// An open multi-select whose options did not fit jumped back to the top a moment after it was
// scrolled (#2155): the menu is measured again on every resize and scroll, and the measurement lifts
// its height cut, which lets the list grow until there is nothing to scroll — so the browser clamps
// the list's `scrollTop` to 0, and putting the cut back does not undo that.

/** A scrolling element that behaves as a browser lays it out: a scroll position it has no room
 * for is clamped. */
class FakeScroller {
  private top = 0;
  constructor(
    private readonly room: () => number,
    public scrollLeft = 0
  ) {}
  get scrollTop() {
    return this.top;
  }
  set scrollTop(v: number) {
    this.top = Math.max(0, Math.min(v, this.room()));
  }
  /** What a layout does to it: the position it can no longer have is lost. */
  relayout() {
    this.scrollTop = this.top;
  }
}

/** The filter menu's shape: a box cut to `cut` px, holding a checklist `content` px tall that
 * scrolls inside it. */
function filterMenu(content: number, cut: number) {
  const style = { maxHeight: `${cut}px` };
  const height = () => (style.maxHeight === "none" ? content : Math.min(content, cut));
  const list = new FakeScroller(() => content - height());
  const box: MeasurableBox = {
    style,
    get offsetWidth() {
      list.relayout();
      return 220;
    },
    get offsetHeight() {
      list.relayout();
      return height();
    },
    scrollTop: 0,
    scrollLeft: 0,
    querySelectorAll: () => [list],
  };
  return { box, list };
}

describe("measureNaturalSize", () => {
  it("reads the natural size with the cut lifted, and puts the cut back", () => {
    const { box } = filterMenu(600, 320);
    assert.deepEqual(measureNaturalSize(box), { width: 220, height: 600 });
    assert.equal(box.style.maxHeight, "320px");
  });

  it("leaves a list scrolled to its last options where it was", () => {
    const { box, list } = filterMenu(600, 320);
    list.scrollTop = 280;
    assert.equal(list.scrollTop, 280);
    measureNaturalSize(box);
    assert.equal(list.scrollTop, 280);
  });

  it("keeps a horizontal scroll and the box's own scroll too", () => {
    const { box, list } = filterMenu(600, 320);
    list.scrollTop = 120;
    list.scrollLeft = 40;
    box.scrollTop = 15;
    measureNaturalSize(box);
    assert.equal(list.scrollTop, 120);
    assert.equal(list.scrollLeft, 40);
    assert.equal(box.scrollTop, 15);
  });

  it("measured again and again, as on every resize, never moves the list", () => {
    const { box, list } = filterMenu(900, 320);
    list.scrollTop = 580;
    for (let i = 0; i < 5; i++) measureNaturalSize(box);
    assert.equal(list.scrollTop, 580);
  });
});
