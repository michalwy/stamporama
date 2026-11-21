import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checklistBranches,
  countOffChecklist,
  drawsChecklistBranches,
  withIssueAncestors,
  withIssueAncestorsAndVariants,
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

  describe("a listed stamp's variants (#2655)", () => {
    const IMPERF = "cl-imperf";
    /** *Imperforate (A)* lists `20A`, `21A` and `22A`; `20A` has two variants on no checklist. */
    const IMPERF_TREE: Node[] = [
      node("20", [], [node("20A", [IMPERF], [node("20Aa", []), node("20Ab", [])])]),
      node("21A", [IMPERF]),
      node("22A", [IMPERF]),
    ];

    it("draws them dimmed under the listed stamp in its branch", () => {
      const [imperf] = checklistBranches(IMPERF_TREE, [{ id: IMPERF }, { id: VERTICAL }], null);
      assert.deepEqual(ids(imperf.tree), ["20", "20A", "20Aa", "20Ab", "21A", "22A"]);
      assert.deepEqual([...imperf.contextIds].sort(), ["20", "20Aa", "20Ab"]);
    });

    it("does not repeat them under Not on a checklist, which is gone when nothing is left", () => {
      const tree: Node[] = [node("20A", [IMPERF], [node("20Aa", []), node("20Ab", [])])];
      const branches = checklistBranches(tree, [{ id: IMPERF }, { id: VERTICAL }], null);
      assert.deepEqual(
        branches.map((b) => b.checklistId),
        [IMPERF, VERTICAL]
      );
      assert.equal(countOffChecklist(tree), 0);
    });

    it("keeps an unlisted ancestor's own off-checklist stamps under Not on a checklist", () => {
      // `20` is on nothing and has no listed ancestor, so it stays there; `20A`'s variants do not.
      const branches = checklistBranches(IMPERF_TREE, [{ id: IMPERF }, { id: VERTICAL }], null);
      const none = branches[branches.length - 1];
      assert.equal(none.checklistId, null);
      assert.deepEqual(ids(none.tree), ["20"]);
      assert.equal(countOffChecklist(IMPERF_TREE), 1);
    });
  });
});

describe("drawsChecklistBranches (#2681)", () => {
  const SHEET = "cl-souvenir-sheet";
  const MAIN = "cl-main";

  it("draws several checklists as branches", () => {
    assert.equal(drawsChecklistBranches(TREE, CHECKLISTS), true);
  });

  it("draws one checklist as branches when stamps sit off it", () => {
    // *Pastoral Visits*: the souvenir sheets are on the checklist, the stamps are not.
    const tree: Node[] = [
      node("3950", []),
      node("3951", []),
      node("BL188", [SHEET]),
      node("BL189", [SHEET]),
    ];
    assert.equal(drawsChecklistBranches(tree, [{ id: SHEET }]), true);
    const branches = checklistBranches(tree, [{ id: SHEET }], null);
    assert.deepEqual(
      branches.map((b) => [b.checklistId, ids(b.tree)]),
      [
        [SHEET, ["BL188", "BL189"]],
        [null, ["3950", "3951"]],
      ]
    );
  });

  it("keeps one checklist flat when it holds every stamp", () => {
    const tree: Node[] = [node("1", [MAIN]), node("2", [MAIN])];
    assert.equal(drawsChecklistBranches(tree, [{ id: MAIN }]), false);
  });

  it("keeps one checklist flat when only its stamps' variants are off it, at any depth", () => {
    const tree: Node[] = [
      node("1", [MAIN], [node("1a", [], [node("1a1", [])])]),
      node("2", [MAIN], [node("2a", [])]),
    ];
    assert.equal(drawsChecklistBranches(tree, [{ id: MAIN }]), false);
  });

  it("counts an unlisted parent of a listed stamp as off the checklist", () => {
    const tree: Node[] = [node("20", [], [node("20A", [MAIN])])];
    assert.equal(drawsChecklistBranches(tree, [{ id: MAIN }]), true);
  });

  it("never draws an issue without checklists as branches", () => {
    assert.equal(drawsChecklistBranches([node("1", [])], []), false);
  });

  it("keeps a one-checklist issue whose stamps are not loaded yet flat", () => {
    assert.equal(drawsChecklistBranches([], [{ id: MAIN }]), false);
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

describe("withIssueAncestorsAndVariants (#2674)", () => {
  /** `91C` is an umbrella on the checklist with two variants, one of which has its own variant;
   *  `91Cf` is a plate flaw filed under it, with a variant of its own; `92` is listed and has none;
   *  `93` is not listed, nor are its variants. */
  const MEMBERS = [
    { stampId: "91", parentId: null, isVariant: false },
    { stampId: "91C", parentId: "91", isVariant: true },
    { stampId: "91Ca", parentId: "91C", isVariant: true },
    { stampId: "91Cb", parentId: "91C", isVariant: true },
    { stampId: "91Cbx", parentId: "91Cb", isVariant: true },
    { stampId: "91Cf", parentId: "91C", isVariant: false },
    { stampId: "91Cfa", parentId: "91Cf", isVariant: true },
    { stampId: "92", parentId: null, isVariant: false },
    { stampId: "93", parentId: null, isVariant: false },
    { stampId: "93a", parentId: "93", isVariant: true },
  ];

  it("adds a listed umbrella's variants at any depth, and its ancestors", () => {
    assert.deepEqual(
      [...withIssueAncestorsAndVariants(MEMBERS, new Set(["91C", "92"]))].sort(),
      ["91", "91C", "91Ca", "91Cb", "91Cbx", "92"]
    );
  });

  it("leaves off a distinct entry filed under a listed stamp, and what hangs under it", () => {
    const out = withIssueAncestorsAndVariants(MEMBERS, new Set(["91C"]));
    assert.ok(!out.has("91Cf"));
    assert.ok(!out.has("91Cfa"));
  });

  it("keeps a distinct entry the checklist lists, with its own variants", () => {
    const out = withIssueAncestorsAndVariants(MEMBERS, new Set(["91Cf"]));
    assert.deepEqual([...out].sort(), ["91", "91C", "91Cf", "91Cfa"]);
  });

  it("adds nothing to a checklist with no umbrellas", () => {
    const listed = new Set(["92"]);
    assert.deepEqual(
      [...withIssueAncestorsAndVariants(MEMBERS, listed)],
      [...withIssueAncestors(MEMBERS, listed)]
    );
  });

  it("ignores a listed stamp that is not a member, and stops on a cycle", () => {
    const members = [
      { stampId: "a", parentId: "b", isVariant: true },
      { stampId: "b", parentId: "a", isVariant: true },
    ];
    assert.deepEqual([...withIssueAncestorsAndVariants(members, new Set(["a", "zz"]))].sort(), [
      "a",
      "b",
    ]);
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
