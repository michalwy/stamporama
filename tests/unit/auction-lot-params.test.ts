import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lotParams,
  type AuctionLotFilters,
} from "../../src/app/c/[collectionSlug]/auctions/lot-params";

/**
 * What the lot list actually asks the API for (#450). The regression these guard is a filter the
 * panel sets but the request never carries: `outcome` was in the panel's filters object and read by
 * the route, yet silently absent from the serialiser in between, so every chip returned the whole
 * list.
 *
 * `every` is the guard that keeps it from recurring: the sample is typed `Required<…>`, so a filter
 * added to the interface fails to compile here until it is listed — and then fails loudly at
 * runtime until `lotParams` serialises it.
 */
describe("auction lot params", () => {
  const every: Required<AuctionLotFilters> = {
    outcome: "won",
    closing: "week",
    signal: "outbid",
    undescribed: true,
    duplicate: true,
    search: "köhler",
    sellerId: "seller-1",
    platformId: "platform-1",
  };

  it("serialises every filter the interface carries", () => {
    const params = lotParams(every);
    for (const key of Object.keys(every)) {
      assert.ok(params.has(key), `${key} never reaches the request`);
    }
  });

  it("sends each filter under the name the route reads back", () => {
    const params = lotParams(every);
    assert.equal(params.get("outcome"), "won");
    assert.equal(params.get("closing"), "week");
    assert.equal(params.get("signal"), "outbid");
    assert.equal(params.get("undescribed"), "1");
    assert.equal(params.get("duplicate"), "1");
    assert.equal(params.get("search"), "köhler");
    assert.equal(params.get("sellerId"), "seller-1");
    assert.equal(params.get("platformId"), "platform-1");
  });

  it("sends the outcome chip's filter", () => {
    assert.equal(lotParams({ outcome: "observed" }).toString(), "outcome=observed");
  });

  it("omits what is not set", () => {
    assert.equal(lotParams({}).toString(), "");
    assert.equal(lotParams({ undescribed: false, duplicate: false }).toString(), "");
    assert.equal(lotParams({ sellerId: "" }).toString(), "");
  });
});
