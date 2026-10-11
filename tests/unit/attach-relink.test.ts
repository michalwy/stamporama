import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { summarizeRelink, untickOrder, type TickedCopy } from "../../src/lib/attach-relink";

const KOWALSKI = { id: "p1", label: "Kowalski 2026-01-04" };
const NOWAK = { id: "p2", label: "Nowak 2026-02-11" };
const tick = (relinkFrom: { id: string; label: string } | null): TickedCopy => ({ relinkFrom });

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
  it("counts and names a copy ticked before the area rail moved", () => {
    // c1 was ticked under Poland and is no longer in the fetched page; c2 was ticked under France.
    const selection = new Map<string, TickedCopy>([
      ["c1", tick(KOWALSKI)],
      ["c2", tick(NOWAK)],
    ]);
    assert.deepEqual(summarizeRelink(selection), {
      count: 2,
      orders: [
        { ...KOWALSKI, count: 1 },
        { ...NOWAK, count: 1 },
      ],
    });
  });

  it("offers the warning for a lone tick made under an area since left", () => {
    // The dead end exactly: one copy, ticked elsewhere, and the checkbox has to appear for it.
    const selection = new Map<string, TickedCopy>([["c1", tick(KOWALSKI)]]);
    assert.equal(summarizeRelink(selection).count, 1);
  });

  it("says nothing when no ticked copy is on another order", () => {
    const selection = new Map<string, TickedCopy>([
      ["c1", tick(null)],
      ["c2", tick(null)],
    ]);
    assert.deepEqual(summarizeRelink(selection), { count: 0, orders: [] });
  });

  it("names the orders in tick order, which is the order the collector built", () => {
    const selection = new Map<string, TickedCopy>([
      ["c3", tick(NOWAK)],
      ["c1", tick(KOWALSKI)],
    ]);
    assert.deepEqual(
      summarizeRelink(selection).orders.map((o) => o.label),
      [NOWAK.label, KOWALSKI.label]
    );
  });

  it("answers nothing for an empty selection", () => {
    assert.deepEqual(summarizeRelink(new Map()), { count: 0, orders: [] });
  });

  it("leaves the selection alone — the summary is a reading, never a write", () => {
    const selection = new Map<string, TickedCopy>([["c1", tick(KOWALSKI)]]);
    summarizeRelink(selection);
    assert.equal(selection.size, 1);
    assert.deepEqual(selection.get("c1"), { relinkFrom: KOWALSKI });
  });
});

/**
 * **How many come from each order, and leaving one order's copies where they are** (#1770). The
 * issue's case was 442 copies off two orders, with no way to tell the split and no way to untick
 * one order's copies short of finding them one by one.
 */
describe("the re-link warning per order (#1770)", () => {
  it("counts each order's own copies, and the shares add up to the total", () => {
    const selection = new Map<string, TickedCopy>([
      ["c1", tick(KOWALSKI)],
      ["c2", tick(null)],
      ["c3", tick(NOWAK)],
      ["c4", tick(KOWALSKI)],
      ["c5", tick(KOWALSKI)],
    ]);
    const summary = summarizeRelink(selection);
    assert.deepEqual(summary, {
      count: 4,
      orders: [
        { ...KOWALSKI, count: 3 },
        { ...NOWAK, count: 1 },
      ],
    });
    assert.equal(
      summary.orders.reduce((sum, o) => sum + o.count, 0),
      summary.count
    );
  });

  it("keeps two orders apart that share a supplier and a date", () => {
    // The label is what the collector reads, never what the copies are grouped by: two orders from
    // the same dealer on the same day are two lines, each untickable on its own.
    const twin = { id: "p3", label: KOWALSKI.label };
    const selection = new Map<string, TickedCopy>([
      ["c1", tick(KOWALSKI)],
      ["c2", tick(twin)],
    ]);
    assert.deepEqual(
      summarizeRelink(selection).orders.map((o) => [o.id, o.count]),
      [
        ["p1", 1],
        ["p3", 1],
      ]
    );
  });

  it("unticks every copy of one order, on screen or not, and nothing else", () => {
    // c1 was ticked under an area the rail has since left; nothing here knows which rows are on
    // screen, which is the point — the action reaches the whole selection, as the warning counts it.
    const selection = new Map<string, TickedCopy>([
      ["c1", tick(KOWALSKI)],
      ["c2", tick(null)],
      ["c3", tick(NOWAK)],
      ["c4", tick(KOWALSKI)],
    ]);
    const next = untickOrder(selection, KOWALSKI.id);
    assert.deepEqual([...next.keys()], ["c2", "c3"]);
    assert.deepEqual(summarizeRelink(next), { count: 1, orders: [{ ...NOWAK, count: 1 }] });
  });

  it("leaves no warning once the last order is unticked, and keeps the copies on no order", () => {
    const selection = new Map<string, TickedCopy>([
      ["c1", tick(KOWALSKI)],
      ["c2", tick(null)],
      ["c3", tick(NOWAK)],
    ]);
    const next = untickOrder(untickOrder(selection, KOWALSKI.id), NOWAK.id);
    assert.deepEqual([...next.keys()], ["c2"]);
    assert.deepEqual(summarizeRelink(next), { count: 0, orders: [] });
  });

  it("returns a new selection and leaves the one it was given alone", () => {
    const selection = new Map<string, TickedCopy>([["c1", tick(KOWALSKI)]]);
    const next = untickOrder(selection, KOWALSKI.id);
    assert.notEqual(next, selection);
    assert.equal(selection.size, 1);
  });
});
