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
    assert.deepEqual(roundTrip({ platformId: "p1", state: "preparing" }), {
      platformId: "p1",
      state: "preparing",
      needsAction: false,
      includeClosed: false,
    });
  });

  it("round-trips the show-closed toggle, which the list keeps out of its own URL", () => {
    assert.deepEqual(roundTrip({ state: "sold", includeClosed: true }), {
      platformId: undefined,
      state: "sold",
      needsAction: false,
      includeClosed: true,
    });
  });

  it("keeps needs-action and state mutually exclusive, as the toolbar does", () => {
    assert.deepEqual(roundTrip({ needsAction: true, state: "active" }), {
      platformId: undefined,
      state: undefined,
      needsAction: true,
      includeClosed: false,
    });
  });

  it("reads an unfiltered walk — the whole list — as a context", () => {
    assert.deepEqual(roundTrip({}), {
      platformId: undefined,
      state: undefined,
      needsAction: false,
      includeClosed: false,
    });
  });

  it("has no context without the marker: a deep link is not a walk", () => {
    assert.equal(parseOfferListContext(new URLSearchParams("platform=p1&state=ready")), null);
    assert.equal(parseOfferListContext(new URLSearchParams()), null);
  });

  it("ignores a state that is not one", () => {
    const parsed = parseOfferListContext(new URLSearchParams("from=list&state=nonsense"));
    assert.equal(parsed?.state, undefined);
  });

  it("reads a Next-style searchParams object as well as a URLSearchParams", () => {
    assert.deepEqual(parseOfferListContext({ from: "list", platform: "p1", needsAction: "1" }), {
      platformId: "p1",
      state: undefined,
      needsAction: true,
      includeClosed: false,
    });
  });

  it("points the way back at the list as it was, without the remembered toggle", () => {
    assert.equal(
      offerListHref("mine", { platformId: "p1", state: "ready", includeClosed: true }),
      "/c/mine/offers?platform=p1&state=ready"
    );
    assert.equal(offerListHref("mine", { needsAction: true }), "/c/mine/offers?needsAction=1");
    assert.equal(offerListHref("mine", {}), "/c/mine/offers");
    assert.equal(offerListHref("mine", null), "/c/mine/offers");
  });
});
