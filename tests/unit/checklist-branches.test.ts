import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checklistBranches,
  countOffChecklist,
  withIssueAncestors,
} from "../../src/lib/checklist-branches";
import { CHECKLIST_HUES, checklistColorMap, checklistHue } from "../../src/lib/checklist-colors";

interface Node {
  node: { stampId: string; checklistIds: string[] };
  children: Node[];
}

const node = (stampId: string, checklistIds: string[], children: Node[] = []): Node => ({
  node: { stampId, checklistIds },
  children,
});

const RED_CROSS = "cl-red-cross";
const HORIZONTAL = "cl-horizontal";
const VERTICAL = "cl-vertical";

/** `1` and `2` are the Red Cross set; `1` also opens the horizontal se-tenant set; `3` hangs a
 *  vertical se-tenant `3v` the set does not list itself; `4` is on nothing. */
const TREE: Node[] = [
  node("1", [RED_CROSS, HORIZONTAL]),
  node("2", [RED_CROSS]),
  node("3", [], [node("3v", [VERTICAL])]),
  node("4", []),
];
const CHECKLISTS = [{ id: RED_CROSS }, { id: HORIZONTAL }, { id: VERTICAL }];

const ids = (tree: Node[]): string[] =>
  tree.flatMap((n) => [n.node.stampId, ...ids(n.children)]);

describe("checklistBranches (#1520)", () => {
  it("draws one branch per checklist in the issue's order, then the stamps on none", () => {
    const branches = checklistBranches(TREE, CHECKLISTS, null);
    assert.deepEqual(
      branches.map((b) => b.checklistId),
      [RED_CROSS, HORIZONTAL, VERTICAL, null]
    );
  });

  it("puts a stamp on two checklists under both branches", () => {
    const [redCross, horizontal] = checklistBranches(TREE, CHECKLISTS, null);
    assert.deepEqual(ids(redCross.tree), ["1", "2"]);
    assert.deepEqual(ids(horizontal.tree), ["1"]);
  });

  it("keeps an unlisted ancestor of a listed variant as context, as the filter chips do", () => {
    const vertical = checklistBranches(TREE, CHECKLISTS, null)[2];
    assert.deepEqual(ids(vertical.tree), ["3", "3v"]);
    assert.deepEqual([...vertical.contextIds], ["3"]);
  });

  it("lists the stamps on no checklist under their own branch", () => {
    const none = checklistBranches(TREE, CHECKLISTS, null)[3];
    assert.equal(none.checklistId, null);
    // `3` is on nothing itself, so it is a member here rather than context.
    assert.deepEqual(ids(none.tree), ["3", "4"]);
    assert.equal(none.contextIds.size, 0);
  });

  it("leaves the off-checklist branch out when every stamp is on a checklist", () => {
    const tree = [node("1", [RED_CROSS]), node("2", [HORIZONTAL])];
    const branches = checklistBranches(tree, CHECKLISTS, null);
    assert.deepEqual(
      branches.map((b) => b.checklistId),
      [RED_CROSS, HORIZONTAL, VERTICAL]
    );
    assert.equal(branches[2].tree.length, 0);
  });

  it("narrows every branch by the list filter's matches as well", () => {
    const branches = checklistBranches(TREE, CHECKLISTS, new Set(["2", "4"]));
    assert.deepEqual(ids(branches[0].tree), ["2"]);
    assert.deepEqual(ids(branches[1].tree), []);
    assert.deepEqual(ids(branches[3].tree), ["4"]);
  });

  it("counts the stamps on no checklist at any depth", () => {
    assert.equal(countOffChecklist(TREE), 2);
  });
});

describe("withIssueAncestors (#1520)", () => {
  const MEMBERS = [
    { stampId: "309", parentId: null },
    { stampId: "309A", parentId: "309" },
    { stampId: "309AP", parentId: "309A" },
    { stampId: "310", parentId: null },
  ];

  it("adds every ancestor of a listed stamp within the issue", () => {
    assert.deepEqual(
      [...withIssueAncestors(MEMBERS, new Set(["309AP"]))].sort(),
      ["309", "309A", "309AP"]
    );
  });

  it("ignores a listed stamp that is not a member, and a parent outside the issue", () => {
    const members = [{ stampId: "226yw", parentId: "226" }];
    assert.deepEqual([...withIssueAncestors(members, new Set(["226yw", "elsewhere"]))], ["226yw"]);
  });

  it("stops on a cycle rather than hanging", () => {
    const members = [
      { stampId: "a", parentId: "b" },
      { stampId: "b", parentId: "a" },
    ];
    assert.deepEqual([...withIssueAncestors(members, new Set(["a"]))].sort(), ["a", "b"]);
  });
});

describe("checklist colours (#1519)", () => {
  it("colours by position in the issue's order, so a checklist keeps its colour", () => {
    const map = checklistColorMap([{ id: "x" }, { id: "y" }]);
    assert.equal(map.get("x")?.color, `var(--color-tag-${CHECKLIST_HUES[0]})`);
    assert.equal(map.get("y")?.color, `var(--color-tag-${CHECKLIST_HUES[1]})`);
    assert.deepEqual(checklistColorMap([{ id: "x" }, { id: "y" }]), map);
  });

  it("gives neighbouring checklists distinct hues and repeats only past the palette", () => {
    assert.equal(new Set(CHECKLIST_HUES).size, CHECKLIST_HUES.length);
    assert.equal(checklistHue(CHECKLIST_HUES.length), CHECKLIST_HUES[0]);
  });

  it("leaves out the error red and the neutral slate", () => {
    assert.ok(!CHECKLIST_HUES.includes("red"));
    assert.ok(!CHECKLIST_HUES.includes("slate"));
  });
});
