import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { rollUpAreaCounts, type AreaFacet, type AreaFacetNode } from "../../src/lib/area-facets";

// The area rail's counts (#843). The roll-up is the half of the rule that is not a database query:
// the server hands back each area's *own* rows, and what a row shows depends on the collector's
// subtree scope (#385) — so a parent's number and the list it opens have to be derived from one
// place, which is this function.

/**
 *  europe
 *  ├── poland
 *  │   ├── pl-pre-war
 *  │   └── pl-post-war
 *  └── germany
 *  asia
 *  └── japan          (grouping-only in the fixture's spirit: no rows of its own)
 */
const AREAS: AreaFacetNode[] = [
  { id: "europe", parentId: null },
  { id: "poland", parentId: "europe" },
  { id: "pl-pre-war", parentId: "poland" },
  { id: "pl-post-war", parentId: "poland" },
  { id: "germany", parentId: "europe" },
  { id: "asia", parentId: null },
  { id: "japan", parentId: "asia" },
];

const FACETS: AreaFacet[] = [
  { areaId: "europe", count: 2 },
  { areaId: "poland", count: 5 },
  { areaId: "pl-pre-war", count: 30 },
  { areaId: "pl-post-war", count: 11 },
  { areaId: "germany", count: 7 },
  { areaId: "japan", count: 4 },
];

describe("rollUpAreaCounts (#843)", () => {
  it("is null when the screen supplies no facet, so nothing renders a count", () => {
    assert.equal(rollUpAreaCounts(AREAS, undefined, true), null);
    assert.equal(rollUpAreaCounts(AREAS, undefined, false), null);
  });

  it("with the subtree scope off, a row shows only the rows filed on it", () => {
    const counts = rollUpAreaCounts(AREAS, FACETS, false)!;
    assert.equal(counts.get("poland"), 5);
    assert.equal(counts.get("europe"), 2);
    assert.equal(counts.get("pl-pre-war"), 30);
  });

  it("with the subtree scope on, a parent carries its whole subtree", () => {
    const counts = rollUpAreaCounts(AREAS, FACETS, true)!;
    assert.equal(counts.get("pl-pre-war"), 30);
    assert.equal(counts.get("pl-post-war"), 11);
    // Poland's own 5 plus both children.
    assert.equal(counts.get("poland"), 46);
    // Europe's own 2, plus Poland's subtree and Germany.
    assert.equal(counts.get("europe"), 55);
    assert.equal(counts.get("asia"), 4);
  });

  it("a leaf reads the same under either scope — which is why the toggle is hidden on one", () => {
    const on = rollUpAreaCounts(AREAS, FACETS, true)!;
    const off = rollUpAreaCounts(AREAS, FACETS, false)!;
    for (const leaf of ["pl-pre-war", "pl-post-war", "germany", "japan"]) {
      assert.equal(on.get(leaf), off.get(leaf), leaf);
    }
  });

  it("an area with no rows of its own still totals its children", () => {
    // `asia` is absent from the facets entirely — the query returned no group for it.
    const counts = rollUpAreaCounts(AREAS, FACETS, true)!;
    assert.equal(counts.get("asia"), 4);
    assert.equal(rollUpAreaCounts(AREAS, FACETS, false)!.get("asia"), 0);
  });

  it("every area gets an entry, zero included — an empty cell reads as a failed load, not as none", () => {
    const counts = rollUpAreaCounts(AREAS, [], true)!;
    assert.equal(counts.size, AREAS.length);
    for (const { id } of AREAS) assert.equal(counts.get(id), 0, id);
  });

  it("ignores a facet naming an area that is not in the tree", () => {
    // A count with no row to sit on cannot be shown, and folding it into an ancestor would inflate
    // a number the collector could not reconcile against anything on screen.
    const withGhost = [...FACETS, { areaId: "atlantis", count: 999 }];
    const counts = rollUpAreaCounts(AREAS, withGhost, true)!;
    assert.equal(counts.has("atlantis"), false);
    assert.equal(counts.get("europe"), 55);
  });

  it("keeps the identity the rail is judged on: a parent equals its own rows plus its children's", () => {
    // This is the property the issue states — an area's number must be what the tree under it adds
    // up to, or the two disagree and neither is believable. Asserted structurally rather than on
    // one hand-summed figure, so a change to the fixture cannot quietly satisfy it.
    const counts = rollUpAreaCounts(AREAS, FACETS, true)!;
    const own = new Map(AREAS.map(({ id }) => [id, 0]));
    for (const f of FACETS) if (own.has(f.areaId)) own.set(f.areaId, f.count);
    for (const { id } of AREAS) {
      const children = AREAS.filter((a) => a.parentId === id);
      const expected =
        own.get(id)! + children.reduce((sum, c) => sum + counts.get(c.id)!, 0);
      assert.equal(counts.get(id), expected, id);
    }
  });

  it("sums repeated facet rows for one area rather than letting the last one win", () => {
    // A producer that groups by (area, year) and hands the pairs straight through is a facet list
    // with several rows per area; the roll-up must add them, not overwrite.
    const perYear: AreaFacet[] = [
      { areaId: "germany", count: 3 },
      { areaId: "germany", count: 4 },
    ];
    assert.equal(rollUpAreaCounts(AREAS, perYear, false)!.get("germany"), 7);
  });
});
