import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CollectionAreaData } from "../../src/lib/areas";
import {
  agentArea,
  areaSubtree,
  areaTreeOrder,
  areaUnderItself,
  groupingOnlyHoldsMaterial,
  issueCatalogues,
  noValuingBook,
  nothingToJoin,
  ownCatalogues,
  parseCatalogueEntries,
  parseJoinedPrefixes,
  resolvedCatalogues,
  sameResolvedCatalogues,
  type AreaNames,
} from "../../src/lib/agent-api/area-reads";
import { isApiError } from "../../src/lib/agent-api/errors";

// The pure half of the area operations (#1539): the tree order `list_areas` reads in, the spelling of
// an area's catalogues going out and coming in, the configuration an issue resolves, and the
// refusals. The domain writes and the screen's rules as calls are `tests/integration/agent-api-areas.test.ts`.

const NAMES: AreaNames = {
  catalogues: new Map([
    ["mi", "Mi"],
    ["fi", "Fi"],
  ]),
  books: new Map([["mi-book", "Michel Europa"]]),
};

function area(id: string, parentId: string | null, sortOrder: number, extra: Partial<CollectionAreaData> = {}): CollectionAreaData {
  return {
    id,
    name: id[0].toUpperCase() + id.slice(1),
    parentId,
    description: null,
    primaryCatalogNameId: null,
    primaryCatalogVendorId: null,
    catalogPrefix: null,
    catalogPrefixJoined: false,
    anchorMarkets: [],
    titleName: null,
    titleNameByLanguage: {},
    symbol: null,
    coverSymbols: null,
    stillValidForPostage: null,
    valuationMethod: null,
    assignable: true,
    sortOrder,
    stampCount: 0,
    childCount: 0,
    catalogEntries: [],
    vendorEntries: [],
    ...extra,
  };
}

const EUROPE = area("europe", null, 0, {
  assignable: false,
  primaryCatalogNameId: "mi-book",
  primaryCatalogVendorId: "mi",
  catalogEntries: [
    { catalogVendorId: "mi", vendorName: "Michel", vendorAbbreviation: "Mi", prefix: null, prefixJoined: false, catalogNameId: "mi-book", catalogName: "Michel Europa" },
  ],
  vendorEntries: [{ catalogVendorId: "mi", vendorName: "Michel", vendorAbbreviation: "Mi", areaPrefix: null, prefixJoined: false }],
});
const POLAND = area("poland", "europe", 1, {
  catalogPrefix: "PL",
  vendorEntries: [{ catalogVendorId: "fi", vendorName: "Fischer", vendorAbbreviation: "Fi", areaPrefix: null, prefixJoined: false }],
});
const GG = area("gg", "poland", 0, {
  vendorEntries: [{ catalogVendorId: "fi", vendorName: "Fischer", vendorAbbreviation: "Fi", areaPrefix: "", prefixJoined: false }],
});
const AUSTRIA = area("austria", "europe", 0, { catalogPrefix: "A" });
const ASIA = area("asia", null, 1);
const AREAS = [GG, POLAND, ASIA, AUSTRIA, EUROPE];

describe("list_areas' order (#1539)", () => {
  it("reads depth first, each sibling group in the collector's order", () => {
    assert.deepEqual(areaTreeOrder(AREAS).map((row) => row.id), ["europe", "austria", "poland", "gg", "asia"]);
  });

  it("states a row's position among its siblings and its path from the root", () => {
    const row = agentArea(AREAS, POLAND, NAMES, { issueCount: 3, path: "/c/x/areas" });
    assert.equal(row.position, 2);
    assert.equal(row.areaPath, "Europe › Poland");
    assert.equal(row.parentId, "europe");
    assert.equal(row.issueCount, 3);
  });

  it("reaches an area's whole branch, itself included", () => {
    assert.deepEqual([...areaSubtree(AREAS, "poland")].sort(), ["gg", "poland"]);
  });
});

describe("an area's catalogues (#1539)", () => {
  it("states what the area sets in the spelling the writes take", () => {
    assert.deepEqual(ownCatalogues(GG, NAMES), { catalogues: ["Fi: -"], priceBooks: [] });
    assert.deepEqual(ownCatalogues(EUROPE, NAMES), {
      catalogues: ["Mi"],
      leadingCatalogue: "Mi",
      priceBooks: ["Michel Europa"],
      valuingBook: "Michel Europa",
    });
  });

  it("resolves what an issue gets by walking up the tree", () => {
    assert.deepEqual(resolvedCatalogues(AREAS, "poland", NAMES), {
      leadingCatalogue: "Mi",
      catalogues: ["Fi·PL", "Mi·PL"],
      valuingBook: "Michel Europa",
    });
    // GG states *no prefix* for Fischer, which stops Poland's PL reaching it; Michel still inherits.
    assert.deepEqual(resolvedCatalogues(AREAS, "gg", NAMES).catalogues, ["Fi", "Mi·PL"]);
  });

  it("lets an issue's own prefix replace the area's for that issue alone", () => {
    const own = new Map([["mi", { prefix: "GG", joined: false }]]);
    assert.deepEqual(resolvedCatalogues(AREAS, "poland", NAMES, own).catalogues, ["Fi·PL", "Mi·GG"]);
  });

  it("states an issue's own prefixes beside what they resolve to (#1606)", () => {
    assert.deepEqual(issueCatalogues(AREAS, "poland", NAMES, new Map([["mi", { prefix: "GG", joined: false }]])), {
      own: ["Fi", "Mi: GG"],
      resolved: ["Fi·PL", "Mi·GG"],
    });
    // A stored prefix for a catalogue the area does not keep resolves nowhere and is not stated.
    assert.deepEqual(issueCatalogues(AREAS, "austria", NAMES, new Map([["fi", { prefix: "X", joined: true }]])), {
      own: ["Mi"],
      resolved: ["Mi·A"],
    });
  });

  it("states a prefix that joins its number beside the spelling (#2658)", () => {
    const reich = area("reich", "europe", 2, {
      catalogPrefix: "DR D",
      catalogPrefixJoined: true,
      vendorEntries: [
        { catalogVendorId: "fi", vendorName: "Fischer", vendorAbbreviation: "Fi", areaPrefix: "PL TP W", prefixJoined: true },
      ],
    });
    const below = area("below", "reich", 0);
    const areas = [...AREAS, reich, below];
    assert.deepEqual(ownCatalogues(reich, NAMES), {
      prefix: "DR D",
      prefixJoined: true,
      catalogues: ["Fi: PL TP W"],
      joinedPrefixes: ["Fi"],
      priceBooks: [],
    });
    // A spaced prefix says so; an area without one says nothing of joining.
    assert.equal(ownCatalogues(POLAND, NAMES).prefixJoined, false);
    assert.equal("prefixJoined" in ownCatalogues(GG, NAMES), false);
    assert.equal("joinedPrefixes" in ownCatalogues(POLAND, NAMES), false);
    // A child that sets nothing inherits the prefix and its joining together.
    assert.deepEqual(resolvedCatalogues(areas, "below", NAMES), {
      leadingCatalogue: "Mi",
      catalogues: ["Fi·PL TP W", "Mi·DR D"],
      joinedPrefixes: ["Fi", "Mi"],
      valuingBook: "Michel Europa",
    });
    assert.equal("joinedPrefixes" in resolvedCatalogues(AREAS, "poland", NAMES), false);
    // An issue's own spaced prefix replaces a joined one for that issue, and a joined one is stated.
    assert.deepEqual(
      issueCatalogues(areas, "below", NAMES, new Map([["mi", { prefix: "DR", joined: false }], ["fi", { prefix: "W", joined: true }]])),
      { own: ["Fi: W", "Mi: DR"], ownJoinedPrefixes: ["Fi"], resolved: ["Fi·W", "Mi·DR"], resolvedJoinedPrefixes: ["Fi"] }
    );
    // A joining alone is a change.
    const spaced = resolvedCatalogues(areas, "below", NAMES, new Map([["mi", { prefix: "DR D", joined: false }]]));
    assert.equal(sameResolvedCatalogues(resolvedCatalogues(areas, "below", NAMES), spaced), false);
  });

  it("reads joined_prefixes as a catalogue and true or false (#2658)", () => {
    assert.deepEqual(parseJoinedPrefixes(["Mi: true", "Fi : FALSE"], "joined_prefixes"), [
      { key: "Mi", joined: true },
      { key: "Fi", joined: false },
    ]);
    for (const bad of [["Mi"], ["Mi: yes"], [": true"], ["Mi: true", "mi: false"]]) {
      assert.throws(() => parseJoinedPrefixes(bad, "joined_prefixes"), (error) => isApiError(error));
    }
    const refusal = nothingToJoin('"Mi" on this issue', "joined_prefixes", "Give it a prefix.");
    assert.match(refusal.message, /has no prefix to join\. Nothing was written\. Give it a prefix\./);
  });

  it("tells a change in prefix from none", () => {
    const poland = resolvedCatalogues(AREAS, "poland", NAMES);
    assert.equal(sameResolvedCatalogues(poland, resolvedCatalogues(AREAS, "poland", NAMES)), true);
    assert.equal(sameResolvedCatalogues(poland, resolvedCatalogues(AREAS, "austria", NAMES)), false);
  });

  it("reads the three states of a catalogue's prefix", () => {
    assert.deepEqual(parseCatalogueEntries(["Mi", "Fi: GG", "Sg: -"], "catalogues"), [
      { key: "Mi", areaPrefix: null },
      { key: "Fi", areaPrefix: "GG" },
      { key: "Sg", areaPrefix: "" },
    ]);
  });

  it("refuses a catalogue named twice, or an entry with nothing after its colon", () => {
    for (const entries of [["Mi", "mi: PL"], ["Mi:"], [": PL"]]) {
      assert.throws(() => parseCatalogueEntries(entries, "catalogues"), isApiError, entries.join(", "));
    }
  });
});

describe("the refusals (#1539)", () => {
  it("say what the screen's rule is and that nothing was written", () => {
    assert.match(areaUnderItself("Poland", "GG", false).message, /"GG" is under "Poland".*Nothing was moved/);
    assert.match(areaUnderItself("Poland", "Poland", true).message, /cannot be put under itself/);
    assert.match(groupingOnlyHoldsMaterial("Poland", 2, 1).message, /2 issues and 1 stamp/);
    assert.match(noValuingBook("Asia", null).message, /valuing_book.*assignable/);
  });
});
