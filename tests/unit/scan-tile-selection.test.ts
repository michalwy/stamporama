import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  batchBoxState,
  isSelectableTile,
  pruneSelection,
  selectedInOrder,
  toggleBatch,
  toggleTile,
  type SelectableTile,
} from "../../src/lib/scan-tile-selection";

/** A tile as the selection sees one: an id and whether it is still waiting. */
const tile = (id: string, state = "unidentified"): SelectableTile => ({ id, state });

const ids = (set: ReadonlySet<string>) => [...set].sort();

describe("scan tile selection (#596)", () => {
  it("offers a box only on a tile that can still be identified", () => {
    assert.equal(isSelectableTile(tile("t1")), true);
    assert.equal(isSelectableTile(tile("t2", "consumed")), false);
    assert.equal(isSelectableTile(tile("t3", "discarded")), false);
    // A parked tile (#597) is still to be identified — and the sitting it is settled in is exactly
    // the one where several turn out to be the same variant, so it must be tickable.
    assert.equal(isSelectableTile(tile("t4", "parked")), true);
  });

  it("ticks a run of parked tiles together, which is what the return sitting is (#597)", () => {
    const batch = [tile("p1", "parked"), tile("p2", "parked"), tile("t3", "discarded")];
    assert.deepEqual(ids(toggleBatch(new Set(), batch)), ["p1", "p2"]);
    assert.equal(batchBoxState(new Set(["p1", "p2"]), batch), "on");
    // And a parked tile survives pruning, unlike one that has reached an end.
    assert.deepEqual(ids(pruneSelection(new Set(["p1", "t3"]), batch)), ["p1"]);
  });

  it("ticks and unticks one tile", () => {
    const one = toggleTile(new Set(), "t1");
    assert.deepEqual(ids(one), ["t1"]);
    assert.deepEqual(ids(toggleTile(one, "t2")), ["t1", "t2"]);
    assert.deepEqual(ids(toggleTile(one, "t1")), []);
  });

  describe("the batch box", () => {
    const batch = [tile("t1"), tile("t2"), tile("t3", "consumed")];

    it("is off, partial and on against the tiles still waiting — never against every tile", () => {
      assert.equal(batchBoxState(new Set(), batch), "off");
      assert.equal(batchBoxState(new Set(["t1"]), batch), "partial");
      // The consumed tile is not in the question at all, so both waiting tiles is *on*.
      assert.equal(batchBoxState(new Set(["t1", "t2"]), batch), "on");
    });

    it("is off on a batch with nothing left waiting", () => {
      assert.equal(batchBoxState(new Set(), [tile("t3", "consumed")]), "off");
    });

    it("ticks what is beneath it, and skips what cannot be identified", () => {
      assert.deepEqual(ids(toggleBatch(new Set(), batch)), ["t1", "t2"]);
    });

    it("fills a half-ticked batch rather than clearing it, and clears a full one", () => {
      assert.deepEqual(ids(toggleBatch(new Set(["t1"]), batch)), ["t1", "t2"]);
      assert.deepEqual(ids(toggleBatch(new Set(["t1", "t2"]), batch)), []);
    });

    it("leaves tiles of other batches alone", () => {
      assert.deepEqual(ids(toggleBatch(new Set(["other"]), batch)), ["other", "t1", "t2"]);
    });
  });

  describe("pruning", () => {
    it("drops a tile that has since been identified, discarded or re-cut away", () => {
      const selected = new Set(["t1", "t2", "t3"]);
      assert.deepEqual(ids(pruneSelection(selected, [tile("t1"), tile("t2", "consumed")])), ["t1"]);
    });

    it("keeps a selection that is still entirely on screen", () => {
      const selected = new Set(["t1", "t2"]);
      assert.deepEqual(ids(pruneSelection(selected, [tile("t1"), tile("t2")])), ["t1", "t2"]);
    });
  });

  it("hands the ticked tiles back in the order the card is laid out in", () => {
    const tiles = [tile("t1"), tile("t2", "consumed"), tile("t3"), tile("t4")];
    assert.deepEqual(
      selectedInOrder(new Set(["t4", "t3", "t2"]), tiles).map((t) => t.id),
      ["t3", "t4"]
    );
  });
});
