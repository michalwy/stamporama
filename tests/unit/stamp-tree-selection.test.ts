import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  carriedByTick,
  descendantsAmongMembers,
  describeStampSelection,
  existingTicks,
  selectionReach,
  stampIdsInTree,
  toggleStampTick,
  type StampSelectionAnswer,
} from "../../src/lib/stamp-tree-selection";

/**
 * Multi-select on the stamp tree (#808). The tree is Infla's `309 → 309A → 309AP → 309APa`, with a
 * plate flaw `309 I` filed under `309` as a distinct entry, and `310` beside it as a leaf.
 *
 * What is at risk is the rule ADR-0048 §7 ties the selection to: **a tick carries the whole subtree**,
 * variant or distinct entry, at any depth. So the assertions are written where a reading that stopped
 * at depth one, or that skipped the distinct entry, gives a different number rather than the same one.
 */
const MEMBERS = [
  { stampId: "309", parentId: null },
  { stampId: "309A", parentId: "309" },
  { stampId: "309AP", parentId: "309A" },
  { stampId: "309APa", parentId: "309AP" },
  { stampId: "309 I", parentId: "309" },
  { stampId: "310", parentId: null },
];

const SUBTREES = {
  "309": ["309A", "309AP", "309APa", "309 I"],
  "309A": ["309AP", "309APa"],
  "309AP": ["309APa"],
  "309APa": [],
  "309 I": [],
  "310": [],
};

describe("stamp tree selection (#808)", () => {
  it("reports every stamp a tree is drawing, folded or not", () => {
    type N = { node: { stampId: string }; children: N[] };
    const n = (stampId: string, children: N[] = []): N => ({ node: { stampId }, children });
    const tree = [n("309", [n("309A", [n("309AP")]), n("309 I")]), n("310")];
    assert.deepEqual(stampIdsInTree(tree), ["309", "309A", "309AP", "309 I", "310"]);
  });

  it("finds a parent's descendants among the members at any depth, distinct entries included", () => {
    assert.deepEqual(
      new Set(descendantsAmongMembers(MEMBERS, "309")),
      new Set(["309A", "309AP", "309APa", "309 I"])
    );
    assert.deepEqual(descendantsAmongMembers(MEMBERS, "309AP"), ["309APa"]);
    assert.deepEqual(descendantsAmongMembers(MEMBERS, "310"), []);
  });

  it("reaches a ticked umbrella's whole subtree, counting each stamp once", () => {
    // `309` and `309AP` ticked: `309AP`'s subtree is inside `309`'s, so the reach is five, not seven.
    const reach = selectionReach(["309", "309AP"], SUBTREES);
    assert.deepEqual(reach, new Set(["309", "309A", "309AP", "309APa", "309 I"]));
    assert.equal(selectionReach(["309A", "310"], SUBTREES)?.size, 4);
  });

  it("states no reach while the server has not answered for one of the ticks", () => {
    assert.equal(selectionReach(["309", "311"], SUBTREES), null);
    assert.equal(selectionReach(["309"], undefined), null);
  });

  it("draws the stamps below a tick as carried, and never the tick itself unless it is below one", () => {
    const carried = carriedByTick(["309A", "310"], SUBTREES);
    assert.deepEqual(carried, new Set(["309AP", "309APa"]));
    assert.equal(carried.has("309A"), false);
    assert.equal(carriedByTick(["309", "309AP"], SUBTREES).has("309AP"), true);
  });

  it("absorbs the ticks below a parent when the parent is ticked, and unticks only itself", () => {
    const withChild = new Set(["309AP", "310"]);
    const parent = toggleStampTick(withChild, "309", descendantsAmongMembers(MEMBERS, "309"));
    assert.deepEqual(parent, new Set(["309", "310"]));
    // Unticking the parent clears the branch, because nothing below it is still standing.
    assert.deepEqual(toggleStampTick(parent, "309", []), new Set(["310"]));
    // The input is never mutated.
    assert.deepEqual(withChild, new Set(["309AP", "310"]));
  });

  it("prunes only a tick the server was asked about and did not find — never one merely hidden", () => {
    const answer: StampSelectionAnswer = {
      asked: ["309", "gone"],
      existingIds: ["309"],
      subtrees: { "309": SUBTREES["309"] },
    };
    // `gone` was asked and is absent; `310` was ticked after the question and is kept.
    assert.deepEqual(existingTicks(["309", "gone", "310"], answer), ["309", "310"]);
    assert.deepEqual(existingTicks(["309", "gone"], undefined), ["309", "gone"]);
  });

  it("words the bar in ticks, reach and hidden ticks", () => {
    const resting = describeStampSelection(2, 2, 6);
    assert.equal(resting.headline, "2 stamps selected");
    assert.equal(resting.reach, "6 with their variants and child stamps");
    assert.equal(resting.hidden, null);
    assert.equal(resting.clearHint, "");

    // No reach phrase when the ticks carry nothing, or before the answer is in.
    assert.equal(describeStampSelection(1, 1, 1).reach, null);
    assert.equal(describeStampSelection(1, 1, null).reach, null);
    assert.equal(describeStampSelection(1, 1, null).headline, "1 stamp selected");

    const filtered = describeStampSelection(5, 2, 4);
    assert.equal(filtered.headline, "2 of 5 ticked stamps in view");
    assert.equal(filtered.hidden, "The other 3 are still ticked and come back when the filter is released.");
    assert.equal(filtered.clearHint, "Untick all 5, including the 3 the filter is hiding");

    const allHidden = describeStampSelection(1, 0, 0);
    assert.equal(allHidden.headline, "0 of 1 ticked stamp in view");
    assert.equal(allHidden.hidden, "The other one is still ticked and comes back when the filter is released.");
  });
});
