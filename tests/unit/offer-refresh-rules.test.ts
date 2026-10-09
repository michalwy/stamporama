import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  cleanRefreshQuickBuysAfterDays,
  daysUpSince,
  lastPostedOn,
  quickBuyRefreshDue,
  refreshCutoff,
} from "../../src/lib/offer-refresh-rules";

// When a quick buy needs posting again (#1718): the pure half. The `where` the filter asks of the
// database is pinned against the same instants in tests/integration/offer-refresh.test.ts.

const NOW = new Date("2026-10-09T12:00:00.000Z");
const day = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe("cleanRefreshQuickBuysAfterDays", () => {
  it("takes a whole number of days up to a year, and blank as never", () => {
    assert.equal(cleanRefreshQuickBuysAfterDays(null), null);
    assert.equal(cleanRefreshQuickBuysAfterDays(undefined), null);
    assert.equal(cleanRefreshQuickBuysAfterDays(Number.NaN), null);
    assert.equal(cleanRefreshQuickBuysAfterDays(1), 1);
    assert.equal(cleanRefreshQuickBuysAfterDays(365), 365);
    for (const bad of [0, -3, 2.5, 366]) {
      assert.throws(() => cleanRefreshQuickBuysAfterDays(bad), /whole number of days/);
    }
  });
});

describe("lastPostedOn", () => {
  it("is the later of the first listing and the last repost", () => {
    assert.equal(lastPostedOn(null, null), null);
    assert.deepEqual(lastPostedOn(day("2026-10-01"), null), day("2026-10-01"));
    assert.deepEqual(lastPostedOn(null, day("2026-10-03")), day("2026-10-03"));
    assert.deepEqual(lastPostedOn(day("2026-10-01"), day("2026-10-03")), day("2026-10-03"));
    // Taken down and published afresh after a repost: the new listing date counts.
    assert.deepEqual(lastPostedOn(day("2026-10-05"), day("2026-10-03")), day("2026-10-05"));
  });
});

describe("daysUpSince and refreshCutoff", () => {
  it("count whole days, and agree on where a threshold falls", () => {
    assert.equal(daysUpSince(day("2026-10-09"), NOW), 0);
    assert.equal(daysUpSince(day("2026-10-06"), NOW), 3);
    assert.equal(daysUpSince(new Date("2026-10-10T00:00:00.000Z"), NOW), 0);
    // Past the threshold of 3 days exactly when posted at or before the cutoff.
    const cutoff = refreshCutoff(3, NOW);
    assert.equal(daysUpSince(cutoff, NOW), 3);
    assert.equal(daysUpSince(new Date(cutoff.getTime() + 1), NOW), 2);
  });
});

describe("quickBuyRefreshDue", () => {
  const quickBuy = {
    state: "active" as const,
    listingType: "fixed" as const,
    listingDate: day("2026-10-02"),
    lastPostedAt: null,
  };

  it("is the days up for an active quick buy at or past its threshold", () => {
    assert.equal(quickBuyRefreshDue(quickBuy, 7, NOW), 7);
    assert.equal(quickBuyRefreshDue(quickBuy, 3, NOW), 7);
    assert.equal(quickBuyRefreshDue(quickBuy, 8, NOW), null);
  });

  it("counts from the last repost, not the first listing", () => {
    assert.equal(quickBuyRefreshDue({ ...quickBuy, lastPostedAt: day("2026-10-08") }, 3, NOW), null);
    assert.equal(quickBuyRefreshDue({ ...quickBuy, lastPostedAt: day("2026-10-05") }, 3, NOW), 4);
  });

  it("is nothing without a threshold, a date, or an active quick buy", () => {
    assert.equal(quickBuyRefreshDue(quickBuy, null, NOW), null);
    assert.equal(quickBuyRefreshDue({ ...quickBuy, listingDate: null }, 3, NOW), null);
    assert.equal(quickBuyRefreshDue({ ...quickBuy, listingType: "auction" }, 3, NOW), null);
    for (const state of ["paused", "ready", "preparing", "sold", "withdrawn"] as const) {
      assert.equal(quickBuyRefreshDue({ ...quickBuy, state }, 3, NOW), null);
    }
  });
});
