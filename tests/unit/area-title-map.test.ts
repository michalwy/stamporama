import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionAreaData } from "../../src/lib/areas";
import { buildAreaTitleMap, buildAreaTitleEntries } from "../../src/lib/area-vendor";

function area(over: Partial<CollectionAreaData> & { id: string; name: string }): CollectionAreaData {
  return {
    parentId: null,
    description: null,
    primaryCatalogNameId: null,
    primaryCatalogVendorId: null,
    catalogPrefix: null,
    titleName: null,
    titleNameByLanguage: {},
    assignable: true,
    sortOrder: 0,
    stampCount: 0,
    childCount: 0,
    catalogEntries: [],
    vendorEntries: [],
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

// Per-language resolution (#293): the roll-up picks the area, the language picks its spelling.
describe("buildAreaTitleMap with a language", () => {
  const poland = area({
    id: "pl",
    name: "Poland",
    titleName: "Poland",
    titleNameByLanguage: { pl: "Polska" },
  });
  const second = area({ id: "sr", name: "Second Republic", parentId: "pl" });
  const gg = area({
    id: "gg",
    name: "General Gouvernement",
    parentId: "pl",
    titleName: "General Gouvernement",
  });
  const areas = [poland, second, gg];

  it("uses an area's translated title name for that language", () => {
    assert.equal(buildAreaTitleMap(areas, "pl").get("pl"), "Polska");
  });

  it("keeps the default title name for a language with no translation", () => {
    assert.equal(buildAreaTitleMap(areas, "de").get("pl"), "Poland");
    assert.equal(buildAreaTitleMap(areas, null).get("pl"), "Poland");
  });

  it("carries the translation through the ancestor roll-up", () => {
    assert.equal(buildAreaTitleMap(areas, "pl").get("sr"), "Polska");
  });

  it("falls back per node, not per chain — an untranslated area keeps its own default", () => {
    // "General Gouvernement" sets its own title name but no Polish one: it must keep that text
    // rather than deferring to its translated parent ("Polska"), which names a different area.
    assert.equal(buildAreaTitleMap(areas, "pl").get("gg"), "General Gouvernement");
  });

  it("lets a translation alone make an area public in that language", () => {
    const root = area({ id: "r", name: "Root", titleName: "Root" });
    const leaf = area({
      id: "l",
      name: "Leaf",
      parentId: "r",
      titleNameByLanguage: { pl: "Liść" },
    });
    assert.equal(buildAreaTitleMap([root, leaf], "pl").get("l"), "Liść");
    assert.equal(buildAreaTitleMap([root, leaf], "en").get("l"), "Root");
  });

  it("treats a whitespace-only translation as missing", () => {
    const root = area({ id: "r", name: "Root", titleName: "Root", titleNameByLanguage: { pl: "  " } });
    assert.equal(buildAreaTitleMap([root], "pl").get("r"), "Root");
  });

  it("falls back to the area's own name when nothing is set in any language", () => {
    const a = area({ id: "a", name: "Germany" });
    assert.equal(buildAreaTitleMap([a], "pl").get("a"), "Germany");
  });
});

describe("buildAreaTitleEntries fallback reporting (#298)", () => {
  const root = area({ id: "r", name: "Root", titleName: "Root", titleNameByLanguage: { pl: "Korzeń" } });
  const leaf = area({ id: "l", name: "Leaf", parentId: "r" });

  it("reports no fallback when the winning name is translated", () => {
    assert.deepEqual(buildAreaTitleEntries([root, leaf], "pl").get("l"), {
      title: "Korzeń",
      fellBack: false,
      sourceAreaId: "r",
    });
  });

  it("reports a fallback when the winning name has no translation", () => {
    assert.deepEqual(buildAreaTitleEntries([root, leaf], "de").get("l"), {
      title: "Root",
      fellBack: true,
      sourceAreaId: "r",
    });
  });

  it("reports a fallback when nothing is configured and the area's own name is used", () => {
    const a = area({ id: "a", name: "Germany" });
    assert.deepEqual(buildAreaTitleEntries([a], "pl").get("a"), { title: "Germany", fellBack: true, sourceAreaId: "a" });
  });

  it("never reports a fallback without a language", () => {
    assert.equal(buildAreaTitleEntries([root, leaf], null).get("l")?.fellBack, false);
  });
});

describe("buildAreaTitleEntries source area (#299)", () => {
  it("names the ancestor whose title rolled up, since that is the row to translate", () => {
    const root = area({ id: "r", name: "Root", titleName: "Root" });
    const leaf = area({ id: "l", name: "Leaf", parentId: "r" });
    assert.equal(buildAreaTitleEntries([root, leaf], "pl").get("l")?.sourceAreaId, "r");
  });

  it("names the area itself when nothing rolls up and its own name is used", () => {
    const a = area({ id: "a", name: "Germany" });
    assert.equal(buildAreaTitleEntries([a], "pl").get("a")?.sourceAreaId, "a");
  });
});
