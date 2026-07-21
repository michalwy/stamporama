import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ItemListItem } from "../../src/lib/items";
import type { CollectionAreaData, AreaCatalogEntry } from "../../src/lib/areas";
import { sortCopies } from "../../src/lib/copy-sort";
import {
  buildAreaVendorMaps,
  effectivePrimaryVendorId,
  deriveLotLabel,
} from "../../src/lib/area-vendor";

// Pure helpers behind the server-side lot-intake pagination (#172): the copy sort the client
// and server share, the per-area vendor resolution, and the derived lot label. Kept unit-only
// (no Prisma) so the ordering/labeling that the paginated views depend on is pinned down here.

/** Minimal `ItemListItem` for sort/label tests — only the fields these helpers read. */
function mkItem(partial: Partial<ItemListItem> & { id: string }): ItemListItem {
  return {
    stampName: null,
    unknownVariant: false,
    hasHistory: false,
    issuedDay: null,
    issuedMonth: null,
    issuedYear: null,
    catalogNumbers: [],
    areaId: null,
    issueId: null,
    issueName: null,
    issueYear: null,
    conditionId: "c",
    conditionName: "Cond",
    conditionAbbreviation: "C",
    certificateStatusId: null,
    certificateStatusName: null,
    inCollection: true,
    forSale: false,
    forTrade: false,
    lotId: "lot",
    lotStatus: "open",
    deliveryState: "delivered",
    costBasis: null,
    notes: null,
    locationId: null,
    locationRef: null,
    createdAt: new Date(0),
    photos: [],
    stampId: "s",
    // Valuation carries the base-currency weight the "price" sort and estimate use.
    value: { baseAmount: null } as ItemListItem["value"],
    ...partial,
  } as ItemListItem;
}

const entry = (over: Partial<AreaCatalogEntry> & { catalogVendorId: string }): AreaCatalogEntry => ({
  catalogNameId: over.catalogVendorId,
  vendorName: "Vendor",
  catalogName: "Catalog",
  vendorAbbreviation: "Mi",
  prefix: null,
  ...over,
});

const area = (over: Partial<CollectionAreaData> & { id: string }): CollectionAreaData => ({
  name: "Area",
  parentId: null,
  description: null,
  primaryCatalogNameId: null,
  stampCount: 0,
  childCount: 0,
  catalogEntries: [],
  ...over,
});

describe("sortCopies (shared client/server ordering)", () => {
  it("keeps creation order for 'added', reverses for desc", () => {
    const items = [mkItem({ id: "a" }), mkItem({ id: "b" }), mkItem({ id: "c" })];
    assert.deepEqual(
      sortCopies(items, "added", "asc", new Map()).map((i) => i.id),
      ["a", "b", "c"]
    );
    assert.deepEqual(
      sortCopies(items, "added", "desc", new Map()).map((i) => i.id),
      ["c", "b", "a"]
    );
  });

  it("sorts by year with blanks always last, both directions", () => {
    const items = [
      mkItem({ id: "none" }),
      mkItem({ id: "old", issuedYear: 1950 }),
      mkItem({ id: "new", issuedYear: 2000 }),
    ];
    assert.deepEqual(
      sortCopies(items, "year", "asc", new Map()).map((i) => i.id),
      ["old", "new", "none"]
    );
    assert.deepEqual(
      sortCopies(items, "year", "desc", new Map()).map((i) => i.id),
      ["new", "old", "none"]
    );
  });

  it("sorts by base-currency price, uncertain (null) weights last", () => {
    const items = [
      mkItem({ id: "hi", value: { baseAmount: 30 } as ItemListItem["value"] }),
      mkItem({ id: "lo", value: { baseAmount: 5 } as ItemListItem["value"] }),
      mkItem({ id: "unk", value: { baseAmount: null } as ItemListItem["value"] }),
    ];
    assert.deepEqual(
      sortCopies(items, "price", "asc", new Map()).map((i) => i.id),
      ["lo", "hi", "unk"]
    );
  });

  it("sorts by catalog number naturally (1, 2, 10) using the primary vendor", () => {
    const primaryVendorByArea = new Map<string, string | null>([["ar", "v"]]);
    const items = [
      mkItem({ id: "ten", areaId: "ar", catalogNumbers: [{ catalogVendorId: "v", number: "10" }] }),
      mkItem({ id: "one", areaId: "ar", catalogNumbers: [{ catalogVendorId: "v", number: "1" }] }),
      mkItem({ id: "two", areaId: "ar", catalogNumbers: [{ catalogVendorId: "v", number: "2" }] }),
    ];
    assert.deepEqual(
      sortCopies(items, "catalog", "asc", primaryVendorByArea).map((i) => i.id),
      ["one", "two", "ten"]
    );
  });
});

describe("effectivePrimaryVendorId", () => {
  it("inherits the nearest ancestor's declared primary vendor", () => {
    const areas = [
      area({
        id: "root",
        primaryCatalogNameId: "nameMi",
        catalogEntries: [entry({ catalogVendorId: "mi", catalogNameId: "nameMi" })],
      }),
      area({ id: "child", parentId: "root" }),
    ];
    assert.equal(effectivePrimaryVendorId(areas, "child"), "mi");
    assert.equal(effectivePrimaryVendorId(areas, "root"), "mi");
  });

  it("returns null when no ancestor declares a primary", () => {
    const areas = [area({ id: "a" })];
    assert.equal(effectivePrimaryVendorId(areas, "a"), null);
  });
});

describe("deriveLotLabel", () => {
  const areas = [
    area({
      id: "ar",
      primaryCatalogNameId: "nameMi",
      catalogEntries: [
        entry({ catalogVendorId: "mi", catalogNameId: "nameMi", vendorAbbreviation: "Mi" }),
      ],
    }),
  ];
  const maps = buildAreaVendorMaps(areas);

  it("is null for an empty lot", () => {
    assert.equal(deriveLotLabel([], maps), null);
  });

  it("lists up to three distinct catalog labels, then '+N more'", () => {
    const items = [
      mkItem({ id: "1", areaId: "ar", catalogNumbers: [{ catalogVendorId: "mi", number: "1" }] }),
      mkItem({ id: "2", areaId: "ar", catalogNumbers: [{ catalogVendorId: "mi", number: "2" }] }),
      // duplicate of #1 — de-duplicated, does not consume a slot
      mkItem({ id: "1b", areaId: "ar", catalogNumbers: [{ catalogVendorId: "mi", number: "1" }] }),
      mkItem({ id: "3", areaId: "ar", catalogNumbers: [{ catalogVendorId: "mi", number: "3" }] }),
      mkItem({ id: "4", areaId: "ar", catalogNumbers: [{ catalogVendorId: "mi", number: "4" }] }),
    ];
    assert.equal(deriveLotLabel(items, maps), "Mi 1, Mi 2, Mi 3 +1 more");
  });

  it("falls back to the stamp name when a copy has no catalog number", () => {
    const items = [mkItem({ id: "x", stampName: "Penny Black" })];
    assert.equal(deriveLotLabel(items, maps), "Penny Black");
  });
});
