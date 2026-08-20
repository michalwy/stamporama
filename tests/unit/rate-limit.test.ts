import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { rateLimit, resetRateLimits } from "../../src/lib/rate-limit";

// The fixed-window limiter behind the one surface reachable without a session (#640).

describe("rateLimit", () => {
  beforeEach(resetRateLimits);

  it("allows up to the limit and refuses the one after it", () => {
    for (let i = 0; i < 3; i++) {
      assert.equal(rateLimit("k", 3, 1000, 0).ok, true, `hit ${i + 1} should pass`);
    }
    assert.equal(rateLimit("k", 3, 1000, 0).ok, false);
  });

  it("reports how long the caller must wait, in whole seconds and never zero", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 5000, 0);
    assert.equal(rateLimit("k", 3, 5000, 4900).retryAfter, 1);
    assert.equal(rateLimit("k", 3, 5000, 0).retryAfter, 5);
  });

  it("starts a fresh window once the old one has ended", () => {
    for (let i = 0; i < 3; i++) rateLimit("k", 3, 1000, 0);
    assert.equal(rateLimit("k", 3, 1000, 500).ok, false);
    assert.equal(rateLimit("k", 3, 1000, 1000).ok, true);
  });

  it("counts each key on its own — one partner reloading must not lock out another", () => {
    for (let i = 0; i < 3; i++) rateLimit("a", 3, 1000, 0);
    assert.equal(rateLimit("a", 3, 1000, 0).ok, false);
    assert.equal(rateLimit("b", 3, 1000, 0).ok, true);
  });
});
