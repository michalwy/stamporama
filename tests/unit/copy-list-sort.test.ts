import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  COPY_LIST_SORT_KEYS,
  COPY_LIST_SORT_OPTIONS,
  isCopyListSortKey,
  isInMemoryCopySort,
  sortCopySortRows,
  type CopySortRow,
} from "../../src/lib/copy-list-sort";

// The Copies list's sort (#2300): the keys the toolbar offers and the route accepts, and the order
// the keys no column carries are read in.

const row = (
  id: string,
  itemNo: number,
  catalogSortKey: string | null,
  value: string | number | null
): CopySortRow => ({ id, itemNo, catalogSortKey, value });

const ids = (rows: CopySortRow[]) => rows.map((r) => r.id);

describe("the Copies list's sort keys", () => {
  it("offers every key once, each with the direction it starts in", () => {
    assert.deepEqual(
      COPY_LIST_SORT_OPTIONS.map((o) => o.value),
      [...COPY_LIST_SORT_KEYS]
    );
    const first = Object.fromEntries(COPY_LIST_SORT_OPTIONS.map((o) => [o.value, o.firstDir]));
    assert.equal(first.created, "desc");
    assert.equal(first.catalogueValue, "desc");
    assert.equal(first.cost, "desc");
    for (const key of ["catalogNumber", "issueDate", "name", "issueName", "copyNo"]) {
      assert.equal(first[key], "asc", key);
    }
  });

  it("accepts only its own keys", () => {
    assert.equal(isCopyListSortKey("catalogNumber"), true);
    assert.equal(isCopyListSortKey("price"), false);
    assert.equal(isCopyListSortKey(null), false);
  });

  it("reads in memory only what no column carries", () => {
    assert.deepEqual(
      COPY_LIST_SORT_KEYS.filter(isInMemoryCopySort),
      ["issueName", "catalogueValue", "cost"]
    );
  });
});

describe("sortCopySortRows", () => {
  const rows = [
    row("none-a", 4, "0000000002", null),
    row("cheap", 2, "0000000010", 2),
    row("dear", 3, "0000000001", 9.5),
    row("none-b", 1, null, null),
    row("cheap-too", 1, "0000000010", 2),
  ];

  it("orders by the value either way, with the blanks last in both", () => {
    assert.deepEqual(ids(sortCopySortRows(rows, "asc")), [
      "cheap-too",
      "cheap",
      "dear",
      "none-a",
      "none-b",
    ]);
    assert.deepEqual(ids(sortCopySortRows(rows, "desc")), [
      "dear",
      "cheap-too",
      "cheap",
      "none-a",
      "none-b",
    ]);
  });

  it("breaks a tie by catalogue number, then copy number, ascending whichever way it runs", () => {
    const tied = [
      row("b2", 2, "0000000002", 5),
      row("a", 9, "0000000001", 5),
      row("b1", 1, "0000000002", 5),
      row("c", 1, null, 5),
    ];
    for (const dir of ["asc", "desc"] as const) {
      assert.deepEqual(ids(sortCopySortRows(tied, dir)), ["a", "b1", "b2", "c"], dir);
    }
  });

  it("orders names as a reader would, digits as numbers and case aside", () => {
    const named = [
      row("10", 1, null, "Series 10"),
      row("2", 2, null, "series 2"),
      row("none", 3, null, null),
    ];
    assert.deepEqual(ids(sortCopySortRows(named, "asc")), ["2", "10", "none"]);
    assert.deepEqual(ids(sortCopySortRows(named, "desc")), ["10", "2", "none"]);
  });

  it("leaves its input as it was", () => {
    const before = ids(rows);
    sortCopySortRows(rows, "desc");
    assert.deepEqual(ids(rows), before);
  });
});
