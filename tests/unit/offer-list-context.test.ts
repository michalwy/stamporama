import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  offerListContextQuery,
  offerListHref,
  parseOfferListContext,
  type OfferListContext,
} from "../../src/app/c/[collectionSlug]/offers/list-context";

/** The filter context an offer is opened with (#429): what the list was showing, carried in the
 * detail URL so the screen can step to the next offer in the same order. */
describe("offer list context", () => {
  function roundTrip(context: OfferListContext): OfferListContext | null {
    const query = offerListContextQuery(context);
    return parseOfferListContext(new URLSearchParams(query.slice(1)));
  }

  it("round-trips a platform + state filter", () => {
    assert.deepEqual(roundTrip({ platformId: "p1", states: ["preparing"] }), {
      platformId: "p1",
      states: ["preparing"],
      needsAction: false,
      bidding: false,
      endedAuction: false,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: false,
      search: undefined,
    });
  });

  it("round-trips several states at once (#475)", () => {
    assert.deepEqual(roundTrip({ states: ["ready", "active"] }), {
      platformId: undefined,
      states: ["ready", "active"],
      needsAction: false,
      bidding: false,
      endedAuction: false,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: false,
      search: undefined,
    });
  });

  it("round-trips the search box, the walk stepping along the list a search narrowed (#465)", () => {
    assert.deepEqual(roundTrip({ search: "Mi 865" }), {
      platformId: undefined,
      states: [],
      needsAction: false,
      bidding: false,
      endedAuction: false,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: false,
      search: "Mi 865",
    });
  });

  it("round-trips the show-closed toggle, which the list keeps out of its own URL", () => {
    assert.deepEqual(roundTrip({ states: ["sold"], includeClosed: true }), {
      platformId: undefined,
      states: ["sold"],
      needsAction: false,
      bidding: false,
      endedAuction: false,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: true,
      search: undefined,
    });
  });

  it("keeps needs-action and state mutually exclusive, as the toolbar does", () => {
    assert.deepEqual(roundTrip({ needsAction: true, states: ["active"] }), {
      platformId: undefined,
      states: [],
      needsAction: true,
      bidding: false,
      endedAuction: false,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: false,
      search: undefined,
    });
  });

  it("reads an unfiltered walk — the whole list — as a context", () => {
    assert.deepEqual(roundTrip({}), {
      platformId: undefined,
      states: [],
      needsAction: false,
      bidding: false,
      endedAuction: false,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: false,
      search: undefined,
    });
  });

  it("carries the in-bidding narrowing, which stands beside the state chips (#481)", () => {
    assert.deepEqual(roundTrip({ bidding: true, states: ["active"] }), {
      platformId: undefined,
      states: ["active"],
      needsAction: false,
      bidding: true,
      endedAuction: false,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: false,
      search: undefined,
    });
    assert.equal(offerListHref("mine", { bidding: true }), "/c/mine/offers?bidding=1");
  });

  it("carries the ended-auction narrowing the notification centre links to (#490)", () => {
    assert.deepEqual(roundTrip({ endedAuction: true }), {
      platformId: undefined,
      states: [],
      needsAction: false,
      bidding: false,
      endedAuction: true,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: false,
      search: undefined,
    });
    assert.equal(
      offerListHref("mine", { endedAuction: true }),
      "/c/mine/offers?endedAuction=1"
    );
  });

  it("carries the changed-since-listed narrowing a re-listing session walks (#542)", () => {
    assert.deepEqual(roundTrip({ listingOutOfDate: true }), {
      platformId: undefined,
      states: [],
      needsAction: false,
      bidding: false,
      endedAuction: false,
      listingOutOfDate: true,
      platformSale: false,
      includeClosed: false,
      search: undefined,
    });
    assert.equal(
      offerListHref("mine", { listingOutOfDate: true }),
      "/c/mine/offers?listingOutOfDate=1"
    );
  });

  it("has no context without the marker: a deep link is not a walk", () => {
    assert.equal(parseOfferListContext(new URLSearchParams("platform=p1&state=ready")), null);
    assert.equal(parseOfferListContext(new URLSearchParams()), null);
  });

  it("drops a state that is not one, keeping the rest of the set", () => {
    const parsed = parseOfferListContext(
      new URLSearchParams("from=list&state=nonsense,ready")
    );
    assert.deepEqual(parsed?.states, ["ready"]);
    assert.deepEqual(
      parseOfferListContext(new URLSearchParams("from=list&state=nonsense"))?.states,
      []
    );
  });

  it("reads a Next-style searchParams object as well as a URLSearchParams", () => {
    assert.deepEqual(parseOfferListContext({ from: "list", platform: "p1", needsAction: "1" }), {
      platformId: "p1",
      states: [],
      needsAction: true,
      bidding: false,
      endedAuction: false,
      listingOutOfDate: false,
      platformSale: false,
      includeClosed: false,
      search: undefined,
    });
  });

  it("points the way back at the list as it was, without the remembered toggle", () => {
    assert.equal(
      offerListHref("mine", { platformId: "p1", states: ["ready"], includeClosed: true }),
      "/c/mine/offers?platform=p1&state=ready"
    );
    assert.equal(
      offerListHref("mine", { states: ["ready", "active"] }),
      "/c/mine/offers?state=ready%2Cactive"
    );
    assert.equal(offerListHref("mine", { needsAction: true }), "/c/mine/offers?needsAction=1");
    assert.equal(offerListHref("mine", {}), "/c/mine/offers");
    assert.equal(offerListHref("mine", null), "/c/mine/offers");
  });
});
