import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  compareSets,
  compareSetItems,
  sortSetItems,
  hasManualItemOrder,
  nextItemSortOrder,
} from "../../src/lib/offer-set-order";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

// Sets ----------------------------------------------------------------------

describe("compareSets", () => {
  it("orders by explicit position", () => {
    const sets = [
      { id: "c", sortOrder: 2 },
      { id: "a", sortOrder: 0 },
      { id: "b", sortOrder: 1 },
    ];
    assert.deepEqual([...sets].sort(compareSets).map((s) => s.id), ["a", "b", "c"]);
  });

  it("breaks equal positions by id, so the result is stable", () => {
    const sets = [
      { id: "z", sortOrder: 0 },
      { id: "a", sortOrder: 0 },
    ];
    assert.deepEqual([...sets].sort(compareSets).map((s) => s.id), ["a", "z"]);
  });
});

// Copies --------------------------------------------------------------------

/** A catalog number encoded the way the column stores it, so the tests read as catalog numbers. */
const key = (n: string | number | null) => (n === null ? null : catalogSortKeyOf(String(n)));

const derived = (itemId: string, catalogNumber: string | number | null) => ({
  itemId,
  sortOrder: null,
  catalogSortKey: key(catalogNumber),
});

describe("sortSetItems", () => {
  it("derives catalog order when nothing was hand-corrected", () => {
    const items = [derived("b", 20), derived("c", 3), derived("a", 12)];
    assert.deepEqual(sortSetItems(items).map((i) => i.itemId), ["c", "a", "b"]);
  });

  it("sorts copies without a catalog key last", () => {
    const items = [derived("a", null), derived("b", 7)];
    assert.deepEqual(sortSetItems(items).map((i) => i.itemId), ["b", "a"]);
  });

  it("honours hand-corrected positions over catalog order", () => {
    const items = [
      { itemId: "a", sortOrder: 2, catalogSortKey: key(1) },
      { itemId: "b", sortOrder: 0, catalogSortKey: key(9) },
      { itemId: "c", sortOrder: 1, catalogSortKey: key(5) },
    ];
    assert.deepEqual(sortSetItems(items).map((i) => i.itemId), ["b", "c", "a"]);
  });

  it("puts explicit positions before derived ones in a mixed set", () => {
    const items = [derived("a", 1), { itemId: "b", sortOrder: 0, catalogSortKey: key(99) }];
    assert.deepEqual(sortSetItems(items).map((i) => i.itemId), ["b", "a"]);
  });

  it("falls back to the copy id when nothing else separates two copies", () => {
    const items = [derived("z", null), derived("a", null)];
    assert.deepEqual(sortSetItems(items).map((i) => i.itemId), ["a", "z"]);
  });

  it("does not mutate its input", () => {
    const items = [derived("b", 2), derived("a", 1)];
    sortSetItems(items);
    assert.deepEqual(items.map((i) => i.itemId), ["b", "a"]);
  });

  it("is a total order (comparing a copy to itself is 0)", () => {
    const a = derived("a", 1);
    assert.equal(compareSetItems(a, a), 0);
  });
});

// Manual-order state --------------------------------------------------------

describe("hasManualItemOrder", () => {
  it("is false for a fully derived set and true once any copy carries a position", () => {
    assert.equal(hasManualItemOrder([{ sortOrder: null }, { sortOrder: null }]), false);
    assert.equal(hasManualItemOrder([{ sortOrder: null }, { sortOrder: 0 }]), true);
    assert.equal(hasManualItemOrder([]), false);
  });
});

describe("nextItemSortOrder", () => {
  it("leaves a derived set derived — a new copy slots into its catalog position", () => {
    assert.equal(nextItemSortOrder([{ sortOrder: null }, { sortOrder: null }]), null);
    assert.equal(nextItemSortOrder([]), null);
  });

  it("appends past the last explicit position in a hand-corrected set", () => {
    assert.equal(nextItemSortOrder([{ sortOrder: 0 }, { sortOrder: 1 }]), 2);
    assert.equal(nextItemSortOrder([{ sortOrder: 4 }, { sortOrder: null }]), 5);
  });
});
