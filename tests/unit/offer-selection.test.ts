import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { keptAfterBulkRun, toggleRowsInView } from "../../src/lib/offer-selection";

/**
 * **A filter never unticks anything, and the two writes the offers list makes to its selection are
 * where that goes quietly wrong** (#1031).
 *
 * The narrowing itself is `rows-in-view.test.ts` and is shared. What is pinned here is the pair
 * that was correct only while a filter change threw the whole selection away: *select all* over
 * the loaded rows, and what stays ticked after a bulk run. Both used to reach every ticked offer,
 * and under the rule some of those are rows the collector cannot see.
 *
 * Every case below is written so the wrong reading gives a **different** answer rather than a
 * differently-worded one: five ticked offers, two of them on screen. The wrong *select all* leaves
 * two ticked where the rule leaves five; the wrong retention leaves one where the rule leaves four.
 */
describe("the offers list's writes to a selection that survives a filter (#1031)", () => {
  const offer = (id: string) => ({ id, offerNo: Number(id.slice(1)) });
  const ticked = () =>
    new Map(["o1", "o2", "o3", "o4", "o5"].map((id) => [id, offer(id)] as const));

  describe("select all over the rows in view", () => {
    it("ticks the loaded rows without disturbing the ticks the filter is hiding", () => {
      // o2 and o4 are on screen; o2 is already ticked, o4 is not. Only o4 moves — and the reading
      // that replaced the whole map with the loaded rows would leave exactly {o2, o4} here.
      const selected = new Map([["o2", offer("o2")]] as const);
      const next = toggleRowsInView(selected, [offer("o2"), offer("o4")]);
      assert.deepEqual([...next.keys()].sort(), ["o2", "o4"]);

      const withHidden = new Map([
        ["o1", offer("o1")],
        ["o2", offer("o2")],
      ] as const);
      const kept = toggleRowsInView(withHidden, [offer("o2"), offer("o4")]);
      assert.deepEqual([...kept.keys()].sort(), ["o1", "o2", "o4"]);
    });

    it("unticks only the loaded rows when every one of them is already ticked", () => {
      // The five are ticked and two are on screen. Unticking the box is a control over *here*, so
      // the three the filter is hiding stay. Clearing all five is *Clear*, which says so.
      const next = toggleRowsInView(ticked(), [offer("o2"), offer("o4")]);
      assert.deepEqual([...next.keys()].sort(), ["o1", "o3", "o5"]);
    });

    it("ticks rather than unticks while only some of the rows in view are ticked", () => {
      // The same question the box's own `checked` asks: partial reads as "not all", so the press
      // completes the set rather than emptying it.
      const selected = new Map([["o2", offer("o2")]] as const);
      const next = toggleRowsInView(selected, [offer("o2"), offer("o3"), offer("o4")]);
      assert.deepEqual([...next.keys()].sort(), ["o2", "o3", "o4"]);
    });

    it("does nothing at all with no rows in view", () => {
      // The filter is hiding every ticked offer. An empty `rows` must not read as "all of them are
      // ticked" and untick the lot — `every` over an empty array is `true`, which is the trap.
      const next = toggleRowsInView(ticked(), []);
      assert.deepEqual([...next.keys()].sort(), ["o1", "o2", "o3", "o4", "o5"]);
    });
  });

  describe("what stays ticked after a bulk run", () => {
    it("keeps exactly the refused offers, and the ticks that were never in the batch", () => {
      // Five ticked, two in view, so the batch is {o2, o4}; o2 was refused. o4 went through and
      // goes; o2 stays because it is what is left to deal with; o1, o3 and o5 stay because the run
      // settled nothing about them. Keeping "the refused ones" alone leaves {o2} — one row where
      // the rule leaves four.
      const next = keptAfterBulkRun(ticked(), ["o2", "o4"], ["o2"]);
      assert.deepEqual([...next.keys()].sort(), ["o1", "o2", "o3", "o5"]);
    });

    it("clears the whole batch when nothing was refused", () => {
      const next = keptAfterBulkRun(ticked(), ["o2", "o4"], []);
      assert.deepEqual([...next.keys()].sort(), ["o1", "o3", "o5"]);
    });

    it("leaves the selection whole when every offer in the batch was refused", () => {
      // Nothing happened, so nothing is unticked — the bar goes on offering the same run.
      const next = keptAfterBulkRun(ticked(), ["o2", "o4"], ["o2", "o4"]);
      assert.deepEqual([...next.keys()].sort(), ["o1", "o2", "o3", "o4", "o5"]);
    });

    it("keeps the offers themselves, not just their ids", () => {
      // The skips strip names a row by its `offerNo`, and the row it names has to survive the
      // invalidate-and-refetch that follows the run — and now the filter having moved it off
      // screen as well.
      const next = keptAfterBulkRun(ticked(), ["o2", "o4"], ["o2"]);
      assert.equal(next.get("o2")?.offerNo, 2);
    });
  });
});
