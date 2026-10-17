import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { facebookBidding, recordBidLabel } from "../../src/lib/facebook-bidding-rules";

// A Facebook group auction's bidding (#1545, #2010): followed while the auction is up in the group,
// closed once its closing time has passed — one rule for the desk's Facebook card and the phone.

const NOW = new Date("2026-10-18T12:00:00Z");
const auction = {
  listingType: "auction" as const,
  state: "active" as const,
  endsAt: "2026-10-18T20:00:00Z",
  price: "0.00",
};

describe("facebookBidding", () => {
  it("follows a running auction with no bid yet", () => {
    assert.deepEqual(facebookBidding(auction, NOW), { closed: false, hasBid: false });
  });

  it("reads the offer's price as the standing bid", () => {
    assert.deepEqual(facebookBidding({ ...auction, price: "12.50" }, NOW), { closed: false, hasBid: true });
  });

  it("calls it closed once the closing time has passed, to the instant", () => {
    assert.equal(facebookBidding({ ...auction, endsAt: NOW }, NOW)?.closed, true);
    assert.equal(facebookBidding({ ...auction, endsAt: new Date(NOW.getTime() + 1) }, NOW)?.closed, false);
  });

  it("never calls an auction with no closing time closed", () => {
    assert.equal(facebookBidding({ ...auction, endsAt: null }, NOW)?.closed, false);
  });

  it("follows a paused auction too", () => {
    assert.notEqual(facebookBidding({ ...auction, state: "paused" }, NOW), null);
  });

  it("has no bidding for an auction not up in the group", () => {
    for (const state of ["preparing", "ready", "pending", "sold", "withdrawn"] as const) {
      assert.equal(facebookBidding({ ...auction, state }, NOW), null, state);
    }
  });

  it("has no bidding for a quick buy", () => {
    assert.equal(facebookBidding({ ...auction, listingType: "fixed" }, NOW), null);
  });
});

describe("recordBidLabel", () => {
  it("records the winning bid once closed", () => {
    assert.equal(recordBidLabel(false), "Record bid");
    assert.equal(recordBidLabel(true), "Record winning bid");
  });
});
