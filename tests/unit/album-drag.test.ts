import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  blockDropMark,
  boxDropMark,
  insertBefore,
  type AlbumCarry,
} from "../../src/lib/album-drag";

const boxCarry: AlbumCarry = { kind: "box", blockId: "e1", stampId: "s1" };
const entryCarry: AlbumCarry = { kind: "block", blockId: "e1", blockKind: "entry" };
const noteCarry: AlbumCarry = { kind: "block", blockId: "n1", blockKind: "text" };

describe("boxDropMark", () => {
  it("marks an insertion point on another box of the same block", () => {
    assert.equal(boxDropMark(boxCarry, { blockId: "e1", stampId: "s2" }), "insert-before");
  });

  it("promises nothing on a box of another block, where the drop does nothing", () => {
    assert.equal(boxDropMark(boxCarry, { blockId: "e2", stampId: "s2" }), null);
  });

  it("promises nothing on the box being carried", () => {
    assert.equal(boxDropMark(boxCarry, { blockId: "e1", stampId: "s1" }), null);
  });

  it("promises nothing while a heading is the thing being carried", () => {
    assert.equal(boxDropMark(entryCarry, { blockId: "e1", stampId: "s2" }), null);
    assert.equal(boxDropMark(null, { blockId: "e1", stampId: "s2" }), null);
  });
});

describe("blockDropMark", () => {
  it("marks an insertion point when a checklist is carried onto another checklist", () => {
    assert.equal(blockDropMark(entryCarry, { blockId: "e2", blockKind: "entry" }), "insert-before");
  });

  it("promises nothing when a checklist is carried onto a note, which is not in that order", () => {
    assert.equal(blockDropMark(entryCarry, { blockId: "n1", blockKind: "text" }), null);
  });

  it("says a note is filed rather than positioned, wherever it lands", () => {
    assert.equal(blockDropMark(noteCarry, { blockId: "e1", blockKind: "entry" }), "file-here");
    assert.equal(blockDropMark(noteCarry, { blockId: "n2", blockKind: "text" }), "file-here");
  });

  it("promises nothing on the block being carried", () => {
    assert.equal(blockDropMark(entryCarry, { blockId: "e1", blockKind: "entry" }), null);
    assert.equal(blockDropMark(noteCarry, { blockId: "n1", blockKind: "text" }), null);
  });

  it("promises nothing while a box is the thing being carried", () => {
    assert.equal(blockDropMark(boxCarry, { blockId: "e2", blockKind: "entry" }), null);
    assert.equal(blockDropMark(null, { blockId: "e2", blockKind: "entry" }), null);
  });
});

describe("insertBefore", () => {
  it("puts the carried id in front of the target, pushing it later — not a swap", () => {
    assert.deepEqual(insertBefore(["a", "b", "c", "d"], "a", "c"), ["b", "a", "c", "d"]);
  });

  it("reads the same way carrying something backwards", () => {
    assert.deepEqual(insertBefore(["a", "b", "c", "d"], "d", "b"), ["a", "d", "b", "c"]);
  });

  it("moves a neighbour by one, which is the smallest move there is", () => {
    assert.deepEqual(insertBefore(["a", "b", "c"], "b", "a"), ["b", "a", "c"]);
  });

  it("refuses a move onto itself, which changes nothing", () => {
    assert.equal(insertBefore(["a", "b"], "a", "a"), null);
  });

  it("refuses a target that is not in the list rather than filing next to last", () => {
    // `splice` would read the -1 an absent target returns as *one from the end*.
    assert.equal(insertBefore(["a", "b", "c"], "a", "z"), null);
  });

  it("refuses to carry something the list does not hold", () => {
    assert.equal(insertBefore(["a", "b", "c"], "z", "b"), null);
  });
});
