import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { countHiddenTicks, hiddenTicksSuffix } from "../../src/lib/picker-hidden-ticks";

/**
 * **A picker keeps the whole selection and says how many rows are hidden** (#1046) — the far side
 * of the list rule these same tests exist for one file over (`rows-in-view.test.ts`).
 *
 * The case below is the issue's own: seven ticked, three of them hidden. Every assertion is written
 * so that the two answers the user did **not** take give a different number rather than a
 * differently-worded one. Narrowing the submit to what is shown (answer 1) would hand four ids to
 * the action; exempting the picker silently (answer 2) would leave the label at a bare seven. The
 * decision gives seven submitted and a three on the button.
 */
describe("a picker's hidden ticks (#1046)", () => {
  const ticked = ["c1", "c2", "c3", "c4", "c5", "c6", "c7"];
  // Poland is on screen; the three ticked under the previous search are not.
  const inView = new Set(["c1", "c2", "c3", "c4", "x8", "x9"]);

  it("counts the ticked rows the filters are keeping off screen", () => {
    assert.equal(countHiddenTicks(ticked, inView), 3);
  });

  it("counts nothing hidden when every tick is on screen", () => {
    assert.equal(countHiddenTicks(["c1", "c2"], inView), 0);
  });

  it("counts a tick the server is no longer sending, not only one a search hid", () => {
    // The area rail is resolved server-side, so a tick made under another area is absent from the
    // fetched list entirely. It is hidden by exactly the same subtraction.
    assert.equal(countHiddenTicks(["c1", "gone-with-the-area"], inView), 1);
  });

  it("leaves the selection alone — the count is a reading, never a write", () => {
    countHiddenTicks(ticked, inView);
    assert.deepEqual(ticked, ["c1", "c2", "c3", "c4", "c5", "c6", "c7"]);
  });

  it("says how many are hidden, on the button that will add them anyway", () => {
    assert.equal(hiddenTicksSuffix(3), " (3 hidden by these filters)");
    assert.equal(hiddenTicksSuffix(1), " (1 hidden by these filters)");
  });

  it("says nothing at all when nothing is hidden", () => {
    // The user's own addition to the decision: `Add 7 (0 hidden)` is noise on every ordinary use.
    assert.equal(hiddenTicksSuffix(0), "");
  });

  it("appends to a label rather than replacing it, so the verb survives", () => {
    const hidden = countHiddenTicks(ticked, inView);
    assert.equal(`Add ${ticked.length} copies${hiddenTicksSuffix(hidden)}`, "Add 7 copies (3 hidden by these filters)");
  });
});
