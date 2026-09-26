import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  NOT_FILED,
  STRUCTURE_OVERLAP_NOTE,
  decodeSteps,
  encodeSteps,
  readStructureNarrowing,
  stepBackUpdates,
  structureSegments,
  tabulateStructure,
  type StructureCopy,
  type StructureStep,
  type StructureVocabulary,
} from "../../src/lib/collection-structure-rules";
import { copiesListQueryParams } from "../../src/lib/copies-list-url";
import { readYearFilter } from "../../src/lib/list-area-year-filter";
import { NO_LOCATION } from "../../src/lib/location-groups";
import { tagFilterWhere } from "../../src/lib/tag-filter";

// The collection structure screen's pure half (#1401): the segments each dimension offers, the
// counting, the drill-down steps, and the Copies list values the screen needed the list to learn
// (a decade, *No area*, *No tags*). That each count equals the list its link opens is held against a
// database in `tests/integration/collection-structure.test.ts`.

function copy(overrides: Partial<StructureCopy> = {}): StructureCopy {
  return {
    inCollection: true,
    forSale: false,
    forTrade: false,
    deliveryState: "delivered",
    conditionId: "used",
    certificateStatusId: null,
    formatId: null,
    subtypeId: null,
    issuedYear: 1950,
    areaIds: [],
    tagIds: [],
    locationId: null,
    ...overrides,
  };
}

const vocab: StructureVocabulary = {
  conditions: [
    { id: "mint", name: "Mint" },
    { id: "used", name: "Used" },
  ],
  certificateStatuses: [{ id: "expert", name: "Expertised" }],
  formats: [{ id: "pair", name: "Pair" }],
  subtypes: [{ id: "forgery", name: "Forgery" }],
  areas: [
    { id: "europe", name: "Europe", parentId: null },
    { id: "poland", name: "Poland", parentId: "europe" },
    { id: "galicia", name: "Galicia", parentId: "poland" },
    { id: "asia", name: "Asia", parentId: null },
  ],
  locations: [
    { id: "cabinet", name: "Cabinet", parentId: null },
    { id: "album", name: "Album", parentId: "cabinet" },
  ],
  tags: [
    { id: "birds", name: "birds" },
    { id: "check", name: "to check" },
  ],
  includeSubAreas: true,
  includeSubLocations: true,
};

function narrowing(url: Record<string, string> = {}) {
  return readStructureNarrowing(new URLSearchParams(url), vocab.areas);
}

function labels(dimension: Parameters<typeof structureSegments>[0], copies: StructureCopy[], url = {}) {
  return structureSegments(dimension, copies, vocab, narrowing(url)).map((s) => s.label);
}

describe("structure segments (#1401)", () => {
  it("offers the dictionaries in their settings' order, the no-value segment where the list's filter puts it", () => {
    assert.deepEqual(labels("condition", []), ["Mint", "Used"]);
    assert.deepEqual(labels("certificate", []), ["No certificate", "Expertised"]);
    assert.deepEqual(labels("format", []), ["Single", "Pair"]);
    assert.deepEqual(labels("subtype", []), ["No subtype", "Forgery"]);
  });

  it("offers the disposition marks and the intake stages, as the holdings tile does", () => {
    assert.deepEqual(labels("disposition", []), [
      "In collection",
      "For sale",
      "For trade",
      "Ordered",
      "In transit",
      "To sort",
    ]);
  });

  it("restricts a dimension to what the screen's own filter on it admits", () => {
    assert.deepEqual(labels("condition", [], { conditionIds: "used" }), ["Used"]);
    assert.deepEqual(labels("disposition", [], { deliveryStates: "ordered,delivered" }), [
      "In collection",
      "For sale",
      "For trade",
      "Ordered",
    ]);
    assert.deepEqual(labels("tags", [], { tagIds: "check,none" }), ["to check", "No tags"]);
  });

  it("opens a tree level by level, with the unfiled copies beside the top level", () => {
    assert.deepEqual(labels("area", []), ["Europe", "Asia", "No area"]);
    assert.deepEqual(labels("area", [], { areaId: "europe" }), ["Poland"]);
    assert.deepEqual(labels("area", [], { areaId: "galicia" }), ["Galicia"]);
    assert.deepEqual(labels("area", [], { areaId: "none" }), ["No area"]);
    assert.deepEqual(labels("location", []), ["Cabinet", "Not filed"]);
    assert.deepEqual(labels("location", [], { locationId: "cabinet" }), ["Album"]);
  });

  it("reads a tree node by node when the collector reads it this-area-only", () => {
    const only = { ...vocab, includeSubAreas: false };
    const at = (url: Record<string, string>) =>
      structureSegments("area", [], only, narrowing(url)).map((s) => s.label);
    assert.deepEqual(at({}), ["Europe", "Asia", "No area"]);
    // A child would select copies the narrowed screen does not show.
    assert.deepEqual(at({ areaId: "europe" }), ["Europe"]);
    const [europe] = structureSegments("area", [], only, narrowing());
    assert.equal(europe.match(copy({ areaIds: ["poland"] })), false);
  });

  it("counts a subtree under its root with the switch on", () => {
    const [europe] = structureSegments("area", [], vocab, narrowing());
    assert.equal(europe.match(copy({ areaIds: ["galicia"] })), true);
    assert.equal(europe.match(copy({ areaIds: ["asia"] })), false);
  });

  it("opens the year by decade, a decade into its years, and keeps No year last", () => {
    const copies = [1952, 1958, 1963, null].map((issuedYear) => copy({ issuedYear }));
    assert.deepEqual(labels("year", copies), ["1950s", "1960s", "No year"]);
    assert.deepEqual(labels("year", copies, { decade: "1950s" }), ["1952", "1958"]);
    assert.deepEqual(labels("year", copies, { year: "1958" }), ["1958"]);
    const [fifties] = structureSegments("year", copies, vocab, narrowing());
    assert.deepEqual(fifties.params, { year: "all", decade: "1950s" });
  });

  it("restates an all-of-several tag filter rather than narrowing it to one tag", () => {
    const [birds] = structureSegments("tags", [], vocab, narrowing({ tagIds: "birds,check", tagMode: "all" }));
    assert.deepEqual(birds.params, { tagIds: "birds,check", tagMode: "all" });
    const [anyBirds] = structureSegments("tags", [], vocab, narrowing({ tagIds: "birds,check" }));
    assert.deepEqual(anyBirds.params, { tagIds: "birds", tagMode: "" });
  });

  it("names the dimensions whose segments overlap, and only those", () => {
    const overlapping = Object.entries(STRUCTURE_OVERLAP_NOTE)
      .filter(([, note]) => note !== null)
      .map(([dimension]) => dimension);
    assert.deepEqual(overlapping, ["disposition", "area", "tags"]);
  });

  it("spells the unfiled copies as the Copies list does", () => {
    assert.equal(NOT_FILED, NO_LOCATION);
  });
});

describe("tabulateStructure (#1401)", () => {
  const copies = [
    copy({ conditionId: "mint", forSale: true, tagIds: ["birds", "check"] }),
    copy({ conditionId: "used", tagIds: ["birds"] }),
    copy({ conditionId: "used", inCollection: false }),
  ];

  it("counts a copy in every segment it is in and in the total once", () => {
    const table = tabulateStructure(
      copies,
      structureSegments("tags", copies, vocab, narrowing()),
      null,
      { rows: false, columns: false }
    );
    assert.deepEqual(
      table.rows.map((r) => [r.label, r.count]),
      [
        ["birds", 2],
        ["to check", 1],
        ["No tags", 1],
      ]
    );
    assert.equal(table.total, 3);
  });

  it("crosses two dimensions cell by cell and counts what falls in no row", () => {
    const table = tabulateStructure(
      copies,
      structureSegments("disposition", copies, vocab, narrowing()),
      structureSegments("condition", copies, vocab, narrowing()),
      { rows: true, columns: true }
    );
    const byLabel = Object.fromEntries(table.rows.map((r) => [r.label, r.cells]));
    assert.deepEqual(byLabel["In collection"], [1, 1]);
    assert.deepEqual(byLabel["For sale"], [1, 0]);
    assert.deepEqual(table.columns.map((c) => c.count), [1, 2]);
    // Out of the collection and offered nowhere.
    assert.equal(table.outsideRows, 1);
  });

  it("drops empty segments of an open-ended dimension and keeps a dictionary's", () => {
    const tags = tabulateStructure(copies, structureSegments("area", copies, vocab, narrowing()), null, {
      rows: false,
      columns: false,
    });
    assert.deepEqual(tags.rows.map((r) => r.label), ["No area"]);
    const formats = tabulateStructure(copies, structureSegments("format", copies, vocab, narrowing()), null, {
      rows: true,
      columns: false,
    });
    assert.deepEqual(formats.rows.map((r) => [r.label, r.count]), [
      ["Single", 3],
      ["Pair", 0],
    ]);
  });
});

describe("drill-down steps (#1401)", () => {
  const steps: StructureStep[] = [
    { label: "Europe", params: { areaId: "europe" }, prev: { areaId: "" } },
    { label: "Used", params: { conditionIds: "used" }, prev: { conditionIds: "mint,used" } },
    { label: "Poland", params: { areaId: "poland" }, prev: { areaId: "europe" } },
  ];

  it("round-trips through the address and drops what is malformed", () => {
    assert.deepEqual(decodeSteps(encodeSteps(steps)), steps);
    assert.deepEqual(decodeSteps("not json"), []);
    assert.deepEqual(decodeSteps(JSON.stringify([["x", { a: 1 }]])), []);
    assert.equal(encodeSteps([]), "");
  });

  it("steps back to where each later step found the filters", () => {
    assert.deepEqual(stepBackUpdates(steps, 0), { conditionIds: "mint,used", areaId: "europe" });
    assert.deepEqual(stepBackUpdates(steps, -1), { areaId: "", conditionIds: "mint,used" });
    assert.deepEqual(stepBackUpdates(steps, 2), {});
  });
});

describe("the Copies list's address, as a route reads it (#1401)", () => {
  const ctx = {
    areas: vocab.areas,
    includeSubAreas: true,
    includeSubLocations: true,
    catalogVendors: [{ id: "mi", abbreviation: "Mi" }],
  };
  const read = (url: Record<string, string>, over = {}) =>
    Object.fromEntries(copiesListQueryParams(new URLSearchParams(url), { ...ctx, ...over }));

  it("resolves an area into its subtree, or itself alone, and No area as a value", () => {
    assert.equal(read({ areaId: "europe" }).areaIds, "europe,poland,galicia");
    assert.equal(read({ areaId: "europe" }, { includeSubAreas: false }).areaIds, "europe");
    assert.equal(read({ areaId: "none" }).areaIds, "none");
    assert.equal(read({ areaId: "all" }).areaIds, undefined);
    assert.equal(read({ areaId: "deleted" }).areaIds, undefined);
  });

  it("reads a decade only while the rail names no single year", () => {
    assert.equal(read({ year: "all", decade: "1950s" }).year, "1950s");
    assert.equal(read({ year: "1955", decade: "1950s" }).year, "1955");
    assert.equal(read({ decade: "195" }).year, undefined);
  });

  it("scopes a location as the list's switch does, and parses a catalogue search", () => {
    assert.equal(read({ locationId: "cabinet" }).locationExact, undefined);
    assert.equal(read({ locationId: "cabinet" }, { includeSubLocations: false }).locationExact, "true");
    const search = read({ search: "Mi PL 200" });
    assert.equal(search.catalogVendorId, "mi");
    assert.equal(search.catalogNumber, "200");
  });
});

describe("the list values the screen needed (#1401)", () => {
  it("reads a decade as a span of ten years, beside a year and No year", () => {
    assert.deepEqual(readYearFilter("1950s"), { yearFrom: 1950, yearTo: 1959 });
    assert.deepEqual(readYearFilter("1955"), { year: 1955 });
    assert.deepEqual(readYearFilter("none"), { year: "none" });
    assert.deepEqual(readYearFilter("1955s"), {});
    assert.deepEqual(readYearFilter(null), {});
  });

  it("matches the untagged things alone, or beside the tags ticked with them", () => {
    assert.deepEqual(tagFilterWhere({ tagIds: ["none"] }), { tags: { none: {} } });
    assert.deepEqual(tagFilterWhere({ tagIds: ["none", "a", "b"], tagMode: "all" }), {
      OR: [
        { tags: { none: {} } },
        { AND: [{ tags: { some: { tagId: "a" } } }, { tags: { some: { tagId: "b" } } }] },
      ],
    });
  });
});
