import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addStampsToRows,
  inAdditionOrder,
  rowsInTickOrder,
} from "../../src/lib/item-stamp-additions";

// Several stamps ticked in the picker, added to a piece's list in one action (#2352). Pinned: they
// land in catalogue order after the rows already there, each quantity 1 and single, and a stamp
// already on the piece as a single raises that row's quantity instead of adding a second row.

const row = (stampId: string, quantity = 1, formatId = "") => ({ stampId, quantity, formatId });
const newRow = (p: { stampId: string }) => row(p.stampId);

describe("inAdditionOrder", () => {
  it("puts the ticks in catalogue order, number-less last, ties in tick order", () => {
    const ordered = inAdditionOrder([
      { stampId: "none", catalogSortKey: null },
      { stampId: "c", catalogSortKey: "0000000300" },
      { stampId: "a", catalogSortKey: "0000000100" },
      { stampId: "tie2", catalogSortKey: "0000000200" },
      { stampId: "tie1", catalogSortKey: "0000000200" },
      { stampId: "absent" },
    ]);
    assert.deepEqual(
      ordered.map((p) => p.stampId),
      ["a", "tie2", "tie1", "c", "none", "absent"]
    );
  });
});

describe("addStampsToRows", () => {
  it("appends each new stamp as quantity 1, single, after the rows already listed", () => {
    const rows = [row("x", 2, "blk4")];
    const next = addStampsToRows(
      rows,
      [
        { stampId: "b", catalogSortKey: "0000000020" },
        { stampId: "a", catalogSortKey: "0000000010" },
      ],
      newRow
    );
    assert.deepEqual(next, [row("x", 2, "blk4"), row("a"), row("b")]);
    assert.deepEqual(rows, [row("x", 2, "blk4")], "the rows passed in are left alone");
  });

  it("raises the quantity of a stamp already on the piece as a single", () => {
    const next = addStampsToRows([row("a", 2), row("b")], [{ stampId: "a" }], newRow);
    assert.deepEqual(next, [row("a", 3), row("b")]);
  });

  it("adds a single beside the same stamp listed only in another format", () => {
    const next = addStampsToRows([row("a", 1, "blk4")], [{ stampId: "a" }], newRow);
    assert.deepEqual(next, [row("a", 1, "blk4"), row("a")]);
  });

  it("adds nothing for nothing ticked", () => {
    assert.deepEqual(addStampsToRows([row("a")], [], newRow), [row("a")]);
  });
});

// *Identify as a piece* (#2401): the ticks become the list in the order ticked, the first leading;
// a stamp already listed keeps its rows as they are, and an unticked one comes off.
describe("rowsInTickOrder", () => {
  it("lists new ticks as singles of quantity 1 in the order ticked, whatever the catalogue says", () => {
    const next = rowsInTickOrder(
      [],
      [
        { stampId: "c", catalogSortKey: "0000000300" },
        { stampId: "a", catalogSortKey: "0000000100" },
      ],
      newRow
    );
    assert.deepEqual(next, [row("c"), row("a")]);
  });

  it("keeps every row of a stamp still ticked, quantities and formats included", () => {
    const rows = [row("a", 3), row("b", 1, "pair"), row("b")];
    const next = rowsInTickOrder(rows, [{ stampId: "b" }, { stampId: "a" }, { stampId: "n" }], newRow);
    assert.deepEqual(next, [row("b", 1, "pair"), row("b"), row("a", 3), row("n")]);
  });

  it("drops the rows of a stamp no longer ticked, and a stamp ticked twice once", () => {
    const rows = [row("a"), row("b", 2)];
    const next = rowsInTickOrder(rows, [{ stampId: "b" }, { stampId: "b" }], newRow);
    assert.deepEqual(next, [row("b", 2)]);
  });
});
