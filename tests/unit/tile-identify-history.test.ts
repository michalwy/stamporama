import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { ScanBatchData, ScanTileData } from "../../src/lib/scan-sheets";
import { identifyHistory } from "../../src/lib/tile-identify-history";

/** A copy as a consumed tile reports it. Only the fields the history reads are varied; the rest are
 * the ordinary answers of an intake. */
function item(
  overrides: Partial<NonNullable<ScanTileData["item"]>> = {}
): NonNullable<ScanTileData["item"]> {
  return {
    id: "i1",
    itemNo: 1,
    stampId: "s1",
    conditionId: "c-mnh",
    certificateStatusId: null,
    formatId: null,
    locationId: null,
    locationRef: null,
    lotId: null,
    createdAt: "2026-09-04T10:00:00.000Z",
    inCollection: true,
    forSale: false,
    forTrade: false,
    frontPhotoId: "p-front",
    backPhotoId: "p-back",
    stampName: "Chopin",
    catalogNumbers: [
      { catalogVendorId: "v-mi", number: "200" },
      { catalogVendorId: "v-fi", number: "180" },
    ],
    issueId: "iss-1",
    collectionAreaId: "area-1",
    conditionAbbreviation: "MNH",
    ...overrides,
  };
}

function tile(id: string, overrides: Partial<ScanTileData> = {}): ScanTileData {
  return {
    id,
    position: 0,
    state: "consumed",
    frontPhotoId: null,
    backPhotoId: null,
    frontBox: null,
    backBox: null,
    note: null,
    item: item(),
    candidates: [],
    outsideDescription: false,
    ...overrides,
  };
}

function batch(batchNo: number, tiles: ScanTileData[]): ScanBatchData {
  return { batchNo, label: null, front: null, back: null, tiles, doneAt: null };
}

describe("identifyHistory", () => {
  it("lists a consumed tile's identification, newest first", () => {
    const history = identifyHistory([
      batch(1, [
        tile("t1", { item: item({ stampId: "s1", createdAt: "2026-09-04T10:00:00.000Z" }) }),
        tile("t2", { item: item({ stampId: "s2", createdAt: "2026-09-04T10:05:00.000Z" }) }),
      ]),
    ]);
    assert.deepEqual(
      history.map((e) => e.tileId),
      ["t2", "t1"]
    );
  });

  it("spans every batch of the screen, not one card", () => {
    const history = identifyHistory([
      batch(2, [
        tile("newer", { item: item({ stampId: "s2", createdAt: "2026-09-04T12:00:00.000Z" }) }),
      ]),
      batch(1, [
        tile("older", { item: item({ stampId: "s1", createdAt: "2026-09-04T09:00:00.000Z" }) }),
      ]),
    ]);
    assert.deepEqual(
      history.map((e) => e.tileId),
      ["newer", "older"]
    );
  });

  it("leaves out a tile that is not an identification", () => {
    const history = identifyHistory([
      batch(1, [
        tile("waiting", { state: "unidentified", item: null }),
        tile("parked", { state: "parked", item: null }),
        tile("discarded", { state: "discarded", item: null }),
        // Consumed, but the copy it became has since been deleted: no picture to show and no
        // answers to repeat.
        tile("orphaned", { state: "consumed", item: null }),
      ]),
    ]);
    assert.deepEqual(history, []);
  });

  it("carries the copy's answers, with nulls as the step's own 'not chosen'", () => {
    const [entry] = identifyHistory([
      batch(1, [
        tile("t1", {
          item: item({
            itemNo: 123,
            stampId: "s-chopin",
            conditionId: "c-used",
            certificateStatusId: null,
            formatId: "f-pair",
            locationId: null,
            locationRef: null,
            lotId: "lot-1",
            conditionAbbreviation: "U",
          }),
        }),
      ]),
    ]);
    assert.equal(entry.itemNo, 123);
    assert.equal(entry.photoId, "p-front");
    assert.equal(entry.conditionAbbreviation, "U");
    // The stamp travels unformatted: the prefix is resolved on the client, where the area and
    // per-issue maps are, so what this module hands over is where it sits and what it is numbered.
    assert.deepEqual(entry.subject, {
      areaId: "area-1",
      issueId: "iss-1",
      catalogNumbers: [
        { catalogVendorId: "v-mi", number: "200" },
        { catalogVendorId: "v-fi", number: "180" },
      ],
      name: "Chopin",
    });
    assert.deepEqual(entry.answers, {
      stampId: "s-chopin",
      conditionId: "c-used",
      certificateStatusId: "",
      formatId: "f-pair",
      locationId: "",
      locationRef: "",
      disposition: { inCollection: true, forSale: false, forTrade: false },
      lotId: "lot-1",
    });
  });

  it("falls back to the back when the copy has no front", () => {
    const [entry] = identifyHistory([
      batch(1, [tile("t1", { item: item({ frontPhotoId: null }) })]),
    ]);
    assert.equal(entry.photoId, "p-back");
  });

  it("lists one stamp once, however many copies of it were taken in", () => {
    // Ten tiles identified as one stamp in one pass (#596) is the ordinary shape of a card, and it
    // must not spend the whole list on a single answer.
    const run = Array.from({ length: 10 }, (_, i) =>
      tile(`t${i}`, { item: item({ createdAt: `2026-09-04T10:0${i}:00.000Z` }) })
    );
    const history = identifyHistory([
      batch(1, [
        ...run,
        tile("other", { item: item({ stampId: "s2", createdAt: "2026-09-04T09:00:00.000Z" }) }),
      ]),
    ]);
    assert.deepEqual(
      history.map((e) => e.tileId),
      // The newest of the run stands for it, and the other stamp keeps its own row underneath.
      ["t9", "other"]
    );
  });

  it("tells apart what a row would draw differently", () => {
    const history = identifyHistory([
      batch(1, [
        tile("mnh", { item: item({ createdAt: "2026-09-04T10:00:00.000Z" }) }),
        tile("used", {
          item: item({ conditionId: "c-used", createdAt: "2026-09-04T10:01:00.000Z" }),
        }),
        tile("pair", {
          item: item({ formatId: "f-pair", createdAt: "2026-09-04T10:02:00.000Z" }),
        }),
        // The same stamp, condition and format, differing only in what no row shows: one entry,
        // and the newest of them carries its own certificate onward.
        tile("cert", {
          item: item({ certificateStatusId: "cert-1", createdAt: "2026-09-04T10:03:00.000Z" }),
        }),
      ]),
    ]);
    assert.deepEqual(
      history.map((e) => e.tileId),
      ["cert", "pair", "used"]
    );
    assert.equal(history[0].answers.certificateStatusId, "cert-1");
  });

  it("takes the limit it is given, counting distinct identifications", () => {
    const tiles = Array.from({ length: 4 }, (_, i) =>
      tile(`t${i}`, { item: item({ stampId: `s${i}`, createdAt: `2026-09-04T10:0${i}:00.000Z` }) })
    );
    assert.equal(identifyHistory([batch(1, tiles)], 2).length, 2);
  });
});
