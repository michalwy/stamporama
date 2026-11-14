import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  flatHeaderBoxState,
  groupedHeaderBoxState,
  selectAllOffer,
  selectableMatchingIds,
  type SelectableCandidate,
} from "../../src/lib/select-all";
import { DEFAULT_GROUP_AXES } from "../../src/lib/copy-groups";

/**
 * **Select all on the Copies list** (#2538): the header box ticks what is loaded, then the bar
 * offers every copy matching the filters, naming the count — and in a grouped view "all" follows
 * each group's own box, so an outlier stays out (#398).
 */

function copy(id: string, over: Partial<SelectableCandidate> = {}): SelectableCandidate {
  return {
    id,
    stampId: "s1",
    conditionId: "mnh",
    formatId: null,
    certificateStatusId: null,
    held: true,
    ...over,
  };
}

describe("flatHeaderBoxState", () => {
  it("is ticked when every loaded selectable copy is, partly when some are", () => {
    assert.deepEqual(flatHeaderBoxState(["a", "b"], new Set(["a", "b"])), {
      checked: true,
      partial: false,
    });
    assert.deepEqual(flatHeaderBoxState(["a", "b"], new Set(["a"])), {
      checked: false,
      partial: true,
    });
    assert.deepEqual(flatHeaderBoxState(["a", "b"], new Set()), { checked: false, partial: false });
  });

  it("is never ticked over nothing to tick", () => {
    assert.deepEqual(flatHeaderBoxState([], new Set(["x"])), { checked: false, partial: false });
  });
});

describe("groupedHeaderBoxState", () => {
  it("is ticked only when every group with something to tick is all ticked", () => {
    assert.deepEqual(groupedHeaderBoxState(["all", "all", "empty"]), {
      checked: true,
      partial: false,
    });
    assert.deepEqual(groupedHeaderBoxState(["all", "none"]), { checked: false, partial: true });
    assert.deepEqual(groupedHeaderBoxState(["some", "none"]), { checked: false, partial: true });
    assert.deepEqual(groupedHeaderBoxState(["none", "none"]), { checked: false, partial: false });
    assert.deepEqual(groupedHeaderBoxState(["empty"]), { checked: false, partial: false });
    assert.deepEqual(groupedHeaderBoxState([]), { checked: false, partial: false });
  });
});

describe("selectableMatchingIds", () => {
  it("flat: every matching copy still held, in the order read", () => {
    const ids = selectableMatchingIds(
      [copy("a"), copy("b", { held: false }), copy("c", { stampId: "s2" })],
      [],
      null
    );
    assert.deepEqual(ids, ["a", "c"]);
  });

  it("duplicates: an outlier the group's own box leaves out stays out", () => {
    // Three MNH and one used copy of s1, condition left at *any*: the used one is the outlier.
    const stacks = [
      copy("a"),
      copy("b"),
      copy("c"),
      copy("d", { conditionId: "used" }),
      copy("e", { stampId: "s2" }),
    ];
    assert.deepEqual(selectableMatchingIds(stacks, [], DEFAULT_GROUP_AXES), ["a", "b", "c", "e"]);
  });

  it("duplicates: the outlier is found over held and no-longer-held members alike, as on the row", () => {
    // Two used copies, one of them written off, against one MNH: the MNH is the outlier, because
    // the row's members — the list's own — include the written-off copy when it is shown.
    const stacks = [copy("a"), copy("b", { conditionId: "used" }), copy("c", { conditionId: "used", held: false })];
    assert.deepEqual(selectableMatchingIds(stacks, [], DEFAULT_GROUP_AXES), ["b"]);
  });

  it("duplicates: an axis joined to the key splits the group, so nothing is an outlier on it", () => {
    const stacks = [copy("a"), copy("b"), copy("d", { conditionId: "used" })];
    assert.deepEqual(
      selectableMatchingIds(stacks, [], { ...DEFAULT_GROUP_AXES, condition: true }),
      ["a", "b", "d"]
    );
  });

  it("duplicates: the pieces bucket is taken whole, held pieces only", () => {
    const pieces = [
      copy("p1", { conditionId: null }),
      copy("p2", { conditionId: null, stampId: "s9" }),
      copy("p3", { conditionId: null, held: false }),
    ];
    assert.deepEqual(selectableMatchingIds([copy("a")], pieces, DEFAULT_GROUP_AXES), [
      "a",
      "p1",
      "p2",
    ]);
  });
});

describe("selectAllOffer", () => {
  const matchingIds = ["a", "b", "c"];

  it("offers the rest, with the count, once the header box is ticked", () => {
    assert.deepEqual(
      selectAllOffer({ headerChecked: true, matchingIds, selected: new Set(["a"]) }),
      { kind: "extend", total: 3, missing: ["b", "c"] }
    );
  });

  it("says all once every matching copy is ticked", () => {
    assert.deepEqual(
      selectAllOffer({ headerChecked: true, matchingIds, selected: new Set(["a", "b", "c", "z"]) }),
      { kind: "all", total: 3 }
    );
  });

  it("offers nothing under a hand-made selection or before the count is known", () => {
    assert.deepEqual(
      selectAllOffer({ headerChecked: false, matchingIds, selected: new Set(["a"]) }),
      { kind: "none" }
    );
    assert.deepEqual(
      selectAllOffer({ headerChecked: true, matchingIds: undefined, selected: new Set(["a"]) }),
      { kind: "none" }
    );
  });
});
