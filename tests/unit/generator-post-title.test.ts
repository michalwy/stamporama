import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionAreaData } from "../../src/lib/areas";
import { postYearSpan, suggestGeneratorPostTitle, type PostTitleCopy } from "../../src/lib/generator-post-title";

function area(over: Partial<CollectionAreaData> & { id: string; name: string }): CollectionAreaData {
  return {
    parentId: null,
    description: null,
    primaryCatalogNameId: null,
    primaryCatalogVendorId: null,
    catalogPrefix: null,
    anchorMarkets: [],
    titleName: null,
    titleNameByLanguage: {},
    symbol: null,
    coverSymbols: null,
    assignable: true,
    sortOrder: 0,
    stampCount: 0,
    childCount: 0,
    catalogEntries: [],
    vendorEntries: [],
    ...over,
  };
}

// Polska ⊃ Generalgouvernement ⊃ Dienstmarken, Polska ⊃ PRL; Deutschland at the top level beside it.
const areas = [
  area({ id: "pl", name: "Polska", titleNameByLanguage: { de: "Polen" } }),
  area({ id: "gg", name: "Generalgouvernement", parentId: "pl" }),
  area({ id: "ggd", name: "Dienstmarken", parentId: "gg" }),
  area({ id: "prl", name: "Polska Ludowa", titleName: "PRL", parentId: "pl" }),
  area({ id: "de", name: "Deutschland" }),
];

function copy(areaId: string | null, issueYear: number | null): PostTitleCopy {
  return { areaId, issueYear, carriedStamps: [] };
}

describe("postYearSpan (#2105)", () => {
  it("writes one year alone, a span in one century short, across a century in full", () => {
    assert.equal(postYearSpan([]), "");
    assert.equal(postYearSpan([1940, 1940]), "1940");
    assert.equal(postYearSpan([1944, 1940, 1942]), "1940–44");
    assert.equal(postYearSpan([1900, 1901]), "1900–01");
    assert.equal(postYearSpan([1998, 2003]), "1998–2003");
  });
});

describe("suggestGeneratorPostTitle (#2105)", () => {
  it("names the deepest area holding every copy, with the span of their issues' years", () => {
    assert.equal(suggestGeneratorPostTitle(areas, [copy("gg", 1940), copy("ggd", 1944)]), "Generalgouvernement 1940–44");
    assert.equal(suggestGeneratorPostTitle(areas, [copy("ggd", 1941)]), "Dienstmarken 1941");
  });

  it("takes a top-level area when that is all the copies share", () => {
    assert.equal(suggestGeneratorPostTitle(areas, [copy("gg", 1940), copy("prl", 1952)]), "Polska 1940–52");
  });

  it("names the area in the default language, by its own title name", () => {
    assert.equal(suggestGeneratorPostTitle(areas, [copy("prl", 1950), copy("prl", 1955)]), "PRL 1950–55");
  });

  it("is the years alone with no shared area, and empty with no years either", () => {
    assert.equal(suggestGeneratorPostTitle(areas, [copy("gg", 1940), copy("de", 1950)]), "1940–50");
    assert.equal(suggestGeneratorPostTitle(areas, [copy("gg", 1940), copy(null, 1941)]), "1940–41");
    assert.equal(suggestGeneratorPostTitle(areas, [copy("gg", null), copy("de", null)]), "");
    assert.equal(suggestGeneratorPostTitle(areas, []), "");
  });

  it("leaves out a year it does not know, and the area alone stands", () => {
    assert.equal(suggestGeneratorPostTitle(areas, [copy("gg", null), copy("gg", 1943)]), "Generalgouvernement 1943");
    assert.equal(suggestGeneratorPostTitle(areas, [copy("gg", null)]), "Generalgouvernement");
  });

  it("counts every stamp of a piece of several", () => {
    const cover: PostTitleCopy = {
      areaId: "gg",
      issueYear: 1940,
      carriedStamps: [
        { areaId: "gg", issues: [{ year: 1940 }] },
        { areaId: "prl", issues: [{ year: 1945 }] },
      ],
    };
    assert.equal(suggestGeneratorPostTitle(areas, [cover, copy("gg", 1941)]), "Polska 1940–45");
  });
});
