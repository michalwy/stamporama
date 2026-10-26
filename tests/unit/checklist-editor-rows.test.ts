import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  moveInOrder,
  restOfTreeRows,
  tickStamp,
  treeReading,
  untickStamp,
  type StampTreeBranch,
} from "../../src/lib/checklist-editor-rows";

// The issue checklist editor's one stamp list (#2206): the checklist's stamps in its order, then the
// rest of the issue's tree below them.

type Node = { stampId: string };
const leaf = (stampId: string): StampTreeBranch<Node> => ({ node: { stampId }, children: [] });
const branch = (stampId: string, ...children: StampTreeBranch<Node>[]): StampTreeBranch<Node> => ({
  node: { stampId },
  children,
});

// 309 → 309A → 309AP, beside 310.
const TREE = [branch("309", branch("309A", leaf("309AP"))), leaf("310")];

function rows(on: string[]) {
  return restOfTreeRows(TREE, new Set(on)).map((r) => [r.node.stampId, r.depth, r.onChecklist]);
}

describe("restOfTreeRows", () => {
  it("lists the whole tree, indented, for an empty checklist", () => {
    assert.deepEqual(rows([]), [
      ["309", 0, false],
      ["309A", 1, false],
      ["309AP", 2, false],
      ["310", 0, false],
    ]);
  });

  it("leaves out a stamp on the checklist together with its descendants on it", () => {
    assert.deepEqual(rows(["309", "309A", "309AP"]), [["310", 0, false]]);
  });

  it("keeps a stamp on the checklist as context while a variant under it is off", () => {
    assert.deepEqual(rows(["309", "310"]), [
      ["309", 0, true],
      ["309A", 1, false],
      ["309AP", 2, false],
    ]);
    assert.deepEqual(rows(["309", "309A", "310"]), [
      ["309", 0, true],
      ["309A", 1, true],
      ["309AP", 2, false],
    ]);
  });

  it("is empty once every stamp is on the checklist", () => {
    assert.deepEqual(rows(["309", "309A", "309AP", "310"]), []);
  });
});

describe("tickStamp / untickStamp", () => {
  it("puts a ticked stamp at the end of the order", () => {
    assert.deepEqual(tickStamp(["b", "a"], "c"), ["b", "a", "c"]);
  });

  it("does not move a stamp already on", () => {
    assert.deepEqual(tickStamp(["b", "a"], "b"), ["b", "a"]);
  });

  it("puts a ticked stamp at its place in the issue's order on a checklist following it (#2208)", () => {
    assert.deepEqual(tickStamp(["309", "310"], "309AP", ["309", "309A", "309AP", "310"]), [
      "309",
      "309AP",
      "310",
    ]);
  });

  it("leaves the others in their places when one is taken off", () => {
    assert.deepEqual(untickStamp(["c", "a", "b"], "a"), ["c", "b"]);
  });
});

describe("moveInOrder", () => {
  it("moves the dragged row to where it is dropped", () => {
    assert.deepEqual(moveInOrder(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
    assert.deepEqual(moveInOrder(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  });

  it("does not touch the order it was given", () => {
    const order = ["a", "b"];
    moveInOrder(order, 0, 1);
    assert.deepEqual(order, ["a", "b"]);
  });
});

describe("treeReading (#2208)", () => {
  it("reads the tree down the page: a stamp, then its variants under it, then the next stamp", () => {
    assert.deepEqual(treeReading(TREE), ["309", "309A", "309AP", "310"]);
  });
});
