import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rowsInView, sameRowIds, selectionInView } from "../../src/lib/rows-in-view";

/**
 * **The bar counts and acts on the ticked rows in view, and the hidden ones stay ticked** (#1021),
 * on the list that cannot answer *in view* as a predicate.
 *
 * The Copies list's filters are resolved server-side, so what stands in for the predicate is the
 * rows the screen holds: its flat pages, plus the members each group row has fetched. That is what
 * these pin. What no unit test here can see is *who reports* — that a folded group still does, and
 * that the register is dropped when the filter set changes — because both live in the hook and in
 * which effect runs when; `use-rows-in-view.ts` carries the reasoning beside the code.
 *
 * The case below is the one that separates the three readings and every assertion is written so
 * that the two wrong ones give a **different** answer rather than a differently-worded one: five
 * ticked copies, two of them on screen. Acting on the whole selection gives five; discarding the
 * selection on a filter change — which is what this list used to do — gives none at all; the rule
 * gives two to act on and five still ticked.
 */
describe("the ticked rows in view (#1021)", () => {
  const copy = (id: string) => ({ id });
  const ticked = ["c1", "c2", "c3", "c4", "c5"].map(copy);

  it("counts the ticked rows the screen is holding, and no others", () => {
    const inView = rowsInView([["c2", "c4"]]);
    assert.deepEqual(
      selectionInView(ticked, inView).map((c) => c.id),
      ["c2", "c4"]
    );
  });

  it("leaves the selection itself alone, which is the half #853 is about", () => {
    // The narrowing is a view: the same five go in, the same five are still there afterwards, and
    // releasing the filter shows them again. A reading that unticked the hidden three would leave
    // two here.
    const inView = rowsInView([["c2", "c4"]]);
    const shown = selectionInView(ticked, inView);
    assert.equal(shown.length, 2);
    assert.equal(ticked.length, 5);
    assert.deepEqual(
      selectionInView(ticked, rowsInView([ticked.map((c) => c.id)])).map((c) => c.id),
      ["c1", "c2", "c3", "c4", "c5"]
    );
  });

  it("keeps the order the rows were ticked in", () => {
    // The order copies reach a bulk edit or an offer composition in is the collector's, not the
    // reporter's — so it comes off the selection and never off the report.
    const inView = rowsInView([["c5", "c1"]]);
    assert.deepEqual(
      selectionInView(ticked, inView).map((c) => c.id),
      ["c1", "c5"]
    );
  });

  it("unions overlapping reports rather than concatenating them", () => {
    // A screen may report its flat pages and a group's members in one breath, and the same copy can
    // legitimately be in both.
    const inView = rowsInView([["c1", "c2"], ["c2", "c3"], []]);
    assert.deepEqual([...inView].sort(), ["c1", "c2", "c3"]);
    assert.equal(selectionInView(ticked, inView).length, 3);
  });

  it("shows nothing when nothing is reported, and does not mistake that for everything", () => {
    // The state the bar draws as `0 of 5`: every ticked copy hidden, all five still ticked. An
    // empty register must never read as "no narrowing in force".
    const inView = rowsInView([]);
    assert.deepEqual(selectionInView(ticked, inView), []);
    assert.equal(ticked.length, 5);
  });

  it("tells an unchanged report from a changed one, including a reorder", () => {
    assert.equal(sameRowIds(["a", "b"], ["a", "b"]), true);
    assert.equal(sameRowIds(["a", "b"], ["b", "a"]), false);
    assert.equal(sameRowIds(["a"], ["a", "b"]), false);
    assert.equal(sameRowIds([], []), true);
  });
});
