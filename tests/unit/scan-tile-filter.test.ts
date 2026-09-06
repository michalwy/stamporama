import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TILE_FILTER_PARAM,
  effectiveTileFilter,
  isNarrowed,
  matchesTileFilter,
  parseTileFilter,
  reachesFinishedBatches,
  type TileFilter,
  type TileFilterCounts,
} from "../../src/lib/scan-tile-filter";

const counts = (over: Partial<TileFilterCounts> = {}): TileFilterCounts => ({
  unidentified: 0,
  parked: 0,
  discarded: 0,
  ...over,
});

describe("card-scan tile filter (#567, #597, #853)", () => {
  it("names one state per chip, and 'discarded' is the one that means rejected (#853)", () => {
    const states = ["unidentified", "parked", "consumed", "discarded"];
    const shown = (filter: TileFilter) =>
      states.filter((state) => matchesTileFilter({ state }, filter));

    assert.deepEqual(shown("all"), states);
    assert.deepEqual(shown("waiting"), ["unidentified"]);
    assert.deepEqual(shown("parked"), ["parked"]);
    // Exactly one state ends up under the chip, which is what lets it be named after what it shows:
    // a consumed tile became a copy and a parked one is still a question.
    assert.deepEqual(shown("discarded"), ["discarded"]);
  });

  it("falls to the unnarrowed strip for anything it does not recognise", () => {
    assert.equal(parseTileFilter("discarded"), "discarded");
    assert.equal(parseTileFilter("rejected"), "all");
    assert.equal(parseTileFilter(""), "all");
    assert.equal(parseTileFilter(null), "all");
    assert.equal(parseTileFilter(undefined), "all");
  });

  it("retires a chip with what it counts, and keeps the choice for when it comes back", () => {
    // Put the last discard back and the strip un-narrows itself: the chip is its own only control,
    // so a filter left standing over nothing could never be pressed off again.
    assert.equal(effectiveTileFilter("discarded", counts()), "all");
    assert.equal(effectiveTileFilter("discarded", counts({ discarded: 3 })), "discarded");
    assert.equal(effectiveTileFilter("waiting", counts({ discarded: 3 })), "all");
    assert.equal(effectiveTileFilter("parked", counts({ parked: 1 })), "parked");
    // Nothing narrows `all`, whatever the counts say.
    assert.equal(effectiveTileFilter("all", counts({ unidentified: 9 })), "all");
  });

  it("reaches into finished batches only for the discards (#853)", () => {
    // The set-aside pile and the folded-shut batch both assume you are looking for work that is
    // left. A discard is an end a tile reached, and it lives on cards finished long ago.
    assert.equal(reachesFinishedBatches("discarded"), true);
    assert.equal(reachesFinishedBatches("waiting"), false);
    assert.equal(reachesFinishedBatches("parked"), false);
    assert.equal(reachesFinishedBatches("all"), false);
  });

  it("says when the strip is narrowed at all", () => {
    assert.equal(isNarrowed("all"), false);
    assert.equal(isNarrowed("discarded"), true);
  });

  it("names one address-bar parameter for the whole choice (#844)", () => {
    assert.equal(TILE_FILTER_PARAM, "tiles");
  });
});
