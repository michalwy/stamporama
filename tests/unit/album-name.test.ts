import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionAreaData } from "../../src/lib/areas";
import { albumNameState, suggestAlbumName } from "../../src/lib/album-name";
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

// An existing album's name, read the other way round from `suggestAlbumName` (#1308, #1311): is it
// still the fallback the create dialog offered, and is there anything better to offer now?
describe("albumNameState", () => {
  const album = (name: string, over: { areaId?: string; dismissed?: string | null } = {}) => ({
    name,
    collectionAreaId: over.areaId ?? "dr",
    dismissedNameSuggestion: over.dismissed ?? null,
  });

  it("offers the area's translated name to an album still called by the default one", () => {
    assert.deepEqual(albumNameState(areas, album("Deutsches Reich"), "pl"), {
      gap: null,
      suggestion: "Rzesza Niemiecka",
    });
  });

  it("offers nothing to a name the collector wrote", () => {
    assert.deepEqual(albumNameState(areas, album("Mein Reich"), "pl"), {
      gap: null,
      suggestion: null,
    });
  });

  it("offers nothing once the album carries the translated name", () => {
    assert.deepEqual(albumNameState(areas, album("Rzesza Niemiecka"), "pl"), {
      gap: null,
      suggestion: null,
    });
  });

  it("reports a gap on the area where no translation exists yet, and offers nothing", () => {
    const state = albumNameState(areas, album("Deutsches Reich"), "cs");
    assert.equal(state.suggestion, null);
    assert.deepEqual(state.gap, {
      field: "albumName",
      entityType: "area",
      entityId: "dr",
      entityField: "titleName",
      defaultValue: "Deutsches Reich",
    });
  });

  it("says nothing in the collection's default language, where nothing falls back", () => {
    assert.deepEqual(albumNameState(areas, album("Deutsches Reich"), null), {
      gap: null,
      suggestion: null,
    });
  });

  it("does not roll up: a grouping level is compared by its own name, as #797 suggested it", () => {
    const translated = [
      reich,
      { ...weimar, titleNameByLanguage: { pl: "Republika Weimarska" } },
    ];
    assert.equal(
      albumNameState(translated, album("Weimarer Republik", { areaId: "wr" }), "pl").suggestion,
      "Republika Weimarska"
    );
    // Named after the parent it would have rolled up to: not the fallback of *this* area.
    assert.deepEqual(
      albumNameState(translated, album("Deutsches Reich", { areaId: "wr" }), "pl"),
      { gap: null, suggestion: null }
    );
  });

  it("keeps a dismissed offer away until the translation changes", () => {
    assert.equal(
      albumNameState(areas, album("Deutsches Reich", { dismissed: "Rzesza Niemiecka" }), "pl")
        .suggestion,
      null
    );
    const renamed = [{ ...reich, titleNameByLanguage: { pl: "Rzesza" } }, weimar];
    assert.equal(
      albumNameState(renamed, album("Deutsches Reich", { dismissed: "Rzesza Niemiecka" }), "pl")
        .suggestion,
      "Rzesza"
    );
  });

  it("offers nothing where the translation reads the same as the default", () => {
    const same = [{ ...reich, titleNameByLanguage: { pl: "Deutsches Reich" } }, weimar];
    assert.deepEqual(albumNameState(same, album("Deutsches Reich"), "pl"), {
      gap: null,
      suggestion: null,
    });
  });
});
