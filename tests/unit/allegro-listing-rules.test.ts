import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  ALLEGRO_TITLE_MAX_LENGTH,
  evaluateAllegroListingBlockers,
  type AllegroListingReadiness,
  type AllegroProfileForPublish,
} from "../../src/lib/allegro-listing-rules";
import {
  evaluateAllegroApiBlockers,
  evaluateAllegroPublishBlockers,
  type AllegroPublishReadiness,
} from "../../src/lib/allegro-publish-rules";

// The half of #477's refusals that is about the **listing** rather than about the API (#493): the
// Assistant fills Allegro's own sale form with no connection at all, and must refuse on exactly
// these and no others.

const PROFILE: AllegroProfileForPublish = {
  id: "p1",
  name: "Home, letter rates",
  shippingRatesId: "rates-1",
  handlingTime: "PT24H",
  returnPolicyId: "ret-1",
  impliedWarrantyId: "war-1",
  locationCountryCode: "PL",
  locationCity: "Kraków",
  locationPostCode: "30-001",
  invoiceType: "NO_INVOICE",
};

function listing(over: Partial<AllegroListingReadiness> = {}): AllegroListingReadiness {
  return {
    state: "ready",
    listingType: "fixed",
    title: "Polska 1935 Mi 1-12 czyste",
    price: "48.00",
    startingPrice: null,
    quantity: 2,
    setsInterchangeable: true,
    differingSetLabels: [],
    profile: PROFILE,
    photosReady: true,
    photoCount: 3,
    categoryId: "9581",
    unansweredParameters: [],
    ...over,
  };
}

/** The same offer as a publish sees it, with a connection that stops nothing. */
function publish(over: Partial<AllegroPublishReadiness> = {}): AllegroPublishReadiness {
  return {
    ...listing(),
    isAllegroPlatform: true,
    connected: true,
    needsReconnect: false,
    canPublish: true,
    publishRefusedReason: null,
    publishedAs: null,
    ...over,
  };
}

const codes = (input: AllegroListingReadiness) =>
  evaluateAllegroListingBlockers(input).map((b) => b.code);

describe("evaluateAllegroListingBlockers", () => {
  it("passes a listing that is complete, without being told anything about a connection", () => {
    assert.deepEqual(codes(listing()), []);
  });

  it("refuses an over-long title at Allegro's own cap", () => {
    assert.deepEqual(codes(listing({ title: "x".repeat(ALLEGRO_TITLE_MAX_LENGTH) })), []);
    assert.deepEqual(codes(listing({ title: "x".repeat(ALLEGRO_TITLE_MAX_LENGTH + 1) })), [
      "title-too-long",
    ]);
  });

  it("refuses sets that are not interchangeable — one stock figure cannot describe them", () => {
    assert.deepEqual(
      codes(listing({ setsInterchangeable: false, differingSetLabels: ["Mi·PL 2"] })),
      ["mixed-sets"]
    );
  });

  it("reports every listing-side gap at once — each is fixed somewhere different", () => {
    assert.deepEqual(
      codes(listing({ title: null, price: "0.00", profile: null, categoryId: null, photoCount: 0 })),
      ["no-title", "no-price", "no-profile", "no-category", "no-photos"]
    );
  });

  it("says nothing else about an offer that is not Ready", () => {
    assert.deepEqual(codes(listing({ state: "preparing", title: null })), ["not-ready"]);
  });
});

describe("the two groups of #477's refusals", () => {
  it("adds the API's group in front of the listing's, and never restates one", () => {
    const input = publish({ title: null });
    assert.deepEqual(evaluateAllegroApiBlockers(input), []);
    assert.deepEqual(
      evaluateAllegroPublishBlockers(input).map((b) => b.code),
      evaluateAllegroListingBlockers(input).map((b) => b.code)
    );
  });

  it("stops at the connection, since no listing can be corrected into passing it", () => {
    // The account Allegro refuses through the API is precisely the one the Assistant path is for
    // (#493) — so the listing itself must still evaluate clean on its own.
    const input = publish({
      publishRefusedReason: "You cannot use the Public API method when selling with a Regular Account",
      title: null,
    });
    assert.deepEqual(
      evaluateAllegroPublishBlockers(input).map((b) => b.code),
      ["account-not-eligible"]
    );
    assert.deepEqual(evaluateAllegroListingBlockers(input).map((b) => b.code), ["no-title"]);
  });
});
