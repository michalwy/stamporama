import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isTradeShareTokenShape,
  resolveTradeShareAccess,
  tradeShareSideHeading,
  TRADE_SHARE_TOKEN_PREFIX,
} from "../../src/lib/trade-share-rules";

// The partner link's pure rules (#640): what a token looks like, when one still serves, and what the
// partner's page calls the two sides.

const NOW = new Date("2026-08-20T12:00:00.000Z");

describe("trade share token shape", () => {
  it("accepts a token carrying the prefix and a body", () => {
    assert.equal(isTradeShareTokenShape(`${TRADE_SHARE_TOKEN_PREFIX}abc123`), true);
  });

  it("rejects the prefix on its own — a prefix is not a credential", () => {
    assert.equal(isTradeShareTokenShape(TRADE_SHARE_TOKEN_PREFIX), false);
  });

  it("rejects an Assistant token, which authorises something else entirely", () => {
    assert.equal(isTradeShareTokenShape("stmpa_abc123"), false);
  });

  it("rejects anything without a prefix, before a hash is ever computed", () => {
    assert.equal(isTradeShareTokenShape(""), false);
    assert.equal(isTradeShareTokenShape("abc123"), false);
  });
});

describe("what a share link may serve", () => {
  it("serves every live status, `preparing` included", () => {
    for (const status of ["preparing", "shared", "agreed", "closed"] as const) {
      assert.deepEqual(
        resolveTradeShareAccess({ expiresAt: null }, status, NOW),
        { ok: true },
        `${status} should serve`
      );
    }
  });

  it("refuses a cancelled trade by name — the exchange is off, not merely unavailable", () => {
    assert.deepEqual(resolveTradeShareAccess({ expiresAt: null }, "cancelled", NOW), {
      ok: false,
      reason: "cancelled",
    });
  });

  it("refuses once the expiry has passed, and serves right up to it", () => {
    const past = new Date(NOW.getTime() - 1000);
    const future = new Date(NOW.getTime() + 1000);
    assert.deepEqual(resolveTradeShareAccess({ expiresAt: past }, "shared", NOW), {
      ok: false,
      reason: "expired",
    });
    assert.deepEqual(resolveTradeShareAccess({ expiresAt: future }, "shared", NOW), { ok: true });
  });

  it("treats the expiry moment itself as past — an expiry is a deadline, not a grace period", () => {
    assert.deepEqual(resolveTradeShareAccess({ expiresAt: NOW }, "shared", NOW), {
      ok: false,
      reason: "expired",
    });
  });

  it("checks the expiry before the status, so an expired link on a cancelled trade reads as expired", () => {
    const past = new Date(NOW.getTime() - 1000);
    assert.deepEqual(resolveTradeShareAccess({ expiresAt: past }, "cancelled", NOW), {
      ok: false,
      reason: "expired",
    });
  });
});

describe("the partner's headings", () => {
  it("names who the material comes from rather than the collector's give and receive", () => {
    assert.equal(tradeShareSideHeading("give", "Anna", "Karel"), "From Anna");
    assert.equal(tradeShareSideHeading("receive", "Anna", "Karel"), "From Karel");
  });
});
