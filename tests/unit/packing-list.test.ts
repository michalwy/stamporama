import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { AreaCatalogEntry, CollectionAreaData } from "../../src/lib/areas";
import type { LocationData } from "../../src/lib/locations";
import type { SaleCopyItem } from "../../src/lib/sales";
import type { AreaVendorMaps } from "../../src/lib/area-vendor";
import {
  buildPackingList,
  NO_GROUP_LABEL,
  NO_LOCATION_LABEL,
  packingSetOrder,
  type PackingCopy,
  type PackingLine,
  type PackingSet,
  type PackingValue,
} from "../../src/lib/packing-list";

const MICHEL_PL = {
  catalogVendorId: "mi",
  vendorAbbreviation: "Mi",
  prefix: "PL",
} as AreaCatalogEntry;

const VENDOR_MAP_BY_AREA = new Map([["pl", new Map([["mi", MICHEL_PL]])]]);
const MAPS: AreaVendorMaps = {
  primaryVendorByArea: new Map([["pl", "mi"]]),
  vendorMapByArea: VENDOR_MAP_BY_AREA,
  // No issue overrides in this fixture (#377), so every lookup is the area's own map.
  vendorMapFor: (areaId) => (areaId ? (VENDOR_MAP_BY_AREA.get(areaId) ?? new Map()) : new Map()),
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

/** A sold copy, which is a {@link PackingCopy} by construction (#643) — the return type is the
 *  projection rather than `SaleCopyItem`, so this fixture is also the assertion that a sale's copies
 *  still satisfy it. `line` is the trade's half, absent on a sale. */
function copy(
  over: Partial<SaleCopyItem> & { line?: PackingLine; set?: PackingSet | null }
): PackingCopy {
  seq += 1;
  return {
    id: `item-${seq}`,
    itemNo: seq,
    offerNo: 7,
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

  it("carries every copy number behind a merged row, ascending (#474)", () => {
    const list = buildPackingList(
      [copy({ itemNo: 30 }), copy({ itemNo: 10 }), copy({ itemNo: 20 })],
      AREAS,
      LOCATIONS,
      MAPS
    );
    assert.deepEqual(list.groups[0].rows[0].itemNos, [10, 20, 30]);
  });

  it("collects the distinct offer numbers of a row's copies, ascending (#474)", () => {
    const list = buildPackingList(
      [copy({ offerNo: 5 }), copy({ offerNo: 2 }), copy({ offerNo: 5 }), copy({ offerNo: null })],
      AREAS,
      LOCATIONS,
      MAPS
    );
    assert.deepEqual(list.groups[0].rows[0].offerNos, [2, 5]);
  });

  it("leaves the offer numbers empty when no copy of a row came through a listing (#474)", () => {
    const list = buildPackingList([copy({ offerNo: null })], AREAS, LOCATIONS, MAPS);
    assert.deepEqual(list.groups[0].rows[0].offerNos, []);
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

// ── A trade's give side (#643) ────────────────────────────────────────────────
//
// The same builder over the same projection, with the transaction's own line carried on each copy.
// What that changes is stated as three things and tested as three things: a row that carries a line
// **is** that line, the sheet can be divided by the transaction's own structure instead of the shelf,
// and figures are summed per division with the priceless rows counted rather than added as zero.

function line(over: Partial<PackingLine> = {}): PackingLine {
  return {
    id: `line-${(seq += 1)}`,
    group: "Poland",
    verdict: "pending",
    verdictLabel: null,
    note: null,
    value: null,
    ...over,
  };
}

function value(amount: number, over: Partial<PackingValue> = {}): PackingValue {
  return { amount, currency: "EUR", attribution: null, uncertain: false, manual: false, ...over };
}

describe("buildPackingList over transaction lines", () => {
  it("keeps two indistinguishable copies apart when each carries its own line", () => {
    // The sale's merge would make these one row of two. A verdict is recorded per line, so a merged
    // row of two could not be answered for one piece at a time.
    const list = buildPackingList(
      [copy({ line: line() }), copy({ line: line() })],
      AREAS,
      LOCATIONS,
      MAPS
    );
    assert.equal(list.groups[0].rows.length, 2);
    assert.deepEqual(
      list.groups[0].rows.map((r) => r.quantity),
      [1, 1]
    );
  });

  it("still merges indistinguishable copies that carry no line", () => {
    const list = buildPackingList([copy({}), copy({})], AREAS, LOCATIONS, MAPS);
    assert.equal(list.groups[0].rows.length, 1);
    assert.equal(list.groups[0].rows[0].quantity, 2);
  });

  it("divides the sheet by the line's group, in the order the copies came in", () => {
    const list = buildPackingList(
      [
        copy({ line: line({ group: "Zurich duplicates" }) }),
        copy({ line: line({ group: "Poland" }) }),
        copy({ line: line({ group: "Zurich duplicates" }) }),
      ],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "group" }
    );
    // Not collated: the section order is the trade's own, and the caller feeds it in that order.
    assert.deepEqual(
      list.groups.map((g) => g.location),
      ["Zurich duplicates", "Poland"]
    );
    assert.equal(list.groups[0].copyCount, 2);
  });

  it("labels rows the grouping does not place", () => {
    const list = buildPackingList(
      [copy({ line: line({ group: null }) })],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "group", ungroupedLabel: "Other" }
    );
    assert.equal(list.groups[0].location, "Other");
  });

  it("orders rows by catalog number where the sheet prints no refs", () => {
    const list = buildPackingList(
      [
        copy({ catalogNumbers: [{ catalogVendorId: "mi", number: "300" }], locationRef: "A1", line: line() }),
        copy({ catalogNumbers: [{ catalogVendorId: "mi", number: "200" }], locationRef: "A9", line: line() }),
      ],
      AREAS,
      LOCATIONS,
      MAPS,
      { rowOrder: "catalog" }
    );
    assert.deepEqual(
      list.groups[0].rows.map((r) => r.catalog),
      ["Mi·PL 200", "Mi·PL 300"]
    );
  });

  it("sums each division's figures and counts the rows without one", () => {
    const list = buildPackingList(
      [
        copy({ line: line({ group: "Poland", value: value(12.5) }) }),
        copy({ line: line({ group: "Poland", value: value(2.5) }) }),
        copy({ line: line({ group: "Poland", value: null }) }),
      ],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "group" }
    );
    assert.equal(list.groups[0].value, 15);
    // Counted, never summed as zero: a total that swallowed the priceless line would be one nobody
    // could reproduce.
    assert.equal(list.groups[0].valueMissing, 1);
    assert.equal(list.totalValue, 15);
    assert.equal(list.valueMissing, 1);
    assert.equal(list.currency, "EUR");
  });

  it("reports no currency for a sheet that carries no figures", () => {
    const list = buildPackingList([copy({ line: line() })], AREAS, LOCATIONS, MAPS);
    assert.equal(list.currency, null);
    assert.equal(list.totalValue, 0);
  });

  it("counts a ticked line toward the division's packed count", () => {
    const list = buildPackingList(
      [copy({ packed: true, line: line({ verdict: "fulfilled" }) }), copy({ line: line() })],
      AREAS,
      LOCATIONS,
      MAPS
    );
    assert.equal(list.packedCopies, 1);
    assert.equal(list.groups[0].packedCount, 1);
  });

  it("carries the line onto the row it stands for", () => {
    const subject = line({ verdict: "withdrawn", verdictLabel: "I withdrew it", note: "Gum toned" });
    const list = buildPackingList([copy({ line: subject })], AREAS, LOCATIONS, MAPS);
    assert.deepEqual(list.groups[0].rows[0].line, subject);
  });

  it("carries the full location path on the row, for a sheet divided by something else", () => {
    const list = buildPackingList(
      [copy({ line: line() })],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "group" }
    );
    assert.equal(list.groups[0].rows[0].location, "Szafa 1 › Klaser A");
  });
});

// ── A sale divided by sold set (#2187) ────────────────────────────────────────

function soldSet(position: number, over: Partial<PackingSet> = {}): PackingSet {
  return {
    id: `set-${position}`,
    title: `Set ${position}`,
    numbers: null,
    onNoOffer: false,
    price: "10.00 PLN",
    position,
    ...over,
  };
}

describe("buildPackingList by sold set", () => {
  it("makes one division per set, in the caller's order, carrying the set", () => {
    const first = soldSet(0, { title: "Chopin pair" });
    const second = soldSet(1, { title: "Composers lot", onNoOffer: true });
    const list = buildPackingList(
      [copy({ set: second }), copy({ set: first }), copy({ set: second })],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "set" }
    );
    assert.deepEqual(
      list.groups.map((g) => g.location),
      ["Chopin pair", "Composers lot"]
    );
    assert.deepEqual(list.groups[1].set, second);
    assert.equal(list.groups[1].copyCount, 2);
  });

  it("orders a set's copies by location, then ref, unfiled last", () => {
    const set = soldSet(0);
    const list = buildPackingList(
      [
        copy({ set, stampId: "a", locationId: null, locationRef: null }),
        copy({ set, stampId: "b", locationId: "pudlo", locationRef: "A1" }),
        copy({ set, stampId: "c", locationId: "klaser", locationRef: "A20" }),
        copy({ set, stampId: "d", locationId: "klaser", locationRef: "A3" }),
      ],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "set" }
    );
    assert.deepEqual(
      list.groups[0].rows.map((r) => [r.location, r.locationRef]),
      [
        ["Pudło 2", "A1"],
        ["Szafa 1 › Klaser A", "A3"],
        ["Szafa 1 › Klaser A", "A20"],
        [null, null],
      ]
    );
  });

  it("merges identical copies within a set, never across two", () => {
    const first = soldSet(0);
    const second = soldSet(1);
    const list = buildPackingList(
      [copy({ set: first }), copy({ set: first }), copy({ set: second })],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "set" }
    );
    assert.deepEqual(
      list.groups.map((g) => g.rows.map((r) => r.quantity)),
      [[2], [1]]
    );
  });

  it("keeps one ref in two locations apart inside a set", () => {
    const set = soldSet(0);
    const list = buildPackingList(
      [copy({ set, locationId: "klaser" }), copy({ set, locationId: "pudlo" })],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "set" }
    );
    assert.equal(list.groups[0].rows.length, 2);
  });

  it("puts a copy on no set in a trailing division", () => {
    const list = buildPackingList(
      [copy({ set: null }), copy({ set: soldSet(3), stampId: "x" })],
      AREAS,
      LOCATIONS,
      MAPS,
      { grouping: "set" }
    );
    assert.deepEqual(
      list.groups.map((g) => g.location),
      ["Set 3", NO_GROUP_LABEL]
    );
    assert.equal(list.groups[1].set, null);
  });

  it("leaves the set off every division of a sheet by location", () => {
    const list = buildPackingList([copy({ set: soldSet(0) })], AREAS, LOCATIONS, MAPS);
    assert.equal(list.groups[0].set, null);
  });
});

describe("packingSetOrder", () => {
  it("keeps the sale's line order, with an offer's sets one after another", () => {
    const order = packingSetOrder([
      { id: "a", offerId: "o1" },
      { id: "b", offerId: "o2" },
      { id: "c", offerId: null },
      { id: "d", offerId: "o1" },
      { id: "e", offerId: null },
    ]);
    assert.deepEqual(
      [...order.entries()].sort((x, y) => x[1] - y[1]).map(([id]) => id),
      ["a", "d", "b", "c", "e"]
    );
  });
});
