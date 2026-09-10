import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeRelink, type TickedCopy } from "../../src/lib/attach-relink";

/**
 * **The re-link warning is computed over the selection, not over the fetched page** (#1079).
 *
 * The failing case is the issue's own and it is the first test below: a copy ticked under one area
 * and a second ticked after the rail moved. Under the old derivation the first is absent from
 * `copies`, so the warning counted **one** where the truth is two, and with only the second ticked
 * it counted **zero** and hid the checkbox entirely — which is the dead end, since the server then
 * refuses the move citing a confirmation the collector was never offered.
 *
 * Every assertion is written so that the defect gives a different number rather than a differently
 * worded sentence: a summary read off the page would have to know which rows are on screen, and
 * nothing here tells it, which is the point.
 */
describe("the re-link warning over a whole selection (#1079)", () => {
  const tick = (relinkFrom: string | null): TickedCopy => ({ relinkFrom });

  it("counts and names a copy ticked before the area rail moved", () => {
    // c1 was ticked under Poland and is no longer in the fetched page; c2 was ticked under France.
    const selection = new Map<string, TickedCopy>([
      ["c1", tick("Kowalski 2026-01-04")],
      ["c2", tick("Nowak 2026-02-11")],
    ]);
    assert.deepEqual(summarizeRelink(selection), {
      count: 2,
      orders: ["Kowalski 2026-01-04", "Nowak 2026-02-11"],
    });
  });

  it("offers the warning for a lone tick made under an area since left", () => {
    // The dead end exactly: one copy, ticked elsewhere, and the checkbox has to appear for it.
    const selection = new Map<string, TickedCopy>([["c1", tick("Kowalski 2026-01-04")]]);
    assert.equal(summarizeRelink(selection).count, 1);
  });

  it("says nothing when no ticked copy is on another order", () => {
    const selection = new Map<string, TickedCopy>([
      ["c1", tick(null)],
      ["c2", tick(null)],
    ]);
    assert.deepEqual(summarizeRelink(selection), { count: 0, orders: [] });
  });

  it("counts every copy but names each order once", () => {
    // Three copies off two orders: the collector is told *which* two, and the number is still three.
    const selection = new Map<string, TickedCopy>([
      ["c1", tick("Kowalski 2026-01-04")],
      ["c2", tick(null)],
      ["c3", tick("Nowak 2026-02-11")],
      ["c4", tick("Kowalski 2026-01-04")],
    ]);
    assert.deepEqual(summarizeRelink(selection), {
      count: 3,
      orders: ["Kowalski 2026-01-04", "Nowak 2026-02-11"],
    });
  });

  it("names the orders in tick order, which is the order the collector built", () => {
    const selection = new Map<string, TickedCopy>([
      ["c3", tick("Nowak 2026-02-11")],
      ["c1", tick("Kowalski 2026-01-04")],
    ]);
    assert.deepEqual(summarizeRelink(selection).orders, [
      "Nowak 2026-02-11",
      "Kowalski 2026-01-04",
    ]);
  });

  it("answers nothing for an empty selection", () => {
    assert.deepEqual(summarizeRelink(new Map()), { count: 0, orders: [] });
  });

  it("leaves the selection alone — the summary is a reading, never a write", () => {
    const selection = new Map<string, TickedCopy>([["c1", tick("Kowalski 2026-01-04")]]);
    summarizeRelink(selection);
    assert.equal(selection.size, 1);
    assert.deepEqual(selection.get("c1"), { relinkFrom: "Kowalski 2026-01-04" });
  });
});
