import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lotParams,
  lotNarrowings,
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
    includeClosed: true,
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
    assert.equal(params.get("includeClosed"), "1");
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
    assert.equal(
      lotParams({ undescribed: false, duplicate: false, includeClosed: false }).toString(),
      ""
    );
    assert.equal(lotParams({ sellerId: "" }).toString(), "");
  });
});

/**
 * Which filters the band above the rows announces (#1018).
 *
 * The regression these guard is the one that would put the screen back where it started: every
 * filter is remembered now, so a list can arrive already narrowed by a decision made yesterday, and
 * the band is the only thing that says so. A filter the band does not know about is a narrowing
 * nobody can see — which is exactly the defect the change was made to avoid, reintroduced by
 * addition rather than by edit.
 *
 * `every` is typed `Required<…>` for the same reason `lotParams` is tested that way: a tenth filter
 * fails to compile in `LOT_NARROWS` until somebody has decided whether it narrows.
 */
describe("auction lot narrowings", () => {
  const every: Required<AuctionLotFilters> = {
    outcome: "won",
    includeClosed: true,
    closing: "ended",
    signal: "outbid",
    undescribed: true,
    duplicate: true,
    search: "köhler",
    sellerId: "seller-1",
    platformId: "platform-1",
  };

  it("announces every filter that narrows the list", () => {
    const keys = lotNarrowings(every).map((n) => n.key);
    for (const key of Object.keys(every) as (keyof AuctionLotFilters)[]) {
      if (key === "includeClosed") continue;
      assert.ok(keys.includes(key), `${key} narrows the list and the band never says so`);
    }
  });

  it("says nothing about the one switch that widens the list", () => {
    // `includeClosed` shows *more* lots (#504). Announcing it would tell the collector that
    // something is being hidden at the moment more of it is being shown.
    assert.deepEqual(lotNarrowings({ includeClosed: true }), []);
  });

  it("says nothing about a list nobody has narrowed", () => {
    assert.deepEqual(lotNarrowings({}), []);
  });

  it("carries the value, so the band can name it in the control's own words", () => {
    assert.deepEqual(lotNarrowings({ closing: "ended" }), [{ key: "closing", value: "ended" }]);
    assert.deepEqual(lotNarrowings({ undescribed: true }), [{ key: "undescribed", value: "1" }]);
    assert.deepEqual(lotNarrowings({ sellerId: "s-1" }), [{ key: "sellerId", value: "s-1" }]);
  });

  it("does not count a search box holding only whitespace", () => {
    // The box is edited in place and passes through blank on the way to empty; the list is not
    // narrowed by it, so a band saying it is would be wrong for as long as the pause lasted.
    assert.deepEqual(lotNarrowings({ search: "   " }), []);
    assert.deepEqual(lotNarrowings({ search: "köhler" }), [{ key: "search", value: "köhler" }]);
  });
});
