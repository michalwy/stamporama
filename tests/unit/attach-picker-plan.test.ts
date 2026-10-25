import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planAttachPicker, type AttachCandidate } from "../../src/lib/attach-picker-plan";
import { areaRailOrder } from "../../src/lib/attach-picker-sort";

// What the Attach existing copies picker lists, worked out where the copies are read (#2179): the
// search, the year and the order over the candidates, and the year facet over every filter but
// the year.

type Candidate = AttachCandidate & { keys: string[] };

const copy = (id: string, over: Partial<Candidate> = {}): Candidate => ({
  id,
  itemNo: 1,
  createdAt: "2026-01-01T00:00:00.000Z",
  areaId: "pl",
  issueId: null,
  issueName: null,
  issueYear: null,
  issuedYear: null,
  stampName: null,
  locationRef: null,
  value: { baseAmount: null },
  catalogueOrder: { issueSortKey: null, memberRank: null, stampSortKey: null },
  keys: [],
  ...over,
});

const plan = (
  rows: Candidate[],
  query: Partial<Parameters<typeof planAttachPicker>[1]> = {}
) =>
  planAttachPicker(
    rows,
    { year: null, search: "", sortBy: "copyNo", sortDir: "asc", ...query },
    ["pl", "de"],
    (c) => c.keys
  );

describe("planAttachPicker (#2179)", () => {
  const rows = [
    copy("a", { itemNo: 3, issuedYear: 1950, stampName: "Eagle" }),
    copy("b", { itemNo: 1, issuedYear: 1951, stampName: "Lion" }),
    copy("c", { itemNo: 2, issuedYear: null, stampName: "Eagle head" }),
    copy("d", { itemNo: 809, issuedYear: 1950, stampName: "Crown" }),
  ];

  it("lists every candidate in the chosen order with nothing typed and no year", () => {
    assert.deepEqual(plan(rows).ids, ["b", "c", "a", "d"]);
    assert.deepEqual(plan(rows, { sortDir: "desc" }).ids, ["d", "a", "c", "b"]);
  });

  it("searches as a picker always has: #809 is that copy alone, text matches the stamp", () => {
    assert.deepEqual(plan(rows, { search: "#809" }).ids, ["d"]);
    assert.deepEqual(plan(rows, { search: "eagle" }).ids, ["c", "a"]);
  });

  it("narrows by year, the no-year facet included", () => {
    assert.deepEqual(plan(rows, { year: 1950 }).ids, ["a", "d"]);
    assert.deepEqual(plan(rows, { year: "none" }).ids, ["c"]);
  });

  it("counts the year facet over the search but not over the year itself", () => {
    const searched = plan(rows, { search: "eagle", year: 1950 });
    assert.deepEqual(searched.ids, ["a"]);
    assert.deepEqual(searched.yearFacets, [
      { year: 1950, count: 1 },
      { year: null, count: 1 },
    ]);
    assert.deepEqual(plan(rows).yearFacets, [
      { year: 1950, count: 2 },
      { year: 1951, count: 1 },
      { year: null, count: 1 },
    ]);
  });

  it("matches a catalogue number through the caller's keys", () => {
    const withKeys = [copy("x", { keys: ["mipl200"] }), copy("y", { keys: ["mipl201"] })];
    assert.deepEqual(plan(withKeys, { search: "Mi PL 200" }).ids, ["x"]);
  });
});

describe("areaRailOrder (#2179)", () => {
  it("reads the tree down the page, each area before its sub-areas, siblings in tree order", () => {
    assert.deepEqual(
      areaRailOrder([
        { id: "europe", parentId: null },
        { id: "asia", parentId: null },
        { id: "poland", parentId: "europe" },
        { id: "gg", parentId: "poland" },
        { id: "germany", parentId: "europe" },
      ]),
      ["europe", "poland", "gg", "germany", "asia"]
    );
  });
});
