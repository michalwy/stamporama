import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  findPendingListing,
  prunePendingListings,
  upsertPendingListing,
  withoutPendingListing,
  type PendingListing,
} from "./pending-listings";

// Only the list operations are covered: the storage calls need a chrome.storage double, while these
// are what decides whether a submitted form still activates its offer (#412).

const HOUR = 60 * 60 * 1000;

const pending = (over: Partial<PendingListing> = {}): PendingListing => ({
  tabId: 7,
  moduleId: "fake-market",
  moduleName: "FakeMarket",
  formUrl: "https://fake.test/sell",
  offerId: "o1",
  collectionId: "c1",
  requestId: "r1",
  instanceTabId: 3,
  instanceOrigin: "http://localhost:3000",
  submitted: false,
  filledAt: 0,
  ...over,
});

describe("prunePendingListings", () => {
  it("keeps a form filled hours ago and drops one from another day", () => {
    const list = [pending({ tabId: 1, filledAt: 0 }), pending({ tabId: 2, filledAt: -30 * HOUR })];
    assert.deepEqual(
      prunePendingListings(list, 2 * HOUR).map((p) => p.tabId),
      [1]
    );
  });
});

describe("upsertPendingListing", () => {
  it("replaces what the tab held — a second fill is a second listing", () => {
    const list = upsertPendingListing(
      [pending({ tabId: 7, offerId: "o1" })],
      pending({ tabId: 7, offerId: "o2" })
    );
    assert.deepEqual(
      list.map((p) => p.offerId),
      ["o2"]
    );
  });

  it("leaves other tabs' listings alone", () => {
    const list = upsertPendingListing([pending({ tabId: 7 })], pending({ tabId: 8 }));
    assert.deepEqual(
      list.map((p) => p.tabId),
      [7, 8]
    );
  });
});

describe("findPendingListing / withoutPendingListing", () => {
  it("answers per tab, and forgetting one is exactly that tab", () => {
    const list = [pending({ tabId: 7 }), pending({ tabId: 8 })];
    assert.equal(findPendingListing(list, 8)?.tabId, 8);
    assert.equal(findPendingListing(list, 9), null);
    assert.deepEqual(
      withoutPendingListing(list, 7).map((p) => p.tabId),
      [8]
    );
  });
});
