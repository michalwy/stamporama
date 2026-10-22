import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  areaRanks,
  compareIssues,
  missingCatalogPriceCells,
  pageIntoGroups,
  stampTreeOrder,
  type AskedCell,
  type GapPrice,
  type GapStamp,
} from "../../src/lib/agent-api/missing-catalog-prices";

// The pure half of `find_missing_catalogue_prices` (#2110): what counts as missing — nothing entered,
// a mark is an answer, a derived format figure is a price, an umbrella answered by its variants, a
// certificate cell the fill would write still missing and saying so — and the order and grouping it is
// told in. The operation is driven end to end in
// `tests/integration/agent-api-missing-catalogue-prices.test.ts`.

const ED = "ed";
const MNH: AskedCell = { conditionId: "mnh", certificateStatusId: null, formatId: null };
const USED: AskedCell = { conditionId: "used", certificateStatusId: null, formatId: null };

function price(stampId: string, cell: AskedCell, value: string): GapPrice {
  const mark = value === "-" ? "nonexistent" : value === "?" ? "undeterminable" : null;
  return { stampId, catalogEditionId: ED, ...cell, amount: mark ? "" : value, mark };
}

function find(input: {
  stamps: GapStamp[];
  cells: AskedCell[];
  prices?: GapPrice[];
  factor?: (stampId: string, formatId: string, conditionId: string) => number | null;
  percent?: (id: string) => number | null;
}) {
  return missingCatalogPriceCells({
    prices: [],
    factor: () => null,
    percent: () => null,
    ...input,
  });
}

const plain = (stampId: string): GapStamp => ({ stampId, editionId: ED, variantIds: null });

describe("which cells are missing (#2110)", () => {
  it("reports every asked cell with nothing entered, and nothing for a stamp that has them all", () => {
    const missing = find({
      stamps: [plain("a"), plain("b")],
      cells: [MNH, USED],
      prices: [price("a", MNH, "1.00"), price("b", MNH, "2.00"), price("b", USED, "0.50")],
    });
    assert.deepEqual([...missing.keys()], ["a"]);
    assert.deepEqual(missing.get("a"), [USED]);
  });

  it("reads a price in another edition as missing in this one", () => {
    const missing = find({
      stamps: [plain("a")],
      cells: [MNH],
      prices: [{ ...price("a", MNH, "1.00"), catalogEditionId: "older" }],
    });
    assert.deepEqual(missing.get("a"), [MNH]);
  });

  it("treats a cell recorded as - or ? as answered (#1615)", () => {
    const missing = find({
      stamps: [plain("a")],
      cells: [MNH, USED],
      prices: [price("a", MNH, "-"), price("a", USED, "?")],
    });
    assert.equal(missing.size, 0);
  });

  it("counts a format cell the single and a multiplier give as priced, and one without either as missing", () => {
    const pair: AskedCell = { ...MNH, formatId: "pair" };
    const missing = find({
      stamps: [plain("a"), plain("b"), plain("c")],
      cells: [pair],
      prices: [price("a", MNH, "1.00"), price("c", MNH, "1.00")],
      factor: (stampId) => (stampId === "c" ? null : 2),
    });
    assert.deepEqual([...missing.keys()], ["b", "c"]);
  });

  it("carries a marked single onto a format cell as answered", () => {
    const pair: AskedCell = { ...MNH, formatId: "pair" };
    const missing = find({ stamps: [plain("a")], cells: [pair], prices: [price("a", MNH, "-")] });
    assert.equal(missing.size, 0);
  });

  describe("an umbrella", () => {
    const umbrella: GapStamp = { stampId: "u", editionId: ED, variantIds: ["v1", "v2"] };

    it("is not missing a cell every variant has, priced or marked", () => {
      const missing = find({
        stamps: [umbrella],
        cells: [MNH],
        prices: [price("v1", MNH, "2.00"), price("v2", MNH, "-")],
      });
      assert.equal(missing.size, 0);
    });

    it("is missing a cell while one variant lacks it, and its own price closes it", () => {
      const prices = [price("v1", MNH, "2.00")];
      assert.deepEqual(find({ stamps: [umbrella], cells: [MNH], prices }).get("u"), [MNH]);
      assert.equal(find({ stamps: [umbrella], cells: [MNH], prices: [...prices, price("u", MNH, "1.50")] }).size, 0);
    });

    it("reads a variant's derived format figure as an answer, as the rollup does", () => {
      const pair: AskedCell = { ...MNH, formatId: "pair" };
      const missing = find({
        stamps: [umbrella],
        cells: [pair],
        prices: [price("v1", MNH, "1.00"), price("v2", MNH, "3.00")],
        factor: () => 2,
      });
      assert.equal(missing.size, 0);
    });

    it("offers no derivable figure, since the fill passes a locked umbrella by", () => {
      const certified: AskedCell = { ...MNH, certificateStatusId: "cert" };
      const missing = find({
        stamps: [umbrella],
        cells: [certified],
        prices: [price("u", MNH, "10.00")],
        percent: () => 120,
      });
      assert.deepEqual(missing.get("u"), [certified]);
    });
  });

  describe("a certificate cell", () => {
    const certified: AskedCell = { ...MNH, certificateStatusId: "cert" };

    it("is missing even when the plain price would fill it, and says what the fill would write", () => {
      const missing = find({
        stamps: [plain("a")],
        cells: [certified],
        prices: [price("a", MNH, "10.00")],
        percent: () => 120,
      });
      assert.deepEqual(missing.get("a"), [{ ...certified, derivable: "12.00" }]);
    });

    it("carries a marked plain price over as - or ?, as set_catalog_prices takes it", () => {
      const missing = find({
        stamps: [plain("a"), plain("b")],
        cells: [certified],
        prices: [price("a", MNH, "-"), price("b", MNH, "?")],
        percent: () => 120,
      });
      assert.deepEqual(missing.get("a"), [{ ...certified, derivable: "-" }]);
      assert.deepEqual(missing.get("b"), [{ ...certified, derivable: "?" }]);
    });

    it("says nothing is derivable without a percentage or without a plain price", () => {
      const noPercent = find({ stamps: [plain("a")], cells: [certified], prices: [price("a", MNH, "10.00")] });
      assert.deepEqual(noPercent.get("a"), [certified]);
      const noPlain = find({ stamps: [plain("a")], cells: [certified], percent: () => 120 });
      assert.deepEqual(noPlain.get("a"), [certified]);
    });

    it("is answered by its own recorded figure", () => {
      const missing = find({
        stamps: [plain("a")],
        cells: [certified],
        prices: [price("a", MNH, "10.00"), price("a", certified, "15.00")],
        percent: () => 120,
      });
      assert.equal(missing.size, 0);
    });
  });
});

describe("the order they are told in (#2110)", () => {
  it("walks an issue's tree depth first, siblings by the collector's order, then the catalogue's", () => {
    const stamps = [
      { id: "310", parentId: null, sortOrder: 1, sortKey: "0310" },
      { id: "309B", parentId: "309", sortOrder: 3, sortKey: "0309B" },
      { id: "309A", parentId: "309", sortOrder: 2, sortKey: "0309A" },
      { id: "309", parentId: null, sortOrder: 0, sortKey: "0309" },
      { id: "x", parentId: null, sortOrder: null, sortKey: "0001" },
    ];
    assert.deepEqual(stampTreeOrder(stamps).map((s) => s.id), ["309", "309A", "309B", "310", "x"]);
  });

  it("makes a stamp whose parent is not among them a root, and still tells a cycle", () => {
    const stamps = [
      { id: "b", parentId: "missing", sortOrder: null, sortKey: "2" },
      { id: "a", parentId: null, sortOrder: null, sortKey: "1" },
      { id: "c1", parentId: "c2", sortOrder: null, sortKey: "3" },
      { id: "c2", parentId: "c1", sortOrder: null, sortKey: "4" },
    ];
    assert.deepEqual(stampTreeOrder(stamps).map((s) => s.id), ["a", "b", "c1", "c2"]);
  });

  it("orders issues by area in tree order, then catalogue number, then year", () => {
    const ranks = areaRanks([
      { id: "de", parentId: "eu", sortOrder: 1, name: "Germany" },
      { id: "eu", parentId: null, sortOrder: 0, name: "Europe" },
      { id: "pl", parentId: "eu", sortOrder: 0, name: "Poland" },
      { id: "us", parentId: null, sortOrder: 1, name: "USA" },
    ]);
    assert.deepEqual([...ranks.entries()], [["eu", 0], ["pl", 1], ["de", 2], ["us", 3]]);
    const issues = [
      { id: "us1", areaRank: 3, sortKey: "0001", year: 1900 },
      { id: "de2", areaRank: 2, sortKey: null, year: 1950 },
      { id: "de1", areaRank: 2, sortKey: "0100", year: 1960 },
      { id: "pl1", areaRank: 1, sortKey: "0500", year: 1930 },
    ];
    assert.deepEqual([...issues].sort(compareIssues).map((i) => i.id), ["pl1", "de1", "de2", "us1"]);
  });

  it("pages by stamps, not groups, and tells an issue cut by the boundary on both pages", () => {
    const ordered = ["a", "a", "a", "b", "b"].map((groupKey, i) => ({ groupKey, stamp: `${groupKey}${i}` }));
    assert.deepEqual(pageIntoGroups(ordered, { offset: 0, limit: 2 }), [{ groupKey: "a", stamps: ["a0", "a1"] }]);
    assert.deepEqual(pageIntoGroups(ordered, { offset: 2, limit: 2 }), [
      { groupKey: "a", stamps: ["a2"] },
      { groupKey: "b", stamps: ["b3"] },
    ]);
  });
});
