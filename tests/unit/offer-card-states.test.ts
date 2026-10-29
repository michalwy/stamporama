import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_SHOWN_OFFER_STATES,
  countOffersByState,
  hiddenOffersText,
  parseShownOfferStates,
  toggleShownOfferState,
  writeShownOfferStates,
} from "../../src/lib/offer-card-states";
import type { OfferState } from "../../src/lib/offer-rules";

// #2263: the Offers card's state chips — every state not closed on by default, sold and withdrawn
// off, any number on together, remembered as one value.

describe("parseShownOfferStates", () => {
  it("shows every state but sold and withdrawn when nothing is stored", () => {
    assert.deepEqual(parseShownOfferStates(null), ["preparing", "ready", "pending", "active", "paused"]);
    assert.deepEqual(parseShownOfferStates(""), [...DEFAULT_SHOWN_OFFER_STATES]);
  });

  it("reads a stored choice in the lifecycle's order, dropping unknown states", () => {
    assert.deepEqual(parseShownOfferStates("withdrawn,active,gone"), ["active", "withdrawn"]);
  });

  it("falls back to the default when nothing stored is a state", () => {
    assert.deepEqual(parseShownOfferStates("gone"), [...DEFAULT_SHOWN_OFFER_STATES]);
  });

  it("reads every chip switched off as nothing shown", () => {
    assert.deepEqual(parseShownOfferStates(writeShownOfferStates([])), []);
  });
});

describe("writeShownOfferStates", () => {
  it("stores the default as nothing", () => {
    assert.equal(writeShownOfferStates(["paused", "active", "pending", "ready", "preparing"]), "");
  });

  it("round-trips any other choice", () => {
    const shown: OfferState[] = ["active", "sold"];
    assert.deepEqual(parseShownOfferStates(writeShownOfferStates(shown)), shown);
    const all: OfferState[] = [...DEFAULT_SHOWN_OFFER_STATES, "sold", "withdrawn"];
    assert.deepEqual(parseShownOfferStates(writeShownOfferStates(all)), all);
  });
});

describe("toggleShownOfferState", () => {
  it("switches a chip on and off, any number together, none included", () => {
    const withSold = toggleShownOfferState(DEFAULT_SHOWN_OFFER_STATES, "sold");
    assert.ok(withSold.includes("sold"));
    assert.equal(withSold.length, 6);
    assert.deepEqual(toggleShownOfferState(withSold, "sold"), [...DEFAULT_SHOWN_OFFER_STATES]);
    assert.deepEqual(toggleShownOfferState(["active"], "active"), []);
  });
});

describe("countOffersByState", () => {
  it("gives a chip only to states present, in the lifecycle's order, with counts", () => {
    const offers = [{ state: "sold" }, { state: "active" }, { state: "sold" }] as { state: OfferState }[];
    assert.deepEqual(countOffersByState(offers), [
      { state: "active", count: 1 },
      { state: "sold", count: 2 },
    ]);
  });
});

describe("hiddenOffersText", () => {
  it("names what the chips hide", () => {
    const counts = countOffersByState(
      [{ state: "sold" }, { state: "withdrawn" }, { state: "sold" }] as { state: OfferState }[]
    );
    assert.equal(hiddenOffersText(counts, DEFAULT_SHOWN_OFFER_STATES), "2 sold, 1 withdrawn hidden");
  });
});
