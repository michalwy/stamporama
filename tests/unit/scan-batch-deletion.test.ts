import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { batchDeletion, batchDeletionRefusal } from "../../src/lib/scan-batch-deletion";

const tiles = (...states: string[]) => states.map((state) => ({ state }));

describe("deleting a card scan (#1218)", () => {
  it("allows a batch worked all the way through, copies and discards alike", () => {
    const d = batchDeletion(tiles("consumed", "consumed", "discarded"));
    assert.deepEqual(d, { allowed: true, waiting: 0, parked: 0, copies: 2, discarded: 1 });
    assert.equal(batchDeletionRefusal(4, d), null);
  });

  it("refuses a batch with copies while a tile is still waiting", () => {
    const d = batchDeletion(tiles("consumed", "unidentified"));
    assert.equal(d.allowed, false);
    assert.match(batchDeletionRefusal(4, d) ?? "", /^Batch 4 still has 1 tile waiting\./);
  });

  it("refuses a batch with copies while a tile is parked — put off is not dealt with (#597)", () => {
    const d = batchDeletion(tiles("consumed", "discarded", "parked", "parked"));
    assert.equal(d.allowed, false);
    assert.match(batchDeletionRefusal(2, d) ?? "", /still has 2 set aside to check\./);
  });

  it("names both kinds of open work when a batch has both", () => {
    const d = batchDeletion(tiles("consumed", "unidentified", "unidentified", "parked"));
    assert.match(batchDeletionRefusal(1, d) ?? "", /2 tiles waiting and 1 set aside to check/);
  });

  it("still allows a batch nothing has become a copy from, however unfinished", () => {
    // A wrong file, a cut not worth correcting: nothing outside the batch points at it.
    assert.equal(batchDeletion(tiles("unidentified", "parked", "discarded")).allowed, true);
    assert.equal(batchDeletion([]).allowed, true);
  });
});
