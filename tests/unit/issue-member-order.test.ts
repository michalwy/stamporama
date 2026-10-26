import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  checklistInIssueOrder,
  checkSiblingGroup,
  effectiveParentId,
  moveInOrder,
  siblingsOf,
  sortOrderAssignments,
} from "../../src/lib/issue-member-order";

/** A small issue: two root stamps, the second carrying two variants. */
const MEMBERS = [
  { stampId: "a", parentId: null },
  { stampId: "b", parentId: null },
  { stampId: "b1", parentId: "b" },
  { stampId: "b2", parentId: "b" },
];

describe("effectiveParentId", () => {
  const ids = new Set(MEMBERS.map((m) => m.stampId));

  it("files a member under its parent when the parent is in the issue", () => {
    assert.equal(effectiveParentId({ stampId: "b1", parentId: "b" }, ids), "b");
  });

  it("makes a root of a variant whose base belongs to another issue", () => {
    // `buildStampTree` draws it as a root, so the order has to group it as one too.
    assert.equal(effectiveParentId({ stampId: "x", parentId: "elsewhere" }, ids), null);
  });
});

describe("siblingsOf", () => {
  it("returns the root group", () => {
    assert.deepEqual(
      siblingsOf(MEMBERS, null).map((m) => m.stampId),
      ["a", "b"]
    );
  });

  it("returns one parent's children", () => {
    assert.deepEqual(
      siblingsOf(MEMBERS, "b").map((m) => m.stampId),
      ["b1", "b2"]
    );
  });
});

describe("checkSiblingGroup", () => {
  it("accepts a permuted root group", () => {
    assert.deepEqual(checkSiblingGroup(MEMBERS, ["b", "a"]), { ok: true, parentId: null });
  });

  it("accepts a permuted child group", () => {
    assert.deepEqual(checkSiblingGroup(MEMBERS, ["b2", "b1"]), { ok: true, parentId: "b" });
  });

  it("refuses a stamp that is not in the issue", () => {
    const result = checkSiblingGroup(MEMBERS, ["a", "zzz"]);
    assert.equal(result.ok, false);
  });

  it("refuses a repeated stamp", () => {
    const result = checkSiblingGroup(MEMBERS, ["a", "a"]);
    assert.equal(result.ok, false);
  });

  it("refuses a mix of levels", () => {
    const result = checkSiblingGroup(MEMBERS, ["a", "b1"]);
    assert.equal(result.ok, false);
  });

  it("refuses a partial group — the filtered-tree case", () => {
    // Dropping "a" would move "b" past a sibling that was never on screen.
    const result = checkSiblingGroup(MEMBERS, ["b"]);
    assert.equal(result.ok, false);
  });

  it("refuses an empty order", () => {
    assert.equal(checkSiblingGroup(MEMBERS, []).ok, false);
  });
});

describe("sortOrderAssignments", () => {
  it("numbers the group densely from zero", () => {
    assert.deepEqual(sortOrderAssignments(["b", "a"]), [
      { stampId: "b", sortOrder: 0 },
      { stampId: "a", sortOrder: 1 },
    ]);
  });
});

describe("moveInOrder", () => {
  it("moves an element down", () => {
    assert.deepEqual(moveInOrder(["a", "b", "c"], 0, 2), ["b", "c", "a"]);
  });

  it("moves an element up", () => {
    assert.deepEqual(moveInOrder(["a", "b", "c"], 2, 0), ["c", "a", "b"]);
  });

  it("leaves the list alone when nothing moves", () => {
    assert.deepEqual(moveInOrder(["a", "b", "c"], 1, 1), ["a", "b", "c"]);
  });
});

describe("checklistInIssueOrder (#2208)", () => {
  const READING = ["a", "b", "b1", "b2"];

  it("reads a checklist's stamps as the issue's tree reads, keeping only those on it", () => {
    assert.deepEqual(checklistInIssueOrder(READING, ["b2", "a", "b"]), ["a", "b", "b2"]);
  });

  it("puts a stamp the tree does not reach after the issue's, in the order it had", () => {
    assert.deepEqual(checklistInIssueOrder(READING, ["y", "b1", "x", "a"]), ["a", "b1", "y", "x"]);
  });

  it("answers an empty checklist with nothing", () => {
    assert.deepEqual(checklistInIssueOrder(READING, []), []);
  });
});
