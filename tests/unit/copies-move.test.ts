import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  closedLotsMessage,
  filterCopiesMoveTargets,
  summarizeCopiesMove,
} from "../../src/lib/copies-move";

// What *Move copies to…* (#2123) says before anything moves.

describe("summarizeCopiesMove (#2123)", () => {
  it("counts the copies of every lot holding some, in order", () => {
    const s = summarizeCopiesMove([
      { id: "a", label: "Lot 1", status: "open", itemCount: 3 },
      { id: "b", label: "Empty", status: "open", itemCount: 0 },
      { id: "c", label: "Album", status: "open", itemCount: 2 },
    ]);
    assert.equal(s.total, 5);
    assert.deepEqual(s.from, [
      { label: "Lot 1", count: 3 },
      { label: "Album", count: 2 },
    ]);
    assert.deepEqual(s.closed, []);
  });

  it("names the closed lots holding copies, and ignores an empty closed one", () => {
    const s = summarizeCopiesMove([
      { id: "a", label: "Shut", status: "closed", itemCount: 1 },
      { id: "b", label: "Shut empty", status: "closed", itemCount: 0 },
    ]);
    assert.deepEqual(s.closed, ["Shut"]);
  });
});

describe("closedLotsMessage (#2123)", () => {
  it("says what to reopen, one lot or several", () => {
    assert.match(closedLotsMessage(["Lot 2"]), /^Lot 2 is closed.*Reopen it/);
    assert.match(closedLotsMessage(["A", "B"]), /: A, B\. Reopen them/);
  });
});

describe("filterCopiesMoveTargets (#2123)", () => {
  const docs = [
    { ref: "Order #12", name: "Allegro seller", purchasedAt: "2026-03-01" },
    { ref: "Opening balance #3", name: "Klaser Polska", purchasedAt: "2025-12-31" },
    { ref: "Order #7", name: null, purchasedAt: "2026-01-15" },
  ];
  it("matches every word against the number, name and date", () => {
    assert.deepEqual(filterCopiesMoveTargets(docs, "#12").map((d) => d.ref), ["Order #12"]);
    assert.deepEqual(filterCopiesMoveTargets(docs, "klaser opening").map((d) => d.ref), [
      "Opening balance #3",
    ]);
    assert.deepEqual(filterCopiesMoveTargets(docs, "2026").length, 2);
    assert.equal(filterCopiesMoveTargets(docs, "  ").length, 3);
    assert.equal(filterCopiesMoveTargets(docs, "nothing").length, 0);
  });
});
