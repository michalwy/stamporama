import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  catalogueFillEntries,
  catalogueFillGroups,
  multipliedCatalogueValue,
  needsCatalogueValue,
  type FillableLotLine,
} from "../../src/lib/lot-catalogue-fill";

// #2094: which of a lot's lines *Fill catalogue values* asks for, and what a typed single comes to
// on a multiple.

type Line = FillableLotLine & { id: string };

function line(id: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    stampId: `stamp-${id}`,
    conditionId: "mnh",
    certificateStatusId: null,
    formatId: null,
    unpriced: true,
    mark: null,
    unknownVariant: false,
    ...overrides,
  };
}

describe("needsCatalogueValue", () => {
  it("asks for an unpriced line at a settled condition", () => {
    assert.equal(needsCatalogueValue(line("a")), true);
  });

  it("leaves out a priced line", () => {
    assert.equal(needsCatalogueValue(line("a", { unpriced: false })), false);
  });

  it("leaves out a marked line — the catalogue's answer is that there is no price (#1615)", () => {
    assert.equal(needsCatalogueValue(line("a", { mark: "nonexistent" })), false);
  });

  it("leaves out a line whose condition is not settled (#1623)", () => {
    assert.equal(needsCatalogueValue(line("a", { conditionId: null })), false);
  });

  it("leaves out a line on a base stamp — its value is its variants'", () => {
    assert.equal(needsCatalogueValue(line("a", { unknownVariant: true })), false);
  });
});

describe("catalogueFillEntries", () => {
  it("keeps the lot's own order", () => {
    const entries = catalogueFillEntries([line("c"), line("a"), line("b")]);
    assert.deepEqual(
      entries.map((e) => e.stampId),
      ["stamp-c", "stamp-a", "stamp-b"]
    );
  });

  it("asks once for a value two lines share, whatever their formats", () => {
    const single = line("1", { stampId: "s" });
    const block = line("2", { stampId: "s", formatId: "block4" });
    const entries = catalogueFillEntries([single, line("x"), block]);
    assert.equal(entries.length, 2);
    assert.deepEqual(
      entries[0].lines.map((l) => l.id),
      ["1", "2"]
    );
  });

  it("asks separately per condition and per certificate", () => {
    const entries = catalogueFillEntries([
      line("1", { stampId: "s" }),
      line("2", { stampId: "s", conditionId: "mh" }),
      line("3", { stampId: "s", certificateStatusId: "attest" }),
    ]);
    assert.equal(entries.length, 3);
    assert.deepEqual(
      entries.map((e) => [e.conditionId, e.certificateStatusId]),
      [
        ["mnh", null],
        ["mh", null],
        ["mnh", "attest"],
      ]
    );
  });

  it("skips the lines it does not ask for", () => {
    const entries = catalogueFillEntries([
      line("1", { unpriced: false }),
      line("2", { mark: "undeterminable" }),
      line("3", { conditionId: null }),
      line("4", { unknownVariant: true }),
    ]);
    assert.deepEqual(entries, []);
  });
});

describe("multipliedCatalogueValue", () => {
  it("multiplies a typed single by the format's factor", () => {
    assert.equal(multipliedCatalogueValue("10", 4.5), "45.00");
  });

  it("reads a comma as the decimal separator", () => {
    assert.equal(multipliedCatalogueValue("2,50", 4), "10.00");
  });

  it("says nothing without a factor", () => {
    assert.equal(multipliedCatalogueValue("10", null), null);
  });

  it("says nothing for a blank, a mark or something that is not a number", () => {
    assert.equal(multipliedCatalogueValue("", 4), null);
    assert.equal(multipliedCatalogueValue("-", 4), null);
    assert.equal(multipliedCatalogueValue("?", 4), null);
    assert.equal(multipliedCatalogueValue("abc", 4), null);
  });
});

describe("catalogueFillGroups (#2220)", () => {
  const group = (key: string, lines: Line[]) => ({ key, label: `Lot ${key}`, title: `Lot ${key} · t`, lines });

  it("asks each value under its own lot, in the post's order", () => {
    const sections = catalogueFillGroups([group("1", [line("a")]), group("2", [line("b"), line("c")])]);
    assert.deepEqual(
      sections.map((s) => [s.group.key, s.entries.map((e) => e.stampId)]),
      [
        ["1", ["stamp-a"]],
        ["2", ["stamp-b", "stamp-c"]],
      ]
    );
  });

  it("asks a stamp held by several lots once, in the first, carrying the later lots' lines", () => {
    const first = line("a1", { stampId: "s" });
    const later = line("a2", { stampId: "s" });
    const sections = catalogueFillGroups([group("1", [first]), group("2", [later, line("b")])]);
    assert.deepEqual(
      sections.map((s) => [s.group.key, s.entries.map((e) => e.lines.map((l) => l.id))]),
      [
        ["1", [["a1", "a2"]]],
        ["2", [["b"]]],
      ]
    );
  });

  it("leaves out a lot with nothing to ask", () => {
    const sections = catalogueFillGroups([
      group("1", [line("a", { unpriced: false })]),
      group("2", [line("b", { unknownVariant: true })]),
      group("3", [line("c")]),
    ]);
    assert.deepEqual(
      sections.map((s) => s.group.key),
      ["3"]
    );
  });

  it("asks nothing of a lot whose every value was asked in an earlier one", () => {
    const sections = catalogueFillGroups([
      group("1", [line("a1", { stampId: "s" })]),
      group("2", [line("a2", { stampId: "s" })]),
    ]);
    assert.deepEqual(
      sections.map((s) => s.group.key),
      ["1"]
    );
  });
});
