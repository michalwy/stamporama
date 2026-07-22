import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isOfferState,
  isLiveState,
  canTransition,
  manualTransitions,
  isTerminalState,
  parsePrice,
  normalizeUrl,
  OFFER_STATES,
} from "../../src/lib/offer-rules";

// Type guard ----------------------------------------------------------------

describe("isOfferState", () => {
  it("accepts the four states and rejects everything else", () => {
    for (const s of OFFER_STATES) assert.equal(isOfferState(s), true);
    assert.equal(isOfferState("draft"), false);
    assert.equal(isOfferState(undefined), false);
    assert.equal(isOfferState(""), false);
  });
});

// Live / terminal -----------------------------------------------------------

describe("isLiveState", () => {
  it("only active offers hold a live claim (collide)", () => {
    assert.equal(isLiveState("active"), true);
    assert.equal(isLiveState("paused"), false);
    assert.equal(isLiveState("sold"), false);
    assert.equal(isLiveState("withdrawn"), false);
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
    assert.deepEqual([...manualTransitions("active")], ["paused", "withdrawn"]);
    assert.deepEqual([...manualTransitions("paused")], ["active", "withdrawn"]);
    assert.deepEqual([...manualTransitions("sold")], []);
    assert.deepEqual([...manualTransitions("withdrawn")], []);
  });
});

// Price parsing -------------------------------------------------------------

describe("parsePrice", () => {
  it("normalises a valid price to 2 decimals", () => {
    assert.deepEqual(parsePrice("12"), { ok: true, value: "12.00" });
    assert.deepEqual(parsePrice(" 3.5 "), { ok: true, value: "3.50" });
    assert.deepEqual(parsePrice("0"), { ok: true, value: "0.00" });
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
