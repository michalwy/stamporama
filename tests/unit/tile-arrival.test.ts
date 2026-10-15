import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { tileArrival } from "../../src/app/c/[collectionSlug]/shared/tile-arrival";

/**
 * What a copy's scan marker opens the scans card on (#1924): the tile's batch, and what has to
 * change for the tile to be on screen. The scroll and the flash are the card's own; the rule that
 * decides which of the collector's choices are lifted — and that nothing is lifted needlessly — is
 * here.
 */

type Tile = { id: string; state: string };
type Batch = { batchNo: number; doneAt: string | null; tiles: Tile[] };

const open: Batch = {
  batchNo: 1,
  doneAt: null,
  tiles: [
    { id: "a", state: "consumed" },
    { id: "b", state: "unidentified" },
  ],
};
const done: Batch = {
  batchNo: 2,
  doneAt: "2026-10-11T10:00:00.000Z",
  tiles: [
    { id: "c", state: "consumed" },
    { id: "d", state: "discarded" },
  ],
};
const batches = [open, done];

/** The ordinary rule: a batch is open while it has work left. */
const byDefault = (b: Batch) => b.doneAt == null;

describe("tileArrival (#1924)", () => {
  it("lifts nothing when the tile is already on screen", () => {
    assert.deepEqual(
      tileArrival("a", batches, { filter: "all", showDone: false, isExpanded: byDefault }),
      { tileId: "a", batchNo: 1, clearFilter: false, showDone: false, expand: false }
    );
  });

  it("brings a worked-through batch out and opens it", () => {
    assert.deepEqual(
      tileArrival("c", batches, { filter: "all", showDone: false, isExpanded: byDefault }),
      { tileId: "c", batchNo: 2, clearFilter: false, showDone: true, expand: true }
    );
  });

  it("leaves the set-aside batches as they are when they are already out", () => {
    const found = tileArrival("c", batches, {
      filter: "all",
      showDone: true,
      isExpanded: () => true,
    });
    assert.equal(found?.showDone, false);
    assert.equal(found?.expand, false);
  });

  it("opens a batch the collector folded shut", () => {
    const found = tileArrival("a", batches, {
      filter: "all",
      showDone: false,
      isExpanded: () => false,
    });
    assert.equal(found?.expand, true);
  });

  it("lifts a chip that hides the tile — a copy is never among the waiting ones", () => {
    const found = tileArrival("a", batches, {
      filter: "waiting",
      showDone: false,
      isExpanded: byDefault,
    });
    assert.equal(found?.clearFilter, true);
  });

  it("keeps a chip that shows the tile", () => {
    const found = tileArrival("d", batches, {
      filter: "discarded",
      showDone: false,
      isExpanded: byDefault,
    });
    // The discards chip draws finished batches out and open on its own (#853).
    assert.deepEqual(found, {
      tileId: "d",
      batchNo: 2,
      clearFilter: false,
      showDone: false,
      expand: false,
    });
  });

  it("judges the set-aside pile by the strip the tile will be shown on, not the chip it lifted", () => {
    // Under the discards chip the finished batch is out and open; the copy is not a discard, so the
    // chip goes — and with it the exception, so the batch has to be brought out by choice.
    assert.deepEqual(
      tileArrival("c", batches, { filter: "discarded", showDone: false, isExpanded: byDefault }),
      { tileId: "c", batchNo: 2, clearFilter: true, showDone: true, expand: true }
    );
  });

  it("answers nothing for a tile this order does not hold, or no tile at all", () => {
    const view = { filter: "all" as const, showDone: false, isExpanded: byDefault };
    assert.equal(tileArrival("elsewhere", batches, view), null);
    assert.equal(tileArrival(null, batches, view), null);
    assert.equal(tileArrival("", batches, view), null);
  });
});
