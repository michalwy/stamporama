import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  LISTED_OFFER_STATES,
  headerChangeIsDrift,
  isListedState,
} from "../../src/lib/offer-listing-drift";
import { OFFER_STATES, type OfferState } from "../../src/lib/offer-rules";

describe("isListedState", () => {
  it("counts the two states in which a listing is up on the platform", () => {
    assert.equal(isListedState("active"), true);
    assert.equal(isListedState("paused"), true);
  });

  it("excludes an offer that has never been posted", () => {
    assert.equal(isListedState("preparing"), false);
    assert.equal(isListedState("ready"), false);
  });

  it("excludes the terminal states — a closed listing is a record, not a claim", () => {
    assert.equal(isListedState("sold"), false);
    assert.equal(isListedState("withdrawn"), false);
  });

  it("agrees with the exported list, which the domain layer narrows on", () => {
    for (const state of OFFER_STATES) {
      assert.equal(
        isListedState(state),
        (LISTED_OFFER_STATES as readonly OfferState[]).includes(state),
        state
      );
    }
  });
});

describe("headerChangeIsDrift", () => {
  const none = { priceChanged: false, startingPriceChanged: false, textChanged: false };

  it("says nothing changed when nothing changed", () => {
    assert.equal(headerChangeIsDrift({ listingType: "fixed", ...none }), false);
    assert.equal(headerChangeIsDrift({ listingType: "auction", ...none }), false);
  });

  it("counts a text change on either listing type", () => {
    assert.equal(
      headerChangeIsDrift({ listingType: "fixed", ...none, textChanged: true }),
      true
    );
    assert.equal(
      headerChangeIsDrift({ listingType: "auction", ...none, textChanged: true }),
      true
    );
  });

  it("counts a quick buy's asking price — nothing but the seller moves it", () => {
    assert.equal(
      headerChangeIsDrift({ listingType: "fixed", ...none, priceChanged: true }),
      true
    );
  });

  it("ignores an auction's current price — that is an observation of the bidding", () => {
    assert.equal(
      headerChangeIsDrift({ listingType: "auction", ...none, priceChanged: true }),
      false
    );
  });

  it("counts an auction's starting price — the figure the seller states", () => {
    assert.equal(
      headerChangeIsDrift({ listingType: "auction", ...none, startingPriceChanged: true }),
      true
    );
  });

  it("still reports a text change on an auction whose bid also moved", () => {
    assert.equal(
      headerChangeIsDrift({
        listingType: "auction",
        priceChanged: true,
        startingPriceChanged: false,
        textChanged: true,
      }),
      true
    );
  });
});
