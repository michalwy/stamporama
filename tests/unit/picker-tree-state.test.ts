import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_PICKER_TREE_STATE,
  MAX_EXPANDED,
  parsePickerTreeState,
  serializePickerTreeState,
  setBranchOpen,
  setIssueExpanded,
  setLastPickedIssue,
} from "../../src/lib/picker-tree-state";

const roundTrip = (raw: string | null) => parsePickerTreeState(raw);

describe("parsePickerTreeState (#1616)", () => {
  it("reads nothing stored as everything folded", () => {
    assert.deepEqual(roundTrip(null), EMPTY_PICKER_TREE_STATE);
    assert.deepEqual(roundTrip(""), EMPTY_PICKER_TREE_STATE);
  });

  it("degrades storage from an older build to everything folded rather than throwing", () => {
    for (const raw of ["not json", "[]", "42", "null", '"x"', '{"expanded":"i1"}']) {
      assert.deepEqual(roundTrip(raw).expanded, [], raw);
    }
  });

  it("drops what is not the expected shape, field by field", () => {
    const state = roundTrip(
      JSON.stringify({
        expanded: ["i1", 7, "", "i2", "i1"],
        branches: { i1: { c1: true, c2: "yes", none: false }, i9: { c1: true }, i2: [] },
        lastPickedIssueId: 3,
      })
    );
    assert.deepEqual(state.expanded, ["i1", "i2"]);
    // i9 is not expanded, so its branches have nothing to hang on.
    assert.deepEqual(state.branches, { i1: { c1: true, none: false } });
    assert.equal(state.lastPickedIssueId, null);
  });

  it("round-trips what it serialises", () => {
    let state = setIssueExpanded(EMPTY_PICKER_TREE_STATE, "i1", true);
    state = setBranchOpen(state, "i1", "c1", true);
    state = setLastPickedIssue(state, "i1");
    assert.deepEqual(roundTrip(serializePickerTreeState(state)), state);
  });

  it("stores the empty state as nothing", () => {
    assert.equal(serializePickerTreeState(EMPTY_PICKER_TREE_STATE), "");
    const folded = setIssueExpanded(setIssueExpanded(EMPTY_PICKER_TREE_STATE, "i1", true), "i1", false);
    assert.equal(serializePickerTreeState(folded), "");
  });
});

describe("setIssueExpanded", () => {
  it("expands an issue once, most recent last", () => {
    let state = setIssueExpanded(EMPTY_PICKER_TREE_STATE, "i1", true);
    state = setIssueExpanded(state, "i2", true);
    state = setIssueExpanded(state, "i1", true);
    assert.deepEqual(state.expanded, ["i2", "i1"]);
  });

  it("forgets an issue's branches when it is folded", () => {
    let state = setIssueExpanded(EMPTY_PICKER_TREE_STATE, "i1", true);
    state = setBranchOpen(state, "i1", "c1", true);
    state = setIssueExpanded(state, "i1", false);
    assert.deepEqual(state.expanded, []);
    assert.deepEqual(state.branches, {});
    // Opened again, it starts folded inside, as it always has.
    state = setIssueExpanded(state, "i1", true);
    assert.deepEqual(state.branches, {});
  });

  it("folds the least recently expanded issue past the cap, branches and all", () => {
    let state = EMPTY_PICKER_TREE_STATE;
    for (let i = 0; i < MAX_EXPANDED; i++) state = setIssueExpanded(state, `i${i}`, true);
    state = setBranchOpen(state, "i0", "c1", true);
    state = setBranchOpen(state, "i1", "c1", true);
    state = setIssueExpanded(state, "new", true);
    assert.equal(state.expanded.length, MAX_EXPANDED);
    assert.equal(state.expanded.includes("i0"), false);
    assert.equal(state.expanded.at(-1), "new");
    assert.deepEqual(Object.keys(state.branches), ["i1"]);
  });

  it("caps on read too, keeping the most recent", () => {
    const expanded = Array.from({ length: MAX_EXPANDED + 5 }, (_, i) => `i${i}`);
    const state = roundTrip(JSON.stringify({ expanded }));
    assert.equal(state.expanded.length, MAX_EXPANDED);
    assert.equal(state.expanded[0], "i5");
  });
});

describe("setBranchOpen", () => {
  it("remembers a branch opened or closed by hand on an expanded issue", () => {
    let state = setIssueExpanded(EMPTY_PICKER_TREE_STATE, "i1", true);
    state = setBranchOpen(state, "i1", "c1", true);
    state = setBranchOpen(state, "i1", "none", false);
    assert.deepEqual(state.branches, { i1: { c1: true, none: false } });
  });

  it("leaves a branch of a folded issue alone", () => {
    const state = setBranchOpen(EMPTY_PICKER_TREE_STATE, "i1", "c1", true);
    assert.equal(state, EMPTY_PICKER_TREE_STATE);
  });
});

describe("setLastPickedIssue", () => {
  it("remembers the issue last picked from, whether or not it is expanded", () => {
    const state = setLastPickedIssue(EMPTY_PICKER_TREE_STATE, "i7");
    assert.equal(state.lastPickedIssueId, "i7");
    assert.deepEqual(state.expanded, []);
    assert.equal(setLastPickedIssue(state, "i7"), state);
  });
});
