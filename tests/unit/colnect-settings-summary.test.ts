import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ColnectConditionMappingData, ColnectMappingData } from "../../src/lib/colnect";
import type { ColnectListMappingData } from "../../src/lib/colnect-list-sync";
import type { StampAttributeData, StampAttributeLists } from "../../src/lib/stamp-attributes";
import {
  COLNECT_UNMAPPED_PARAM,
  colnectAttributeView,
  colnectSummary,
  unmappedAttributeCount,
} from "../../src/app/c/[collectionSlug]/settings/colnect-summary";

/**
 * The Colnect page's summary strip (#1480): one tile per tab, and the Attributes tab showing one
 * list at a time. The unmapped attribute figure has to be the tab's own count, and its tile opens
 * the tab narrowed to those values.
 */

function mapping(colnectAbbrev: string, vendorAbbreviation: string): ColnectMappingData {
  return {
    id: colnectAbbrev,
    colnectAbbrev,
    catalogVendorId: vendorAbbreviation,
    vendorName: vendorAbbreviation,
    vendorAbbreviation,
  };
}

function condition(abbreviation: string, colnectValue: string | null): ColnectConditionMappingData {
  return {
    stampConditionId: abbreviation,
    conditionName: abbreviation,
    conditionAbbreviation: abbreviation,
    colnectValue,
    colnectLabel: colnectValue,
  };
}

function value(name: string, colnectValue: string | null = null): StampAttributeData {
  return { id: name, name, nameByLanguage: {}, colnectValue, sortOrder: 0 };
}

function attributes(over: Partial<StampAttributeLists> = {}): StampAttributeLists {
  return { color: [], watermark: [], paper: [], printing: [], ...over };
}

function list(lt: number, label: string, enabled: boolean): ColnectListMappingData {
  return {
    lt,
    label,
    source: "items_in_collection",
    sourceOfTruth: "local",
    enabled,
    configured: enabled,
  };
}

const LISTS = [
  list(1, "Collection", true),
  list(2, "Swap", false),
  list(3, "Wishlist", true),
  list(4, "For sale", false),
];

function tile(part: string, ...args: Parameters<typeof colnectSummary>) {
  return colnectSummary(...args).find((t) => t.part === part)!;
}

describe("Colnect settings summary (#1480)", () => {
  it("has one tile per tab, in the tabs' order", () => {
    assert.deepEqual(
      colnectSummary([], [], attributes(), LISTS).map((t) => [t.part, t.title]),
      [
        ["catalogs", "Catalogs"],
        ["conditions", "Conditions"],
        ["attributes", "Attributes"],
        ["lists", "List sync"],
      ]
    );
  });

  it("counts the catalogs mapped, and says the rest match themselves when there are none", () => {
    const some = tile("catalogs", [mapping("Pol", "Fi"), mapping("Sg", "SG")], [], attributes(), LISTS);
    assert.equal(some.figure, "2 catalogs mapped");
    assert.equal(some.detail, "Pol → Fi, Sg → SG");

    const none = tile("catalogs", [], [], attributes(), LISTS);
    assert.equal(none.figure, "None mapped");
    assert.equal(none.detail, "Same abbreviations match themselves");
  });

  it("says the conditions mapped out of all, naming the ones that are not", () => {
    const t = tile(
      "conditions",
      [],
      [condition("MNH", "1"), condition("U", "4"), condition("Cover", null)],
      attributes(),
      LISTS
    );
    assert.equal(t.figure, "2 of 3 mapped");
    assert.equal(t.detail, "Not mapped: Cover");

    assert.equal(tile("conditions", [], [], attributes(), LISTS).figure, "No conditions yet");
  });

  it("names a long run of names only in part", () => {
    const t = tile(
      "conditions",
      [],
      ["A", "B", "C", "D", "E"].map((a) => condition(a, null)),
      attributes(),
      LISTS
    );
    assert.equal(t.detail, "Not mapped: A, B, C and 2 more");
  });

  describe("attributes", () => {
    const lists = attributes({
      color: [value("Carmine", "carmine"), value("Blue")],
      watermark: [value("Lozenges", "lozenges")],
      paper: [value("Thin paper"), value("Chalky paper", "   ")],
    });

    it("counts the values without a Colnect word across the four lists, a blank one included", () => {
      assert.equal(unmappedAttributeCount(lists), 3);
      assert.equal(unmappedAttributeCount(lists, "paper"), 2);

      const t = tile("attributes", [], [], lists, LISTS);
      assert.equal(t.figure, "3 values without a Colnect word");
      assert.equal(t.detail, "of 5 values");
    });

    it("opens its tab narrowed while any value is unmapped, and plainly once none is", () => {
      assert.deepEqual(tile("attributes", [], [], lists, LISTS).view, {
        [COLNECT_UNMAPPED_PARAM]: "1",
      });

      const mapped = attributes({ color: [value("Carmine", "carmine")] });
      const t = tile("attributes", [], [], mapped, LISTS);
      assert.equal(t.figure, "All mapped");
      assert.equal(t.view, undefined);

      assert.equal(tile("attributes", [], [], attributes(), LISTS).figure, "No values yet");
    });

    it("the figure is the tab's own count, narrowed list by list", () => {
      // Every list the tab offers, each opened narrowed: what the collector can reach by clicking.
      const narrowed = colnectAttributeView(lists, null, true).kinds.reduce(
        (n, kind) => n + colnectAttributeView(lists, kind, true).rows.length,
        0
      );
      assert.equal(narrowed, unmappedAttributeCount(lists));
    });
  });

  it("says which lists are set to sync", () => {
    const t = tile("lists", [], [], attributes(), LISTS);
    assert.equal(t.figure, "2 of 4 synced");
    assert.equal(t.detail, "Collection, Wishlist");

    const none = tile(
      "lists",
      [],
      [],
      attributes(),
      LISTS.map((l) => ({ ...l, enabled: false }))
    );
    assert.equal(none.figure, "None synced");
    assert.equal(none.detail, null);
  });
});

describe("Colnect attribute view (#1480)", () => {
  const lists = attributes({
    color: [value("Carmine", "carmine")],
    paper: [value("Thin paper"), value("Chalky paper", "chalky")],
    printing: [value("Offset")],
  });

  it("offers only the lists that have values, and opens the first by default", () => {
    const view = colnectAttributeView(lists, null, false);
    assert.deepEqual(view.kinds, ["color", "paper", "printing"]);
    assert.equal(view.kind, "color");
    assert.equal(view.rows.length, 1);
  });

  it("keeps a list named in the address, and ignores one with no values or no such list", () => {
    assert.equal(colnectAttributeView(lists, "printing", false).kind, "printing");
    assert.equal(colnectAttributeView(lists, "watermark", false).kind, "color");
    assert.equal(colnectAttributeView(lists, "nonsense", false).kind, "color");
  });

  it("narrowed, opens the first list with anything left to map and shows only its unmapped values", () => {
    const view = colnectAttributeView(lists, null, true);
    assert.equal(view.kind, "paper");
    assert.deepEqual(
      view.rows.map((r) => r.name),
      ["Thin paper"]
    );
  });

  it("narrowed, still keeps a list the collector named, even with nothing left in it", () => {
    const view = colnectAttributeView(lists, "color", true);
    assert.equal(view.kind, "color");
    assert.deepEqual(view.rows, []);
  });

  it("has no list to show when no dictionary has a value", () => {
    const view = colnectAttributeView(attributes(), null, true);
    assert.equal(view.kind, null);
    assert.deepEqual(view.kinds, []);
    assert.deepEqual(view.rows, []);
  });
});
