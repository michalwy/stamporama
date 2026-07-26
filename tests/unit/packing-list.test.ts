import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AreaCatalogEntry, CollectionAreaData } from "../../src/lib/areas";
import type { LocationData } from "../../src/lib/locations";
import type { SaleCopyItem } from "../../src/lib/sales";
import type { AreaVendorMaps } from "../../src/lib/area-vendor";
import { buildPackingList, NO_LOCATION_LABEL } from "../../src/lib/packing-list";

const MICHEL_PL = {
  catalogVendorId: "mi",
  vendorAbbreviation: "Mi",
  prefix: "PL",
} as AreaCatalogEntry;

const MAPS: AreaVendorMaps = {
  primaryVendorByArea: new Map([["pl", "mi"]]),
  vendorMapByArea: new Map([["pl", new Map([["mi", MICHEL_PL]])]]),
};

const AREAS: CollectionAreaData[] = [
  { id: "pl", name: "Polska", parentId: null } as CollectionAreaData,
  { id: "iirp", name: "II RP", parentId: "pl" } as CollectionAreaData,
];

const LOCATIONS: LocationData[] = [
  { id: "szafa", name: "Szafa 1", parentId: null } as LocationData,
  { id: "klaser", name: "Klaser A", parentId: "szafa" } as LocationData,
  { id: "pudlo", name: "Pudło 2", parentId: null } as LocationData,
];

let seq = 0;

function copy(over: Partial<SaleCopyItem>): SaleCopyItem {
  seq += 1;
  return {
    id: `item-${seq}`,
    stampId: "s1",
    stampName: "Chopin",
    issueName: "Composers",
    areaId: "pl",
    catalogNumbers: [{ catalogVendorId: "mi", number: "200" }],
    conditionId: "mint",
    conditionName: "Mint never hinged",
    conditionAbbreviation: "**",
    certificateStatusId: null,
    certificateStatusName: null,
    locationId: "klaser",
    locationRef: "A10",
    packed: false,
    photos: [],
    ...over,
  } as SaleCopyItem;
}

describe("buildPackingList", () => {
  it("sections copies by location path, unfiled last", () => {
    const list = buildPackingList(
      [
        copy({ locationId: null, locationRef: null }),
        copy({ locationId: "pudlo" }),
        copy({ locationId: "klaser" }),
      ],
      AREAS,
      LOCATIONS,
      MAPS
    );
    assert.deepEqual(
      list.groups.map((g) => g.location),
      ["Pudło 2", "Szafa 1 › Klaser A", NO_LOCATION_LABEL]
    );
  });

  it("merges indistinguishable copies into one row with a quantity", () => {
    const list = buildPackingList([copy({}), copy({}), copy({})], AREAS, LOCATIONS, MAPS);
    assert.equal(list.groups.length, 1);
    assert.deepEqual(
      list.groups[0].rows.map((r) => ({ catalog: r.catalog, quantity: r.quantity })),
      [{ catalog: "Mi·PL 200", quantity: 3 }]
    );
    assert.equal(list.totalCopies, 3);
  });

  it("keeps packed and unpacked copies of the same stamp apart", () => {
    const list = buildPackingList([copy({}), copy({ packed: true })], AREAS, LOCATIONS, MAPS);
    assert.deepEqual(
      list.groups[0].rows.map((r) => r.packed),
      [false, true]
    );
    assert.equal(list.packedCopies, 1);
    assert.equal(list.groups[0].packedCount, 1);
  });

  it("orders rows by ref prefix then number, blanks last", () => {
    const list = buildPackingList(
      [
        copy({ stampId: "a", locationRef: "A1200" }),
        copy({ stampId: "b", locationRef: null }),
        copy({ stampId: "c", locationRef: "B-3000" }),
        copy({ stampId: "d", locationRef: "A100" }),
      ],
      AREAS,
      LOCATIONS,
      MAPS
    );
    assert.deepEqual(
      list.groups[0].rows.map((r) => r.locationRef),
      ["A100", "A1200", "B-3000", null]
    );
  });

  it("carries the first photo of a merged row's copies", () => {
    const list = buildPackingList(
      [
        copy({ photos: [] }),
        copy({ photos: [{ id: "p1" }] as SaleCopyItem["photos"] }),
      ],
      AREAS,
      LOCATIONS,
      MAPS
    );
    assert.equal(list.groups[0].rows[0].quantity, 2);
    assert.equal(list.groups[0].rows[0].photoId, "p1");
  });

  it("keeps copies with a different certificate status apart", () => {
    const list = buildPackingList(
      [copy({}), copy({ certificateStatusId: "cert", certificateStatusName: "Certified" })],
      AREAS,
      LOCATIONS,
      MAPS
    );
    assert.deepEqual(
      list.groups[0].rows.map((r) => r.certificateStatusName),
      [null, "Certified"]
    );
  });

  it("carries the series name and the full area path", () => {
    const list = buildPackingList([copy({ areaId: "iirp" })], AREAS, LOCATIONS, MAPS);
    const row = list.groups[0].rows[0];
    assert.equal(row.issueName, "Composers");
    assert.equal(row.areaPath, "Polska › II RP");
  });

  it("falls back to the stamp name when a copy carries no catalog number", () => {
    const list = buildPackingList([copy({ catalogNumbers: [] })], AREAS, LOCATIONS, MAPS);
    assert.equal(list.groups[0].rows[0].catalog, "Chopin");
  });

  it("returns an empty list for a sale with no copies", () => {
    const list = buildPackingList([], AREAS, LOCATIONS, MAPS);
    assert.deepEqual(list.groups, []);
    assert.equal(list.totalCopies, 0);
    assert.equal(list.packedCopies, 0);
  });
});
