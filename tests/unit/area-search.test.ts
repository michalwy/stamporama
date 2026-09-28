import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { searchAreas, stepAreaMatch, type AreaSearchNode } from "../../src/lib/area-search";
import { foldForSearch } from "../../src/lib/fold-for-search";

// The area filter's search (#1436): what a query matches, which ancestors come along dimmed, and
// how the arrow keys walk the matches. The selection is deliberately absent from every signature
// here — the search narrows what is drawn and cannot reach what is selected.

/**
 *  europe
 *  ├── poland                 (title name "Polska")
 *  │   ├── gdansk  "Gdańsk"
 *  │   └── lodz    "Łódź"
 *  └── germany
 *      └── danzig  "Freie Stadt Danzig"  (title name "Gdańsk (Wolne Miasto)")
 *  asia
 *  └── japan
 */
const AREAS: AreaSearchNode[] = [
  { id: "europe", parentId: null, name: "Europe", titleName: null },
  { id: "poland", parentId: "europe", name: "Poland", titleName: "Polska" },
  { id: "gdansk", parentId: "poland", name: "Gdańsk", titleName: null },
  { id: "lodz", parentId: "poland", name: "Łódź", titleName: null },
  { id: "germany", parentId: "europe", name: "Germany", titleName: null },
  {
    id: "danzig",
    parentId: "germany",
    name: "Freie Stadt Danzig",
    titleName: "Gdańsk (Wolne Miasto)",
  },
  { id: "asia", parentId: null, name: "Asia", titleName: null },
  { id: "japan", parentId: "asia", name: "Japan", titleName: null },
];

const sorted = (ids: Set<string> | undefined) => [...(ids ?? [])].sort();

describe("searchAreas", () => {
  it("answers null — the full tree — for a blank query", () => {
    assert.equal(searchAreas(AREAS, ""), null);
    assert.equal(searchAreas(AREAS, "   "), null);
  });

  it("ignores case and diacritics, so gdansk finds Gdańsk", () => {
    const result = searchAreas(AREAS, "gdansk");
    assert.ok(result);
    assert.ok(result.matchIds.has("gdansk"));
  });

  it("folds a stroked letter too, so lodz finds Łódź", () => {
    assert.deepEqual(sorted(searchAreas(AREAS, "lodz")?.matchIds), ["lodz"]);
    assert.deepEqual(sorted(searchAreas(AREAS, "ŁÓDŹ")?.matchIds), ["lodz"]);
  });

  it("matches the title name as well as the name", () => {
    assert.deepEqual(sorted(searchAreas(AREAS, "polska")?.matchIds), ["poland"]);
    // Danzig is found by its title name; Gdańsk by its own name.
    assert.deepEqual(sorted(searchAreas(AREAS, "GDANSK")?.matchIds), ["danzig", "gdansk"]);
  });

  it("matches a fragment anywhere in the name", () => {
    assert.deepEqual(sorted(searchAreas(AREAS, "an")?.matchIds), [
      "danzig",
      "gdansk",
      "germany",
      "japan",
      "poland",
    ]);
  });

  it("draws every match with its ancestors, and only those", () => {
    const result = searchAreas(AREAS, "gdansk");
    assert.ok(result);
    assert.deepEqual(sorted(result.shownIds), ["danzig", "europe", "gdansk", "germany", "poland"]);
    // The ancestors are drawn without being matches — that difference is what dims them.
    assert.ok(!result.matchIds.has("europe"));
    assert.ok(!result.matchIds.has("germany"));
  });

  it("does not bring a match's children along", () => {
    const result = searchAreas(AREAS, "poland");
    assert.ok(result);
    assert.deepEqual(sorted(result.shownIds), ["europe", "poland"]);
  });

  it("finds nothing without drawing anything", () => {
    const result = searchAreas(AREAS, "atlantis");
    assert.ok(result);
    assert.equal(result.matchIds.size, 0);
    assert.equal(result.shownIds.size, 0);
  });

  it("trims what was typed", () => {
    assert.deepEqual(sorted(searchAreas(AREAS, "  japan ")?.matchIds), ["japan"]);
  });

  it("ends on a malformed parent cycle rather than spinning", () => {
    const cyclic: AreaSearchNode[] = [
      { id: "a", parentId: "b", name: "Alpha", titleName: null },
      { id: "b", parentId: "a", name: "Beta", titleName: null },
    ];
    assert.deepEqual(sorted(searchAreas(cyclic, "alpha")?.shownIds), ["a", "b"]);
  });
});

describe("stepAreaMatch", () => {
  const order = ["gdansk", "lodz", "danzig"];

  it("lands on the first match going down, the last going up, from none", () => {
    assert.equal(stepAreaMatch(order, null, 1), "gdansk");
    assert.equal(stepAreaMatch(order, null, -1), "danzig");
  });

  it("steps one match at a time", () => {
    assert.equal(stepAreaMatch(order, "gdansk", 1), "lodz");
    assert.equal(stepAreaMatch(order, "danzig", -1), "lodz");
  });

  it("stays put past either end rather than wrapping", () => {
    assert.equal(stepAreaMatch(order, "danzig", 1), "danzig");
    assert.equal(stepAreaMatch(order, "gdansk", -1), "gdansk");
  });

  it("restarts from the end when the one in hand is no longer a match", () => {
    assert.equal(stepAreaMatch(order, "japan", 1), "gdansk");
    assert.equal(stepAreaMatch(order, "japan", -1), "danzig");
  });

  it("has nothing to hand with no matches", () => {
    assert.equal(stepAreaMatch([], null, 1), null);
    assert.equal(stepAreaMatch([], "gdansk", -1), null);
  });
});

describe("foldForSearch", () => {
  it("folds case, combining accents and stroked letters", () => {
    assert.equal(foldForSearch("Gdańsk"), "gdansk");
    assert.equal(foldForSearch("Łódź"), "lodz");
    assert.equal(foldForSearch("Zürich"), "zurich");
    assert.equal(foldForSearch("København"), "kobenhavn");
  });
});
