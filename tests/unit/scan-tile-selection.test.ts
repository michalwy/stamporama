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
  /**
   * **The box is over what the chip is showing, not over what the batch holds** (#863).
   *
   * The batch below is the case that separates the two readings and is the reason it is shaped
   * this way: two waiting pieces and three parked ones, under the *waiting* chip. Every assertion
   * here is written so that computing the box over `batch` unfiltered — which is what the strip
   * did — gives a different answer, not merely a differently-worded one. A batch of one state, or
   * a chip of `all`, would pass either way and prove nothing.
   */
  describe("the batch box under a chip (#863)", () => {
    const batch = [
      tile("w1"),
      tile("p1", "parked"),
      tile("w2"),
      tile("p2", "parked"),
      tile("p3", "parked"),
      tile("c1", "consumed"),
    ];

    it("ticks only what the chip is showing", () => {
      // Unfiltered this is all five outstanding pieces — three of which are not on screen.
      assert.deepEqual(ids(toggleBatch(new Set(), batch, "waiting")), ["w1", "w2"]);
      assert.deepEqual(ids(toggleBatch(new Set(), batch, "parked")), ["p1", "p2", "p3"]);
      // And with no chip pressed it is still the whole batch, so nothing is lost by the filter
      // being a required argument.
      assert.deepEqual(ids(toggleBatch(new Set(), batch, "all")), ["p1", "p2", "p3", "w1", "w2"]);
    });

    it("reads *on* when every square on screen is ticked, not *partial*", () => {
      // The one the collector actually meets: he ticked both squares he can see, and the box
      // above them was still showing a dash because three tiles he is not looking at were not in.
      assert.equal(batchBoxState(new Set(["w1", "w2"]), batch, "waiting"), "on");
      assert.equal(batchBoxState(new Set(["w1", "w2"]), batch, "all"), "partial");
      assert.equal(batchBoxState(new Set(["p1", "p2", "p3"]), batch, "parked"), "on");
    });

    it("says nothing about a tile the chip is hiding — neither ticks it nor unticks it", () => {
      // A press with the waiting pieces already in clears them and leaves the parked ones exactly
      // as the collector left them: he cannot see them, so the press is not about them. Over the
      // whole batch this would have emptied the selection.
      assert.deepEqual(ids(toggleBatch(new Set(["w1", "w2", "p1"]), batch, "waiting")), ["p1"]);
      // And filling a half-ticked strip adds only what is on screen.
      assert.deepEqual(ids(toggleBatch(new Set(["w1"]), batch, "waiting")), ["w1", "w2"]);
    });

    it("is off on a batch whose only outstanding tiles are hidden", () => {
      // Nothing on screen can take an identification, so there is no box — which is what keeps it
      // honest: over the whole batch this reads *on*, a box claiming to have selected a strip that
      // shows no square with a box of its own.
      const parkedOnly = [tile("p1", "parked"), tile("c1", "consumed")];
      assert.equal(batchBoxState(new Set(["p1"]), parkedOnly, "waiting"), "off");
      assert.equal(batchBoxState(new Set(["p1"]), parkedOnly, "all"), "on");
    });

    it("draws no box over the pull list, whatever is ticked", () => {
      // Every tile the discards chip shows has reached an end and can take no identification, so
      // the strip beneath offers no boxes and this one has nothing to stand for (#853).
      assert.equal(batchBoxState(new Set(["w1", "w2"]), batch, "discarded"), "off");
      assert.deepEqual(ids(toggleBatch(new Set(["w1"]), batch, "discarded")), ["w1"]);
    });
  });

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
    assert.deepEqual(ids(toggleBatch(new Set(), batch, "all")), ["p1", "p2"]);
    assert.equal(batchBoxState(new Set(["p1", "p2"]), batch, "all"), "on");
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
      assert.equal(batchBoxState(new Set(), batch, "all"), "off");
      assert.equal(batchBoxState(new Set(["t1"]), batch, "all"), "partial");
      // The consumed tile is not in the question at all, so both waiting tiles is *on*.
      assert.equal(batchBoxState(new Set(["t1", "t2"]), batch, "all"), "on");
    });

    it("is off on a batch with nothing left waiting", () => {
      assert.equal(batchBoxState(new Set(), [tile("t3", "consumed")], "all"), "off");
    });

    it("ticks what is beneath it, and skips what cannot be identified", () => {
      assert.deepEqual(ids(toggleBatch(new Set(), batch, "all")), ["t1", "t2"]);
    });

    it("fills a half-ticked batch rather than clearing it, and clears a full one", () => {
      assert.deepEqual(ids(toggleBatch(new Set(["t1"]), batch, "all")), ["t1", "t2"]);
      assert.deepEqual(ids(toggleBatch(new Set(["t1", "t2"]), batch, "all")), []);
    });

    it("leaves tiles of other batches alone", () => {
      assert.deepEqual(ids(toggleBatch(new Set(["other"]), batch, "all")), ["other", "t1", "t2"]);
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
