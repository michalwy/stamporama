import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  STATE_CHANGED_RECORDED_FROM,
  facebookPostListDates,
  facebookPostListFigures,
  type PostListLotDates,
  type PostListLotFigures,
} from "../../src/lib/facebook-post-list-figures";

const CREATED = new Date("2026-11-10T09:00:00.000Z");
const RECORDED = new Date("2026-11-12T10:00:00.000Z");

function dated(over: Partial<PostListLotDates>): PostListLotDates {
  return {
    state: "preparing",
    auction: true,
    listingDate: null,
    stateChangedAt: CREATED,
    closedAt: null,
    endsAt: null,
    ...over,
  };
}

function figured(over: Partial<PostListLotFigures>): PostListLotFigures {
  return {
    copyCount: 1,
    asking: null,
    askingUnconvertible: false,
    catalogue: null,
    cost: null,
    costEstimated: false,
    costOpening: false,
    sold: false,
    soldAmount: null,
    ...over,
  };
}

describe("facebookPostListDates (#2502)", () => {
  it("a post being prepared or ready shows only when it was made", () => {
    const dates = facebookPostListDates("ready", CREATED, [dated({ state: "ready" })]);
    assert.deepEqual(dates, {
      createdAt: CREATED.toISOString(),
      submittedAt: null,
      upSince: null,
      endsFrom: null,
      endsTo: null,
      endedAt: null,
    });
  });

  it("a post waiting for approval shows when its lots entered Pending", () => {
    const later = new Date("2026-11-12T10:05:00.000Z");
    const dates = facebookPostListDates("pending", CREATED, [
      dated({ state: "pending", stateChangedAt: later }),
      dated({ state: "pending", stateChangedAt: RECORDED }),
    ]);
    assert.equal(dates.submittedAt, RECORDED.toISOString());
  });

  it("a submission stamped before the column existed is an estimate and is left out", () => {
    const dates = facebookPostListDates("pending", CREATED, [
      dated({ state: "pending", stateChangedAt: RECORDED }),
      dated({ state: "pending", stateChangedAt: STATE_CHANGED_RECORDED_FROM }),
    ]);
    assert.equal(dates.submittedAt, null);
  });

  it("a lot already sold off a pending post does not date the submission", () => {
    const dates = facebookPostListDates("pending", CREATED, [
      dated({ state: "pending", stateChangedAt: RECORDED }),
      dated({ state: "sold", stateChangedAt: new Date("2026-11-11T00:00:00.000Z") }),
    ]);
    assert.equal(dates.submittedAt, RECORDED.toISOString());
  });

  it("a post that is up shows since when, and one end where its auctions share it", () => {
    const ends = new Date("2026-11-14T19:00:00.000Z");
    const dates = facebookPostListDates("up", CREATED, [
      dated({ state: "active", listingDate: new Date("2026-11-12T00:00:00.000Z"), endsAt: ends }),
      dated({ state: "active", listingDate: new Date("2026-11-12T00:00:00.000Z"), endsAt: ends }),
    ]);
    assert.equal(dates.upSince, "2026-11-12");
    assert.equal(dates.endsFrom, ends.toISOString());
    assert.equal(dates.endsTo, ends.toISOString());
    assert.equal(dates.submittedAt, null);
  });

  it("auctions ending at different times show the earliest and the latest", () => {
    const early = new Date("2026-11-14T19:00:00.000Z");
    const late = new Date("2026-11-15T19:00:00.000Z");
    const dates = facebookPostListDates("up", CREATED, [
      dated({ state: "active", endsAt: late }),
      dated({ state: "paused", endsAt: early }),
      dated({ state: "sold", endsAt: new Date("2026-11-13T19:00:00.000Z") }),
    ]);
    assert.equal(dates.endsFrom, early.toISOString());
    assert.equal(dates.endsTo, late.toISOString());
  });

  it("quick buys have no end, and a lot without a listing date leaves since-when out", () => {
    const dates = facebookPostListDates("up", CREATED, [
      dated({ state: "active", auction: false, listingDate: new Date("2026-11-12T00:00:00.000Z") }),
      dated({ state: "active", auction: false, listingDate: null }),
    ]);
    assert.equal(dates.upSince, null);
    assert.equal(dates.endsFrom, null);
  });

  it("a post that is over shows when it went up and when its last lot ended", () => {
    const ends = new Date("2026-11-14T19:00:00.000Z");
    const dates = facebookPostListDates("over", CREATED, [
      // Sold after the auction ended: it ended at its end.
      dated({ state: "sold", listingDate: new Date("2026-11-12T00:00:00.000Z"), endsAt: ends, closedAt: new Date("2026-11-16T08:00:00.000Z") }),
      // Withdrawn before the end: it ended then.
      dated({ state: "withdrawn", listingDate: new Date("2026-11-12T00:00:00.000Z"), endsAt: ends, closedAt: new Date("2026-11-13T08:00:00.000Z") }),
    ]);
    assert.equal(dates.upSince, "2026-11-12");
    assert.equal(dates.endedAt, ends.toISOString());
  });

  it("a closing never recorded leaves the end out", () => {
    const dates = facebookPostListDates("over", CREATED, [
      dated({ state: "sold", auction: false, closedAt: new Date("2026-11-16T08:00:00.000Z") }),
      dated({ state: "withdrawn", auction: false, closedAt: null }),
    ]);
    assert.equal(dates.endedAt, null);
  });
});

describe("facebookPostListFigures (#2502)", () => {
  it("sums the lots, leaving the unpriced out of the asking total and counting them", () => {
    const f = facebookPostListFigures([
      figured({ copyCount: 3, asking: 10, catalogue: 40, cost: 5.5 }),
      figured({ copyCount: 2, asking: 12.25, catalogue: 30, cost: null }),
      figured({ copyCount: 1, asking: null, catalogue: null, cost: 2, costEstimated: true }),
    ]);
    assert.equal(f.lotCount, 3);
    assert.equal(f.copyCount, 6);
    assert.deepEqual(f.asking, { amount: "22.25", unpriced: 1, unconvertible: 0 });
    assert.deepEqual(f.catalogue, { amount: "70.00", lots: 2 });
    assert.deepEqual(f.cost, { amount: "7.50", lots: 2, estimated: true, opening: false });
  });

  it("nothing sold reads as no sold lots, never as 0", () => {
    const f = facebookPostListFigures([figured({ asking: 10 })]);
    assert.deepEqual(f.sold, { lots: 0, amount: null, unconvertible: 0 });
  });

  it("sold counts the lots in a sale and what they brought", () => {
    const f = facebookPostListFigures([
      figured({ sold: true, soldAmount: 15 }),
      figured({ sold: true, soldAmount: 20.5 }),
      figured({ sold: false }),
    ]);
    assert.deepEqual(f.sold, { lots: 2, amount: "35.50", unconvertible: 0 });
  });

  it("a price with no rate is counted apart, not as unpriced", () => {
    const f = facebookPostListFigures([figured({ askingUnconvertible: true }), figured({ asking: 5 })]);
    assert.deepEqual(f.asking, { amount: "5.00", unpriced: 0, unconvertible: 1 });
  });

  it("no figure on any lot is no figure", () => {
    const f = facebookPostListFigures([figured({})]);
    assert.equal(f.asking.amount, null);
    assert.equal(f.catalogue.amount, null);
    assert.equal(f.cost.amount, null);
  });
});
