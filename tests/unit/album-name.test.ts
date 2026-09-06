import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionAreaData } from "../../src/lib/areas";
import { suggestAlbumName } from "../../src/lib/album-name";
import { areaOwnTitleName, buildAreaTitleMap } from "../../src/lib/area-vendor";

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

// Deutsches Reich (a public title, translated into Polish) ⊃ Weimar (a grouping level with no title
// name of its own). Weimar is the case the two readings disagree about, and the reason this module
// exists: the listing title rolls it up to its parent, and an album must not.
const reich = area({
  id: "dr",
  name: "Deutsches Reich",
  titleName: "Deutsches Reich",
  titleNameByLanguage: { pl: "Rzesza Niemiecka" },
});
const weimar = area({ id: "wr", name: "Weimarer Republik", parentId: "dr" });
const areas = [reich, weimar];

describe("suggestAlbumName", () => {
  it("suggests the area's own title name", () => {
    assert.equal(suggestAlbumName(areas, "dr", "de"), "Deutsches Reich");
  });

  it("suggests the area's name in the album's language where a translation exists", () => {
    assert.equal(suggestAlbumName(areas, "dr", "pl"), "Rzesza Niemiecka");
  });

  it("falls back to the default-language title name when the album's language has no translation", () => {
    assert.equal(suggestAlbumName(areas, "dr", "cs"), "Deutsches Reich");
  });

  // The decision this module was written for (#797). `buildAreaTitleMap` answers "Deutsches Reich"
  // for Weimar — right for a listing title, wrong for an album the collector anchored on Weimar.
  it("does not roll a grouping level up to its parent, where the listing title does", () => {
    assert.equal(buildAreaTitleMap(areas, "pl").get("wr"), "Rzesza Niemiecka");
    assert.equal(suggestAlbumName(areas, "wr", "pl"), "Weimarer Republik");
  });

  it("prefers a grouping level's own translation over its own name", () => {
    const translated = [
      reich,
      area({
        id: "wr",
        name: "Weimarer Republik",
        parentId: "dr",
        titleNameByLanguage: { pl: "Republika Weimarska" },
      }),
    ];
    assert.equal(suggestAlbumName(translated, "wr", "pl"), "Republika Weimarska");
  });

  // The language selects the spelling; it is never appended. Two languages, two names, and neither
  // carries a language tag — the string is what prints at the top of every page.
  it("never puts the language in the name", () => {
    assert.equal(suggestAlbumName(areas, "dr", "pl"), "Rzesza Niemiecka");
    assert.equal(suggestAlbumName(areas, "dr", "en"), "Deutsches Reich");
  });

  it("matches a regional language code against the translation it belongs to", () => {
    assert.equal(suggestAlbumName(areas, "dr", "pl-PL"), "Rzesza Niemiecka");
  });

  it("suggests nothing until an area is chosen", () => {
    assert.equal(suggestAlbumName(areas, "", "pl"), "");
    assert.equal(suggestAlbumName(areas, null, "pl"), "");
  });

  it("suggests nothing for an id that names no area", () => {
    assert.equal(suggestAlbumName(areas, "gone", "pl"), "");
  });

  it("suggests the area's plain name when no language is chosen", () => {
    assert.equal(suggestAlbumName([weimar], "wr", null), "Weimarer Republik");
  });
});

describe("areaOwnTitleName", () => {
  it("is null for an id that names no area", () => {
    assert.equal(areaOwnTitleName(areas, "gone", "pl"), null);
  });

  it("treats a whitespace-only title name as none and keeps the area's own name", () => {
    const blank = [area({ id: "a", name: "Bavaria", titleName: "   " })];
    assert.equal(areaOwnTitleName(blank, "a", null), "Bavaria");
  });
});
