import type { AreaCatalogEntry, AreaVendorEntry, CollectionAreaData } from "../../src/lib/areas";

// **The two-level area prefix** (#675), stated once so both resolvers are held to the same answers.
//
// A prefix lives on the area (`catalogPrefix`, for every vendor) and on the per-(area, vendor) row
// (`areaPrefix`, the exception). Resolving a pair walks toward the root and stops at the first area
// that *states* one — a vendor row with a non-null `areaPrefix`, or the area's own prefix — the row
// winning inside that one area. That is ADR-0020's *where outranks for which*, and it is why the
// worked example below resolves Fischer under GG to `GG` rather than to Poland's Fischer exception:
// GG is the nearer area and it decided, so repeating the Fischer exception on GG is how you would
// keep it.
//
// The row has three states, and the difference between two of them is the whole reason the area
// prefix is usable: `''` is the stated *no prefix here* and stops the walk, while NULL is the
// ordinary tick — the vendor is recorded here and its prefix inherits, the area's own next. Without
// that split, ticking Mi, Sg, Yt and Fi on a `PL` area would write four rows that each kill `PL`.
//
// The rule is implemented twice on purpose — `area-prefix.ts` reads Prisma rows on the server,
// `area-vendor.ts` reads the client's area payload — and the prefix is catalog *identity* (#66,
// #377), so a disagreement between them is a stamp that renders as one thing and de-duplicates as
// another. `tests/unit/area-vendor-prefix.test.ts` runs these through the client resolver and
// `tests/integration/area-prefix-resolution.test.ts` runs them through both.
//
// Each stated prefix also carries its **joining** (#2657) — whether it meets the number with no
// space, `DR D12` — and the walk returns it from the level the prefix came from, so a child that says
// nothing inherits the prefix and its joining together, and a nearer prefix brings its own.

export const MICHEL = "mi";
export const FISCHER = "fi";
export const SCOTT = "sc";

/** One area as the fixture states it: what it says at each of the two levels, and its books. */
interface FixtureArea {
  id: string;
  name: string;
  parentId: string | null;
  catalogPrefix: string | null;
  /** Whether `catalogPrefix` joins the number with no space (#2657). */
  catalogPrefixJoined?: boolean;
  /** Vendors with a book attached here. */
  books: string[];
  /** `CollectionAreaVendor` rows: `''` is the stated "no prefix here", null is the ordinary tick
   * whose prefix inherits, anything else is that prefix — joined to the number when the third
   * element says so (#2657). */
  vendorRows: Array<[vendorId: string, areaPrefix: string | null, prefixJoined?: boolean]>;
}

const FIXTURE: FixtureArea[] = [
  // Poland says `PL` for everyone. Michel is ticked plainly, so it takes `PL`. Fischer is the
  // exception — its numbers carry no prefix here. Scott is recorded with its own prefix while Poland
  // owns no Scott volume, the case that was inexpressible before #675, since attaching a book was
  // the only way to obtain a vendor.
  {
    id: "pl",
    name: "Poland",
    parentId: null,
    catalogPrefix: "PL",
    books: [MICHEL, FISCHER],
    vendorRows: [
      [MICHEL, null],
      [FISCHER, ""],
      [SCOTT, "POL"],
    ],
  },
  // General Gouvernement says `GG` and says nothing about any single vendor.
  {
    id: "gg",
    name: "General Gouvernement",
    parentId: "pl",
    catalogPrefix: "GG",
    books: [],
    vendorRows: [],
  },
  // Danzig says `DZ` and ticks Michel. The tick must not defeat the prefix it was meant to pick up.
  {
    id: "dz",
    name: "Danzig",
    parentId: "pl",
    catalogPrefix: "DZ",
    books: [],
    vendorRows: [[MICHEL, null]],
  },
  // Silesia says nothing at all, so every question passes to Poland.
  { id: "sl", name: "Silesia", parentId: "pl", catalogPrefix: null, books: [], vendorRows: [] },
  // France is silent all the way to the root.
  { id: "fr", name: "France", parentId: null, catalogPrefix: null, books: [], vendorRows: [] },
  // Poland's postage-due section (#2657): a Michel row whose prefix joins the number — `PL TP W1`.
  {
    id: "tp",
    name: "Postage due",
    parentId: "pl",
    catalogPrefix: null,
    books: [],
    vendorRows: [[MICHEL, "PL TP W", true]],
  },
  // The Reich's service stamps join their prefix for every vendor — `DR D12` — except Scott, whose
  // own row keeps its space: the row's prefix brings the row's joining.
  {
    id: "dr",
    name: "Deutsches Reich, Dienst",
    parentId: null,
    catalogPrefix: "DR D",
    catalogPrefixJoined: true,
    books: [],
    vendorRows: [[SCOTT, "GER O", false]],
  },
  // A child that says nothing inherits `DR D` and its missing space together.
  { id: "drc", name: "Dienst, Länder", parentId: "dr", catalogPrefix: null, books: [], vendorRows: [] },
  // A child with its own prefix brings its own joining — the space comes back.
  { id: "drs", name: "Dienst, Sachsen", parentId: "dr", catalogPrefix: "SA", books: [], vendorRows: [] },
];

export const PREFIX_CASES: Array<{
  areaId: string;
  vendorId: string;
  expected: string | null;
  /** Whether the resolved prefix joins the number with no space (#2657); false when omitted. */
  joined?: boolean;
}> = [
  // A plain tick states nothing about the prefix, so the area's own answers.
  { areaId: "pl", vendorId: MICHEL, expected: "PL" },
  // A row that *does* state one beats the area's prefix inside the same area — `''` meaning none.
  { areaId: "pl", vendorId: FISCHER, expected: null },
  { areaId: "pl", vendorId: SCOTT, expected: "POL" },
  { areaId: "gg", vendorId: MICHEL, expected: "GG" },
  // The worked example: the nearer area decided, for Fischer too.
  { areaId: "gg", vendorId: FISCHER, expected: "GG" },
  { areaId: "gg", vendorId: SCOTT, expected: "GG" },
  // The tick does not defeat the area prefix it was meant to pick up.
  { areaId: "dz", vendorId: MICHEL, expected: "DZ" },
  { areaId: "dz", vendorId: FISCHER, expected: "DZ" },
  // Silence inherits both levels from Poland — including the `''` row, which is what stops `PL`
  // reaching Fischer here.
  { areaId: "sl", vendorId: MICHEL, expected: "PL" },
  { areaId: "sl", vendorId: FISCHER, expected: null },
  { areaId: "sl", vendorId: SCOTT, expected: "POL" },
  // Nobody up the chain says anything.
  { areaId: "fr", vendorId: MICHEL, expected: null },
  // #2657: a joined row prefix; the area's other vendors keep the ancestor's spaced `PL`.
  { areaId: "tp", vendorId: MICHEL, expected: "PL TP W", joined: true },
  { areaId: "tp", vendorId: FISCHER, expected: null },
  { areaId: "tp", vendorId: SCOTT, expected: "POL" },
  { areaId: "dr", vendorId: MICHEL, expected: "DR D", joined: true },
  { areaId: "dr", vendorId: SCOTT, expected: "GER O" },
  { areaId: "drc", vendorId: MICHEL, expected: "DR D", joined: true },
  { areaId: "drc", vendorId: FISCHER, expected: "DR D", joined: true },
  { areaId: "drs", vendorId: MICHEL, expected: "SA" },
];

const bookEntry = (catalogVendorId: string): AreaCatalogEntry => ({
  catalogVendorId,
  vendorName: catalogVendorId,
  vendorAbbreviation: catalogVendorId,
  prefix: null,
  prefixJoined: false,
  catalogNameId: `${catalogVendorId}-book`,
  catalogName: `${catalogVendorId} book`,
});

const vendorEntry = (
  catalogVendorId: string,
  areaPrefix: string | null,
  prefixJoined = false
): AreaVendorEntry => ({
  catalogVendorId,
  vendorName: catalogVendorId,
  vendorAbbreviation: catalogVendorId,
  areaPrefix,
  prefixJoined,
});

/** The fixture as the client sees it — `getCollectionAreas`' payload. */
export function prefixAreasAsClientData(): CollectionAreaData[] {
  return FIXTURE.map((a) => ({
    id: a.id,
    name: a.name,
    parentId: a.parentId,
    description: null,
    primaryCatalogNameId: null,
    primaryCatalogVendorId: null,
    catalogPrefix: a.catalogPrefix,
    catalogPrefixJoined: a.catalogPrefixJoined ?? false,
    anchorMarkets: [],
    titleName: null,
    titleNameByLanguage: {},
    symbol: null,
    coverSymbols: null,
    stillValidForPostage: null,
    valuationMethod: null,
    assignable: true,
    sortOrder: 0,
    stampCount: 0,
    childCount: 0,
    catalogEntries: a.books.map(bookEntry),
    vendorEntries: a.vendorRows.map(([v, p, j]) => vendorEntry(v, p, j)),
  }));
}

/** The same fixture as the server sees it — the rows `buildAreaPrefixNodes` is fed. */
export function prefixAreasAsServerRows(): Array<{
  id: string;
  name: string;
  parentId: string | null;
  catalogPrefix: string | null;
  catalogPrefixJoined: boolean;
  collectionAreaVendors: { catalogVendorId: string; areaPrefix: string | null; prefixJoined: boolean }[];
}> {
  return FIXTURE.map((a) => ({
    id: a.id,
    name: a.name,
    parentId: a.parentId,
    catalogPrefix: a.catalogPrefix,
    catalogPrefixJoined: a.catalogPrefixJoined ?? false,
    anchorMarkets: [],
    collectionAreaVendors: a.vendorRows.map(([catalogVendorId, areaPrefix, prefixJoined]) => ({
      catalogVendorId,
      areaPrefix,
      prefixJoined: prefixJoined ?? false,
    })),
  }));
}
