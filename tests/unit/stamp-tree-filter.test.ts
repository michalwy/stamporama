import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { filterStampTreeByChecklists } from "../../src/lib/stamp-tree-filter";

interface Node {
  node: { stampId: string; checklistIds: string[] };
  children: Node[];
}

const node = (stampId: string, checklistIds: string[], children: Node[] = []): Node => ({
  node: { stampId, checklistIds },
  children,
});

const BASIC = "cl-basic";
const IMPERF = "cl-imperf";

/** `73` and `74` are the basic set; `74a` is a perforation variety nobody counts; `309` is an
 *  unknown-variant umbrella whose child `309AP` is the imperforate set's entry. */
const TREE: Node[] = [
  node("73", [BASIC]),
  node("74", [BASIC], [node("74a", [])]),
  node("309", [], [node("309AP", [IMPERF])]),
];

const ids = (tree: Node[]): string[] =>
  tree.flatMap((n) => [n.node.stampId, ...ids(n.children)]);

describe("filterStampTreeByChecklists", () => {
  it("an empty selection is the absence of a filter, not an empty set", () => {
    const result = filterStampTreeByChecklists(TREE, []);
    assert.equal(result.tree, TREE);
    assert.equal(result.contextIds.size, 0);
  });

  it("keeps only the stamps on the selected checklist", () => {
    const { tree } = filterStampTreeByChecklists(TREE, [BASIC]);
    assert.deepEqual(ids(tree).sort(), ["73", "74"]);
  });

  it("keeps an ancestor of a match, and reports it as context", () => {
    const { tree, contextIds } = filterStampTreeByChecklists(TREE, [IMPERF]);
    // `309AP` is unreadable without the `309` it hangs under, so the umbrella survives.
    assert.deepEqual(ids(tree), ["309", "309AP"]);
    assert.deepEqual([...contextIds], ["309"]);
  });

  it("does not report a matching node as context", () => {
    const { contextIds } = filterStampTreeByChecklists(TREE, [BASIC]);
    assert.equal(contextIds.size, 0);
  });

  it("unions several selected checklists", () => {
    const { tree } = filterStampTreeByChecklists(TREE, [BASIC, IMPERF]);
    assert.deepEqual(ids(tree).sort(), ["309", "309AP", "73", "74"]);
  });

  it("drops a branch where nothing matches", () => {
    const { tree } = filterStampTreeByChecklists(TREE, ["cl-nothing-on-it"]);
    assert.deepEqual(tree, []);
  });

  it("leaves the caller's tree untouched", () => {
    filterStampTreeByChecklists(TREE, [BASIC]);
    assert.equal(TREE[1].children.length, 1, "74a must still hang under 74 in the source tree");
  });
});
