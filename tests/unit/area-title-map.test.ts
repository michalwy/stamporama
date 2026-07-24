import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionAreaData } from "../../src/lib/areas";
import { buildAreaTitleMap } from "../../src/lib/area-vendor";

function area(over: Partial<CollectionAreaData> & { id: string; name: string }): CollectionAreaData {
  return {
    parentId: null,
    description: null,
    primaryCatalogNameId: null,
    titleName: null,
    stampCount: 0,
    childCount: 0,
    catalogEntries: [],
    ...over,
  };
}

describe("buildAreaTitleMap", () => {
  // Poland (titleName "Poland") ⊃ { Second Republic (blank), General Gouvernement (own title) }
  const poland = area({ id: "pl", name: "Poland", titleName: "Poland" });
  const second = area({ id: "sr", name: "Second Republic", parentId: "pl" });
  const gg = area({ id: "gg", name: "General Gouvernement", parentId: "pl", titleName: "General Gouvernement" });
  const map = buildAreaTitleMap([poland, second, gg]);

  it("uses an area's own title name when set", () => {
    assert.equal(map.get("pl"), "Poland");
    assert.equal(map.get("gg"), "General Gouvernement");
  });

  it("rolls a blank area up to the nearest ancestor that sets one", () => {
    assert.equal(map.get("sr"), "Poland");
  });

  it("falls back to the area's own name when nothing is set up the chain", () => {
    const a = area({ id: "a", name: "Germany" });
    const b = area({ id: "b", name: "Bavaria", parentId: "a" });
    const m = buildAreaTitleMap([a, b]);
    assert.equal(m.get("a"), "Germany");
    assert.equal(m.get("b"), "Bavaria");
  });

  it("picks the nearest ancestor when several set a title name", () => {
    const root = area({ id: "r", name: "Root", titleName: "Root" });
    const mid = area({ id: "m", name: "Mid", parentId: "r", titleName: "Mid" });
    const leaf = area({ id: "l", name: "Leaf", parentId: "m" });
    const m = buildAreaTitleMap([root, mid, leaf]);
    assert.equal(m.get("l"), "Mid");
  });

  it("treats a whitespace-only title name as blank", () => {
    const root = area({ id: "r", name: "Root", titleName: "Root" });
    const leaf = area({ id: "l", name: "Leaf", parentId: "r", titleName: "   " });
    const m = buildAreaTitleMap([root, leaf]);
    assert.equal(m.get("l"), "Root");
  });
});
