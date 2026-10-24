import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { sortAttachableCopies, type AttachSortCopy } from "../../src/lib/attach-picker-sort";
import {
  DEFAULT_ATTACH_FILTERS,
  parseAttachFilters,
  serializeAttachFilters,
} from "../../src/lib/attach-picker-filters";

// The Attach existing copies picker's sort (#2147): catalogue order, copy number, date added and
// catalogue value, both ways, with blanks last in either direction, remembered with the filters.

type Copy = AttachSortCopy & { id: string };

const copy = (id: string, over: Partial<Copy> = {}): Copy => ({
  id,
  itemNo: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  areaId: "pl",
  issueId: null,
  issueName: null,
  issueYear: null,
  issuedYear: null,
  value: { baseAmount: null },
  catalogueOrder: { issueSortKey: null, memberRank: null, stampSortKey: null },
  ...over,
});

const ids = (rows: readonly Copy[]) => rows.map((r) => r.id);
const AREAS = ["pl", "de"];

describe("sortAttachableCopies — catalogue order (#2147)", () => {
  const inIssue = (
    id: string,
    issueId: string,
    issueSortKey: string,
    memberRank: number,
    over: Partial<Copy> = {}
  ) =>
    copy(id, {
      issueId,
      issueName: issueId,
      issueYear: 1950,
      catalogueOrder: { issueSortKey, memberRank, stampSortKey: null },
      ...over,
    });

  it("orders by area rail, year, issue, then the stamp's place in the issue", () => {
    const rows = [
      copy("de-1950", { areaId: "de", issueYear: 1950 }),
      inIssue("b2", "b", "0000000020", 1),
      inIssue("a1", "a", "0000000010", 0),
      inIssue("b1", "b", "0000000020", 0),
      copy("pl-1949", { issueYear: 1949 }),
    ];
    assert.deepEqual(ids(sortAttachableCopies(rows, "catalogue", "asc", AREAS)), [
      "pl-1949",
      "a1",
      "b1",
      "b2",
      "de-1950",
    ]);
  });

  it("puts a stamp in no issue after the issues of its year, ordered by its own number", () => {
    const loose = (id: string, stampSortKey: string) =>
      copy(id, {
        issuedYear: 1950,
        catalogueOrder: { issueSortKey: null, memberRank: null, stampSortKey },
      });
    const rows = [
      loose("loose-2", "0000000002"),
      loose("loose-1", "0000000001"),
      inIssue("a1", "a", "0000000099", 0),
    ];
    assert.deepEqual(ids(sortAttachableCopies(rows, "catalogue", "asc", AREAS)), [
      "a1",
      "loose-1",
      "loose-2",
    ]);
  });

  it("reverses descending, keeping the copies of no area last", () => {
    const rows = [
      copy("none", { areaId: null }),
      copy("pl", { issueYear: 1950 }),
      copy("de", { areaId: "de", issueYear: 1950 }),
      copy("unknown", { areaId: "gone" }),
    ];
    const sorted = ids(sortAttachableCopies(rows, "catalogue", "desc", AREAS));
    assert.deepEqual(sorted.slice(0, 2), ["de", "pl"]);
    assert.deepEqual(new Set(sorted.slice(2)), new Set(["none", "unknown"]));
  });
});

describe("sortAttachableCopies — copy number, date added, value (#2147)", () => {
  it("sorts by copy number both ways", () => {
    const rows = [copy("3", { itemNo: 3 }), copy("1", { itemNo: 1 }), copy("2", { itemNo: 2 })];
    assert.deepEqual(ids(sortAttachableCopies(rows, "copyNo", "asc", AREAS)), ["1", "2", "3"]);
    assert.deepEqual(ids(sortAttachableCopies(rows, "copyNo", "desc", AREAS)), ["3", "2", "1"]);
  });

  it("sorts by date added, from an ISO string or a Date", () => {
    const rows = [
      copy("late", { itemNo: 1, createdAt: "2026-03-01T00:00:00.000Z" }),
      copy("early", { itemNo: 2, createdAt: new Date("2026-01-01T00:00:00.000Z") }),
    ];
    assert.deepEqual(ids(sortAttachableCopies(rows, "added", "asc", AREAS)), ["early", "late"]);
    assert.deepEqual(ids(sortAttachableCopies(rows, "added", "desc", AREAS)), ["late", "early"]);
  });

  it("sorts by catalogue value with the unvalued copies last in either direction", () => {
    const rows = [
      copy("none", { itemNo: 1 }),
      copy("ten", { itemNo: 2, value: { baseAmount: 10 } }),
      copy("two", { itemNo: 3, value: { baseAmount: 2 } }),
    ];
    assert.deepEqual(ids(sortAttachableCopies(rows, "value", "asc", AREAS)), ["two", "ten", "none"]);
    assert.deepEqual(ids(sortAttachableCopies(rows, "value", "desc", AREAS)), ["ten", "two", "none"]);
  });

  it("breaks ties on the copy number and leaves the input alone", () => {
    const rows = [copy("b", { itemNo: 2 }), copy("a", { itemNo: 1 })];
    assert.deepEqual(ids(sortAttachableCopies(rows, "value", "asc", AREAS)), ["a", "b"]);
    assert.deepEqual(ids(rows), ["b", "a"]);
  });
});

describe("the remembered sort (#2147)", () => {
  it("defaults to catalogue number, ascending", () => {
    assert.equal(DEFAULT_ATTACH_FILTERS.sortBy, "catalogue");
    assert.equal(DEFAULT_ATTACH_FILTERS.sortDir, "asc");
    assert.deepEqual(parseAttachFilters(JSON.stringify({ states: ["held"] })), DEFAULT_ATTACH_FILTERS);
  });

  it("round-trips with the filters", () => {
    const stored = { ...DEFAULT_ATTACH_FILTERS, sortBy: "value" as const, sortDir: "desc" as const };
    assert.deepEqual(parseAttachFilters(serializeAttachFilters(stored)), stored);
  });

  it("reads an unknown key or direction as the default", () => {
    const parsed = parseAttachFilters(JSON.stringify({ sortBy: "price", sortDir: "sideways" }));
    assert.equal(parsed.sortBy, "catalogue");
    assert.equal(parsed.sortDir, "asc");
  });
});
