import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOfferState,
  isLiveState,
  canTransition,
  manualTransitions,
  isTerminalState,
  requiresSets,
  quickAdvanceTarget,
  parsePrice,
  normalizeUrl,
  OFFER_STATES,
  CLOSED_OFFER_STATES,
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
