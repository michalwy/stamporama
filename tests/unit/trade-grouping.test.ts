import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRADE_GROUP_LEVELS,
  arrangeByGroups,
  readTradeGroupLevels,
  type TradeGroupContext,
  type TradeGroupSubject,
} from "../../src/lib/trade-grouping";
import type { CollectionAreaData } from "../../src/lib/areas";

// How a side of a trade is arranged (#637). What matters here: the levels nest in the module's own
// order whatever order they were switched on in, the headings count the whole side, and flat is the
// absence of grouping rather than one group holding everything.

const AREAS = [
  { id: "pl", name: "Polska", parentId: null, catalogEntries: [] },
  { id: "rp", name: "II RP", parentId: "pl", catalogEntries: [] },
  { id: "cz", name: "Czechy", parentId: null, catalogEntries: [] },
] as unknown as CollectionAreaData[];

const CTX: TradeGroupContext = { areas: AREAS, conditionOrder: ["used", "mint"] };

function subject(over: Partial<TradeGroupSubject> = {}): TradeGroupSubject {
  return {
    areaId: "pl",
    issuedYear: 1925,
    issueId: null,
    issueName: null,
    issueYear: null,
    conditionId: "used",
    conditionAbbreviation: "U",
    conditionName: "Used",
    certificateStatusId: null,
    certificateStatusAbbreviation: null,
    certificateStatusName: null,
    ...over,
  };
}

interface Row {
  id: string;
  subject: TradeGroupSubject;
  quantity: number;
}

const row = (id: string, over: Partial<TradeGroupSubject> = {}, quantity = 1): Row => ({
  id,
  subject: subject(over),
  quantity,
});

const arrange = (rows: Row[], levels: Parameters<typeof arrangeByGroups>[3]) =>
  arrangeByGroups(
    rows,
    (r) => r.subject,
    (r) => r.quantity,
    levels,
    CTX
  );

describe("trade grouping levels (#637)", () => {
  it("puts the levels back into nesting order, whatever order they arrive in", () => {
    assert.deepEqual(readTradeGroupLevels(["condition", "area"]), ["area", "condition"]);
    assert.deepEqual(readTradeGroupLevels(["area", "condition"]), ["area", "condition"]);
  });

  it("drops names it does not know rather than failing on them", () => {
    assert.deepEqual(readTradeGroupLevels(["area", "colour", ""]), ["area"]);
    assert.deepEqual(readTradeGroupLevels([]), []);
  });

  it("offers exactly four levels, nesting identity before state", () => {
    assert.deepEqual([...TRADE_GROUP_LEVELS], ["area", "year", "issue", "condition"]);
  });
});

describe("arrangeByGroups (#637)", () => {
  it("is flat with no levels on — not one group holding everything", () => {
    const result = arrange([row("a"), row("b")], []);
    assert.deepEqual(result.headings, {});
    assert.deepEqual(
      result.rows.map((r) => r.row.id),
      ["a", "b"]
    );
    assert.ok(result.rows.every((r) => r.path.length === 0));
  });

  it("keeps the entry order inside a leaf", () => {
    const result = arrange([row("a"), row("b"), row("c")], ["area"]);
    assert.deepEqual(
      result.rows.map((r) => r.row.id),
      ["a", "b", "c"]
    );
  });

  it("names an area by its full path, and sinks the ones with no area", () => {
    const result = arrange(
      [row("none", { areaId: null }), row("rp", { areaId: "rp" }), row("cz", { areaId: "cz" })],
      ["area"]
    );
    assert.deepEqual(
      result.rows.map((r) => r.row.id),
      ["cz", "rp", "none"]
    );
    const labels = result.rows.map((r) => result.headings[r.path[0]].label);
    assert.deepEqual(labels, ["Czechy", "Polska › II RP", "No area"]);
  });

  it("reads years oldest first, with the unknown year last", () => {
    const result = arrange(
      [
        row("c", { issuedYear: null }),
        row("b", { issuedYear: 1925 }),
        row("a", { issuedYear: 1918 }),
      ],
      ["year"]
    );
    assert.deepEqual(
      result.rows.map((r) => r.row.id),
      ["a", "b", "c"]
    );
  });

  it("orders conditions by the collection's own dictionary, not alphabetically", () => {
    const mint = { conditionId: "mint", conditionAbbreviation: "**", conditionName: "Mint" };
    const result = arrange([row("m", mint), row("u")], ["condition"]);
    // "Used" sorts first because the dictionary says so — `sortOrder` is display order, never a
    // quality scale (ADR-0032).
    assert.deepEqual(
      result.rows.map((r) => r.row.id),
      ["u", "m"]
    );
  });

  it("keeps condition and certificate as one heading, with no certificate leading", () => {
    const withCert = {
      certificateStatusId: "att",
      certificateStatusAbbreviation: "Att",
      certificateStatusName: "Attest",
    };
    const result = arrange([row("cert", withCert), row("plain")], ["condition"]);
    assert.deepEqual(
      result.rows.map((r) => r.row.id),
      ["plain", "cert"]
    );
    assert.deepEqual(
      result.rows.map((r) => result.headings[r.path[0]].label),
      ["U", "U + Att"]
    );
  });

  it("nests, and counts every level over everything under it", () => {
    const result = arrange(
      [
        row("a", { areaId: "pl", issuedYear: 1918 }),
        row("b", { areaId: "pl", issuedYear: 1925 }),
        row("c", { areaId: "cz", issuedYear: 1925 }),
      ],
      ["area", "year"]
    );
    assert.deepEqual(
      result.rows.map((r) => r.row.id),
      ["c", "a", "b"]
    );
    assert.ok(result.rows.every((r) => r.path.length === 2));

    const polska = result.rows.find((r) => r.row.id === "a")!.path[0];
    assert.equal(result.headings[polska].label, "Polska");
    // The outer heading counts both its years, not just the first.
    assert.equal(result.headings[polska].count, 2);
  });

  it("counts pieces apart from lines — three lines can be thirty stamps", () => {
    const result = arrange([row("a", {}, 4), row("b", {}, 6)], ["area"]);
    const heading = result.headings[result.rows[0].path[0]];
    assert.equal(heading.count, 2);
    assert.equal(heading.pieces, 10);
  });

  it("gives two same-named headings under different parents different keys", () => {
    const result = arrange(
      [
        row("pl", { areaId: "pl", issuedYear: 1925 }),
        row("cz", { areaId: "cz", issuedYear: 1925 }),
      ],
      ["area", "year"]
    );
    const [first, second] = result.rows;
    assert.notEqual(first.path[1], second.path[1]);
    assert.equal(result.headings[first.path[1]].label, "1925");
    assert.equal(result.headings[second.path[1]].label, "1925");
    assert.equal(result.headings[first.path[1]].count, 1);
  });
});
