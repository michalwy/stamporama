import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  blockBoxesOnSheet,
  isBoxSelected,
  selectedBoxRefs,
  selectionOfBoxes,
  sizeSubjectStampIds,
  toggleBoxSelection,
} from "../../src/lib/album-selection";

const a = { entryId: "e1", stampId: "s1" };
const b = { entryId: "e1", stampId: "s2" };
const c = { entryId: "e2", stampId: "s3" };

describe("toggleBoxSelection", () => {
  it("adds a second box to a single one, and the selection becomes several", () => {
    assert.deepEqual(toggleBoxSelection({ kind: "box", ...a }, b), { kind: "boxes", boxes: [a, b] });
  });

  it("takes a box off several, and two become one box again", () => {
    assert.deepEqual(toggleBoxSelection({ kind: "boxes", boxes: [a, b] }, a), { kind: "box", ...b });
  });

  it("takes the only box off, leaving nothing selected", () => {
    assert.equal(toggleBoxSelection({ kind: "box", ...a }, a), null);
  });

  it("lets a block go rather than holding a block and a box together", () => {
    assert.deepEqual(toggleBoxSelection({ kind: "block", id: "e1" }, c), { kind: "box", ...c });
  });

  it("starts from nothing", () => {
    assert.deepEqual(toggleBoxSelection(null, a), { kind: "box", ...a });
  });

  it("names a box by its entry and its stamp, so one stamp's two boxes are two boxes", () => {
    const sameStampOtherChecklist = { entryId: "e2", stampId: "s1" };
    assert.deepEqual(toggleBoxSelection({ kind: "box", ...a }, sameStampOtherChecklist), {
      kind: "boxes",
      boxes: [a, sameStampOtherChecklist],
    });
  });
});

describe("isBoxSelected and selectedBoxRefs", () => {
  it("reads a single box and several boxes the same way", () => {
    assert.equal(isBoxSelected({ kind: "box", ...a }, a), true);
    assert.equal(isBoxSelected({ kind: "boxes", boxes: [a, c] }, c), true);
    assert.equal(isBoxSelected({ kind: "boxes", boxes: [a, c] }, b), false);
  });

  it("holds no boxes for a block or for nothing", () => {
    assert.deepEqual(selectedBoxRefs({ kind: "block", id: "e1" }), []);
    assert.deepEqual(selectedBoxRefs(null), []);
  });
});

describe("selectionOfBoxes", () => {
  it("chooses the shape by the count", () => {
    assert.equal(selectionOfBoxes([]), null);
    assert.deepEqual(selectionOfBoxes([a]), { kind: "box", ...a });
    assert.deepEqual(selectionOfBoxes([a, b]), { kind: "boxes", boxes: [a, b] });
  });
});

describe("sizeSubjectStampIds", () => {
  it("writes each stamp once, however many of its boxes are selected", () => {
    assert.deepEqual(
      sizeSubjectStampIds([a, b, { entryId: "e2", stampId: "s1" }]),
      ["s1", "s2"]
    );
  });
});

describe("blockBoxesOnSheet", () => {
  const blocks = [
    { id: "e1", boxCount: 2 },
    { id: "n1", boxCount: 0 },
    { id: "e2", boxCount: 3 },
  ];
  const boxes = ["b0", "b1", "b2", "b3", "b4"];

  it("slices the block's boxes out of the sheet's by walking the blocks before it", () => {
    assert.deepEqual(blockBoxesOnSheet(blocks, boxes, "e2"), ["b2", "b3", "b4"]);
    assert.deepEqual(blockBoxesOnSheet(blocks, boxes, "e1"), ["b0", "b1"]);
  });

  it("gives a note, which holds no boxes, nothing", () => {
    assert.deepEqual(blockBoxesOnSheet(blocks, boxes, "n1"), []);
  });

  it("gives a block that is not on the sheet nothing", () => {
    assert.deepEqual(blockBoxesOnSheet(blocks, boxes, "e9"), []);
  });
});
