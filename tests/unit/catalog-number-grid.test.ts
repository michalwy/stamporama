import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { recomputeDeclaredRange } from "../../src/lib/catalog-number";
import { catalogNumberCellKey, repeatedCatalogNumbers } from "../../src/lib/catalog-number-grid";
import { flattenMemberTree } from "../../src/lib/issue-member-order";

// The catalogue-number grid (#1346): its declared-range rule, its repeat flag and its row order.

describe("recomputeDeclaredRange", () => {
  it("widens a range to the numbers now on its stamps", () => {
    assert.deepEqual(recomputeDeclaredRange({ firstNumber: "100", lastNumber: "103" }, ["100", "101", "105"]), {
      kind: "set",
      firstNumber: "100",
      lastNumber: "105",
    });
  });

  it("narrows one too, which #333's proposal never does", () => {
    assert.deepEqual(recomputeDeclaredRange({ firstNumber: "100", lastNumber: "110" }, ["101", "103"]), {
      kind: "set",
      firstNumber: "101",
      lastNumber: "103",
    });
  });

  it("keeps a range the numbers already span exactly", () => {
    assert.deepEqual(recomputeDeclaredRange({ firstNumber: "100", lastNumber: "102" }, ["102", "100", "101"]), {
      kind: "keep",
    });
  });

  it("creates a range for a catalogue that had none", () => {
    assert.deepEqual(recomputeDeclaredRange(null, ["2897", "2895", "2896"]), {
      kind: "set",
      firstNumber: "2895",
      lastNumber: "2897",
    });
  });

  it("writes a single number with no Last", () => {
    assert.deepEqual(recomputeDeclaredRange(null, ["17"]), { kind: "set", firstNumber: "17", lastNumber: null });
  });

  it("removes the range once no checklist stamp carries a number in the catalogue", () => {
    assert.deepEqual(recomputeDeclaredRange({ firstNumber: "1", lastNumber: "3" }, []), { kind: "remove" });
  });

  it("has nothing to remove where nothing was declared", () => {
    assert.deepEqual(recomputeDeclaredRange(null, []), { kind: "keep" });
  });

  it("lets basic numbering win over variants beside it", () => {
    assert.deepEqual(recomputeDeclaredRange(null, ["309", "309A", "309AP", "310"]), {
      kind: "set",
      firstNumber: "309",
      lastNumber: "310",
    });
  });

  it("keeps a lettered range's own family", () => {
    assert.deepEqual(recomputeDeclaredRange({ firstNumber: "12a", lastNumber: "12c" }, ["12a", "12b", "12d"]), {
      kind: "set",
      firstNumber: "12a",
      lastNumber: "12d",
    });
  });

  it("takes a family every number shares when nothing was declared", () => {
    assert.deepEqual(recomputeDeclaredRange(null, ["Bl7", "Bl5"]), {
      kind: "set",
      firstNumber: "Bl5",
      lastNumber: "Bl7",
    });
  });

  it("guesses nothing when the numbers are in several families and no range chooses", () => {
    assert.deepEqual(recomputeDeclaredRange(null, ["Bl5", "12a"]), { kind: "keep" });
  });
});

describe("repeatedCatalogNumbers", () => {
  it("marks every cell of a number repeated within one catalogue, naming the others", () => {
    const repeats = repeatedCatalogNumbers([
      { stampId: "a", catalogVendorId: "mi", number: "100" },
      { stampId: "b", catalogVendorId: "mi", number: " 100 " },
      { stampId: "c", catalogVendorId: "mi", number: "101" },
    ]);
    assert.deepEqual(repeats.get(catalogNumberCellKey("a", "mi")), ["b"]);
    assert.deepEqual(repeats.get(catalogNumberCellKey("b", "mi")), ["a"]);
    assert.equal(repeats.has(catalogNumberCellKey("c", "mi")), false);
  });

  it("does not compare across catalogues, and an empty cell repeats nothing", () => {
    const repeats = repeatedCatalogNumbers([
      { stampId: "a", catalogVendorId: "mi", number: "100" },
      { stampId: "a", catalogVendorId: "sc", number: "100" },
      { stampId: "b", catalogVendorId: "mi", number: "" },
      { stampId: "c", catalogVendorId: "mi", number: "  " },
    ]);
    assert.equal(repeats.size, 0);
  });

  it("is exact apart from whitespace, as a catalogue identity is", () => {
    const repeats = repeatedCatalogNumbers([
      { stampId: "a", catalogVendorId: "mi", number: "100a" },
      { stampId: "b", catalogVendorId: "mi", number: "100A" },
    ]);
    assert.equal(repeats.size, 0);
  });
});

describe("flattenMemberTree", () => {
  it("reads the tree down the page, siblings by their own order", () => {
    const rows = flattenMemberTree([
      { stampId: "b", parentId: null, sortOrder: 1 },
      { stampId: "b2", parentId: "b", sortOrder: 5 },
      { stampId: "a", parentId: null, sortOrder: 0 },
      { stampId: "b1", parentId: "b", sortOrder: 4 },
      { stampId: "b1x", parentId: "b1", sortOrder: 9 },
    ]);
    assert.deepEqual(rows, [
      { stampId: "a", depth: 0 },
      { stampId: "b", depth: 0 },
      { stampId: "b1", depth: 1 },
      { stampId: "b1x", depth: 2 },
      { stampId: "b2", depth: 1 },
    ]);
  });

  it("draws a variant whose base is in another issue as a root", () => {
    assert.deepEqual(flattenMemberTree([{ stampId: "v", parentId: "elsewhere", sortOrder: 0 }]), [
      { stampId: "v", depth: 0 },
    ]);
  });

  it("loses nothing to a cycle", () => {
    const rows = flattenMemberTree([
      { stampId: "x", parentId: "y", sortOrder: 0 },
      { stampId: "y", parentId: "x", sortOrder: 1 },
    ]);
    assert.deepEqual(new Set(rows.map((r) => r.stampId)), new Set(["x", "y"]));
  });
});
