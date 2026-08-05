import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOfferState,
  isLiveState,
  canTransition,
  manualTransitions,
  isTerminalState,
  requiresSets,
  requiresPrice,
  hasPrice,
  quickAdvanceTarget,
  parsePrice,
  normalizeUrl,
  parseOfferDate,
  isCreatableOfferState,
  isOfferListingType,
  isAuctionListing,
  normalizeListingType,
  priceLabel,
  parseStartingPrice,
  parseOfferEndsAt,
  auctionNeedsResolution,
  pricingReadyFor,
  requiresStartingPrice,
  OFFER_LISTING_TYPES,
  OFFER_STATES,
  CLOSED_OFFER_STATES,
  CREATABLE_OFFER_STATES,
} from "../../src/lib/offer-rules";

// Type guard ----------------------------------------------------------------

describe("isOfferState", () => {
  it("accepts the six states and rejects everything else", () => {
    for (const s of OFFER_STATES) assert.equal(isOfferState(s), true);
    assert.equal(isOfferState("preparing"), true);
    assert.equal(isOfferState("ready"), true);
    assert.equal(isOfferState("draft"), false);
    assert.equal(isOfferState(undefined), false);
    assert.equal(isOfferState(""), false);
  });
});

// Live / terminal -----------------------------------------------------------

describe("isLiveState", () => {
  it("only active offers hold a live claim (collide)", () => {
    assert.equal(isLiveState("active"), true);
    assert.equal(isLiveState("preparing"), false);
    assert.equal(isLiveState("ready"), false);
    assert.equal(isLiveState("paused"), false);
    assert.equal(isLiveState("sold"), false);
    assert.equal(isLiveState("withdrawn"), false);
  });
});

describe("CLOSED_OFFER_STATES", () => {
  it("is exactly the terminal states (hidden from the list by default, #245)", () => {
    assert.deepEqual([...CLOSED_OFFER_STATES], ["sold", "withdrawn"]);
    for (const s of CLOSED_OFFER_STATES) assert.equal(isTerminalState(s), true);
  });
});

describe("isTerminalState", () => {
  it("sold and withdrawn are terminal; active and paused are not", () => {
    assert.equal(isTerminalState("sold"), true);
    assert.equal(isTerminalState("withdrawn"), true);
    assert.equal(isTerminalState("active"), false);
    assert.equal(isTerminalState("paused"), false);
  });
});

// State machine -------------------------------------------------------------

describe("canTransition", () => {
  it("advances a preparing offer (→ ready) or drops it (→ withdrawn)", () => {
    assert.equal(canTransition("preparing", "ready"), true);
    assert.equal(canTransition("preparing", "withdrawn"), true);
    assert.equal(canTransition("preparing", "active"), false); // must pass through ready (#246)
    assert.equal(canTransition("preparing", "paused"), false);
    assert.equal(canTransition("preparing", "sold"), false);
  });

  it("publishes a ready offer (→ active), steps it back (→ preparing), or drops it", () => {
    assert.equal(canTransition("ready", "active"), true);
    assert.equal(canTransition("ready", "preparing"), true);
    assert.equal(canTransition("ready", "withdrawn"), true);
    assert.equal(canTransition("ready", "paused"), false);
    assert.equal(canTransition("ready", "sold"), false);
  });

  it("allows active ↔ paused and → withdrawn", () => {
    assert.equal(canTransition("active", "paused"), true);
    assert.equal(canTransition("active", "withdrawn"), true);
    assert.equal(canTransition("paused", "active"), true);
    assert.equal(canTransition("paused", "withdrawn"), true);
  });

  it("never allows a manual transition to sold (owned by the sale flow)", () => {
    assert.equal(canTransition("active", "sold"), false);
    assert.equal(canTransition("paused", "sold"), false);
  });

  it("treats sold and withdrawn as terminal", () => {
    for (const to of OFFER_STATES) {
      assert.equal(canTransition("sold", to), false);
      assert.equal(canTransition("withdrawn", to), false);
    }
  });

  it("rejects same-state no-ops", () => {
    assert.equal(canTransition("active", "active"), false);
    assert.equal(canTransition("paused", "paused"), false);
  });
});

describe("manualTransitions", () => {
  it("lists exactly the hand-reachable targets", () => {
    assert.deepEqual([...manualTransitions("preparing")], ["ready", "withdrawn"]);
    assert.deepEqual([...manualTransitions("ready")], ["active", "preparing", "withdrawn"]);
    assert.deepEqual([...manualTransitions("active")], ["paused", "withdrawn"]);
    assert.deepEqual([...manualTransitions("paused")], ["active", "withdrawn"]);
    assert.deepEqual([...manualTransitions("sold")], []);
    assert.deepEqual([...manualTransitions("withdrawn")], []);
  });
});

describe("requiresSets", () => {
  it("only ready and active require the offer to list something (#188, #246)", () => {
    assert.equal(requiresSets("ready"), true);
    assert.equal(requiresSets("active"), true);
    assert.equal(requiresSets("preparing"), false);
    assert.equal(requiresSets("paused"), false);
    assert.equal(requiresSets("withdrawn"), false);
  });
});

describe("requiresPrice", () => {
  it("gates the same two states as requiresSets — ready and active (#336)", () => {
    assert.equal(requiresPrice("ready"), true);
    assert.equal(requiresPrice("active"), true);
    assert.equal(requiresPrice("preparing"), false);
    assert.equal(requiresPrice("paused"), false);
    assert.equal(requiresPrice("sold"), false);
    assert.equal(requiresPrice("withdrawn"), false);
  });
});

describe("hasPrice", () => {
  it("treats the zero the column carries for an unpriced offer as not set (#336)", () => {
    assert.equal(hasPrice("0.00"), false);
    assert.equal(hasPrice("0"), false);
    assert.equal(hasPrice(0), false);
  });

  it("accepts any positive amount, as string or number", () => {
    assert.equal(hasPrice("0.01"), true);
    assert.equal(hasPrice("12.50"), true);
    assert.equal(hasPrice(12.5), true);
  });

  it("treats an unparseable value as not set", () => {
    assert.equal(hasPrice(""), false);
    assert.equal(hasPrice("abc"), false);
  });
});

describe("quickAdvanceTarget", () => {
  it("advances only the linear forward part of the lifecycle (#255)", () => {
    assert.equal(quickAdvanceTarget("preparing"), "ready");
    assert.equal(quickAdvanceTarget("ready"), "active");
  });

  it("returns null where the next move is ambiguous or terminal", () => {
    assert.equal(quickAdvanceTarget("active"), null); // pause vs withdraw vs sell
    assert.equal(quickAdvanceTarget("paused"), null); // resume vs withdraw vs sell
    assert.equal(quickAdvanceTarget("sold"), null);
    assert.equal(quickAdvanceTarget("withdrawn"), null);
  });

  it("only ever targets a hand-reachable state (never sold)", () => {
    for (const s of OFFER_STATES) {
      const target = quickAdvanceTarget(s);
      if (target !== null) {
        assert.notEqual(target, "sold");
        assert.equal(canTransition(s, target), true);
      }
    }
  });
});

// Price parsing -------------------------------------------------------------

describe("parsePrice", () => {
  it("normalises a valid price to 2 decimals", () => {
    assert.deepEqual(parsePrice("12"), { ok: true, value: "12.00" });
    assert.deepEqual(parsePrice(" 3.5 "), { ok: true, value: "3.50" });
    assert.deepEqual(parsePrice("0"), { ok: true, value: "0.00" });
  });

  it("accepts a comma decimal separator (#233)", () => {
    assert.deepEqual(parsePrice("3,5"), { ok: true, value: "3.50" });
    assert.deepEqual(parsePrice(" 12,99 "), { ok: true, value: "12.99" });
  });

  it("rejects empty, non-numeric, and negative", () => {
    assert.equal(parsePrice("").ok, false);
    assert.equal(parsePrice("   ").ok, false);
    assert.equal(parsePrice("abc").ok, false);
    assert.equal(parsePrice("-1").ok, false);
  });
});

// URL normalisation ---------------------------------------------------------

describe("normalizeUrl", () => {
  it("trims and drops blank to null", () => {
    assert.equal(normalizeUrl("  https://x.test/1  "), "https://x.test/1");
    assert.equal(normalizeUrl("   "), null);
    assert.equal(normalizeUrl(""), null);
  });
});

// Listing date + creatable status (#257) -----------------------------------

describe("parseOfferDate", () => {
  it("parses a valid YYYY-MM-DD to a UTC date", () => {
    const r = parseOfferDate("2026-07-24");
    assert.equal(r.ok, true);
    assert.equal(r.ok && r.value?.toISOString(), "2026-07-24T00:00:00.000Z");
  });

  it("treats blank as not recorded (null)", () => {
    assert.deepEqual(parseOfferDate(""), { ok: true, value: null });
    assert.deepEqual(parseOfferDate("   "), { ok: true, value: null });
  });

  it("rejects malformed and impossible dates", () => {
    assert.equal(parseOfferDate("2026-7-4").ok, false);
    assert.equal(parseOfferDate("24-07-2026").ok, false);
    assert.equal(parseOfferDate("2026-02-31").ok, false); // JS rollover guard
  });
});

describe("isCreatableOfferState", () => {
  it("accepts only preparing / ready / active", () => {
    assert.deepEqual([...CREATABLE_OFFER_STATES], ["preparing", "ready", "active"]);
    assert.equal(isCreatableOfferState("preparing"), true);
    assert.equal(isCreatableOfferState("active"), true);
    assert.equal(isCreatableOfferState("paused"), false);
    assert.equal(isCreatableOfferState("sold"), false);
    assert.equal(isCreatableOfferState("withdrawn"), false);
    assert.equal(isCreatableOfferState("nope"), false);
  });
});

// Listing type — auction vs quick buy (#449) ---------------------------------

describe("listing type", () => {
  it("accepts only the two formats", () => {
    assert.deepEqual([...OFFER_LISTING_TYPES], ["fixed", "auction"]);
    assert.equal(isOfferListingType("fixed"), true);
    assert.equal(isOfferListingType("auction"), true);
    assert.equal(isOfferListingType("quick-buy"), false);
    assert.equal(isOfferListingType(undefined), false);
  });

  it("normalises anything unknown to a quick buy", () => {
    assert.equal(normalizeListingType("auction"), "auction");
    assert.equal(normalizeListingType("fixed"), "fixed");
    // The only thing an offer written before #449 could be, and the reading that claims the least.
    assert.equal(normalizeListingType(null), "fixed");
    assert.equal(normalizeListingType("tender"), "fixed");
  });

  it("names the price field after the format", () => {
    assert.equal(isAuctionListing("auction"), true);
    assert.equal(isAuctionListing("fixed"), false);
    assert.equal(priceLabel("fixed"), "Asking price");
    assert.equal(priceLabel("auction"), "Current price");
  });
});

describe("parseStartingPrice", () => {
  it("accepts a figure in either decimal notation, to 2 dp", () => {
    assert.deepEqual(parseStartingPrice("12,50"), { ok: true, value: "12.50" });
    assert.deepEqual(parseStartingPrice(" 9 "), { ok: true, value: "9.00" });
  });

  it("treats blank as 'not recorded' rather than as an error", () => {
    // Unlike the asking price: an auction picked up mid-flight may have no opening figure, and
    // nothing is computed from it.
    assert.deepEqual(parseStartingPrice(""), { ok: true, value: null });
    assert.deepEqual(parseStartingPrice("   "), { ok: true, value: null });
  });

  it("rejects a negative figure", () => {
    assert.equal(parseStartingPrice("-1").ok, false);
  });
});

describe("an auction's two prices (#449)", () => {
  it("requires the starting price exactly where a quick buy requires its asking price", () => {
    assert.equal(requiresStartingPrice("auction", "ready"), true);
    assert.equal(requiresStartingPrice("auction", "active"), true);
    assert.equal(requiresStartingPrice("auction", "preparing"), false);
    assert.equal(requiresStartingPrice("auction", "withdrawn"), false);
    // A quick buy has no such figure — `requiresPrice` already covers it.
    assert.equal(requiresStartingPrice("fixed", "ready"), false);
  });

  it("gates going live on the figure each format actually states", () => {
    // A quick buy: its own price, and nothing else.
    assert.equal(pricingReadyFor("fixed", "ready", "9.00", null), true);
    assert.equal(pricingReadyFor("fixed", "ready", "0.00", null), false);
    // An auction: the opening figure alone, with **no** current price — that one is an observation
    // of the bidding, and a listing nobody has bid on has none to make.
    assert.equal(pricingReadyFor("auction", "ready", "0.00", "5.00"), true);
    // …and it is required, so a bid recorded without one is still not a listed auction.
    assert.equal(pricingReadyFor("auction", "active", "18.00", null), false);
    // Nothing is asked of a state that does not go live.
    assert.equal(pricingReadyFor("auction", "preparing", "0.00", null), true);
  });
});

// Ended auctions with a bid on them (#490) ----------------------------------

describe("auctionNeedsResolution", () => {
  const now = new Date("2026-08-05T12:00:00Z");
  const ended = new Date("2026-08-04T18:00:00Z");
  const running = new Date("2026-08-06T18:00:00Z");
  const auction = {
    listingType: "auction" as const,
    state: "active" as const,
    endsAt: ended,
    price: "0.00",
    inActiveBidding: false,
    bidderCount: null as number | null,
  };

  it("flags an auction that closed with a standing bid", () => {
    assert.equal(auctionNeedsResolution({ ...auction, price: "42.00" }, now), true);
  });

  it("takes any of the three bid signals the app has", () => {
    // The flag set by hand or by the sync (#215/#481)…
    assert.equal(auctionNeedsResolution({ ...auction, inActiveBidding: true }, now), true);
    // …and a bidder count a sync actually observed (#481).
    assert.equal(auctionNeedsResolution({ ...auction, bidderCount: 1 }, now), true);
  });

  it("leaves an auction that ended unbid alone — which is what a relist is", () => {
    // A marketplace that relists an unsold auction by itself must never produce a flag: nobody bid,
    // so there is nothing to resolve, and the opening figure is deliberately not read here.
    assert.equal(auctionNeedsResolution(auction, now), false);
    assert.equal(auctionNeedsResolution({ ...auction, bidderCount: 0 }, now), false);
  });

  it("says nothing about an auction still running, or one with no closing time", () => {
    assert.equal(auctionNeedsResolution({ ...auction, endsAt: running, price: "42.00" }, now), false);
    assert.equal(auctionNeedsResolution({ ...auction, endsAt: null, price: "42.00" }, now), false);
  });

  it("leaves a quick buy alone — it has no ending of its own", () => {
    assert.equal(
      auctionNeedsResolution({ ...auction, listingType: "fixed", price: "42.00" }, now),
      false
    );
  });

  it("stops once the listing has been resolved", () => {
    for (const state of CLOSED_OFFER_STATES) {
      assert.equal(auctionNeedsResolution({ ...auction, state, price: "42.00" }, now), false);
    }
    // A paused auction is not resolved — it may still be taking bids, exactly as #215 has it.
    assert.equal(
      auctionNeedsResolution({ ...auction, state: "paused", price: "42.00" }, now),
      true
    );
  });
});

describe("parseOfferEndsAt", () => {
  it("reads the instant the form sends, and blank as not recorded", () => {
    const parsed = parseOfferEndsAt("2026-08-04T18:00:00.000Z");
    assert.equal(parsed.ok && parsed.value?.toISOString(), "2026-08-04T18:00:00.000Z");
    const blank = parseOfferEndsAt("   ");
    assert.equal(blank.ok && blank.value, null);
  });

  it("refuses what is not a time at all", () => {
    assert.equal(parseOfferEndsAt("soon").ok, false);
  });
});
