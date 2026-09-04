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
    catalogNumbers: ["Mi 200", "Fi 180"],
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
        tile("t1", { item: item({ id: "i1", createdAt: "2026-09-04T10:00:00.000Z" }) }),
        tile("t2", { item: item({ id: "i2", createdAt: "2026-09-04T10:05:00.000Z" }) }),
      ]),
    ]);
    assert.deepEqual(
      history.map((e) => e.tileId),
      ["t2", "t1"]
    );
  });

  it("spans every batch of the screen, not one card", () => {
    const history = identifyHistory([
      batch(2, [tile("newer", { item: item({ createdAt: "2026-09-04T12:00:00.000Z" }) })]),
      batch(1, [tile("older", { item: item({ createdAt: "2026-09-04T09:00:00.000Z" }) })]),
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
    assert.equal(entry.answers.shortLabel, "Mi 200");
    assert.equal(entry.answers.label, "Mi 200 · Fi 180 — Chopin");
    assert.deepEqual(entry.answers, {
      stampId: "s-chopin",
      label: "Mi 200 · Fi 180 — Chopin",
      shortLabel: "Mi 200",
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

  it("keeps only the last few, and orders a one-pass run stably", () => {
    // Ten tiles identified as one stamp in one pass (#596) share a creation instant, and an
    // eleventh identified after them must be the row on top.
    const run = Array.from({ length: 10 }, (_, i) =>
      tile(`t${i}`, { item: item({ createdAt: "2026-09-04T10:00:00.000Z" }) })
    );
    const history = identifyHistory([
      batch(1, [
        ...run,
        tile("last", { item: item({ createdAt: "2026-09-04T10:01:00.000Z" }) }),
      ]),
    ]);
    assert.equal(history.length, 10);
    assert.equal(history[0].tileId, "last");
    // The run's own order is total and repeatable, so a row cannot move under the pointer.
    assert.deepEqual(
      history.slice(1).map((e) => e.tileId),
      identifyHistory([batch(1, [...run].reverse())])
        .slice(0, 9)
        .map((e) => e.tileId)
    );
  });

  it("takes the limit it is given", () => {
    const tiles = Array.from({ length: 4 }, (_, i) =>
      tile(`t${i}`, { item: item({ createdAt: `2026-09-04T10:0${i}:00.000Z` }) })
    );
    assert.equal(identifyHistory([batch(1, tiles)], 2).length, 2);
  });
});
