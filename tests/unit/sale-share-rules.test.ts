import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canChooseSaleSet,
  describeSaleChoiceClosed,
  isSaleShareTokenShape,
  resolveSaleShareAccess,
  saleChoiceOptionLabel,
  saleChoicePrompt,
  SALE_SHARE_TOKEN_PREFIX,
} from "../../src/lib/sale-share-rules";

// What the buyer's link is allowed to do (#699) — the pure half, asserted rather than reasoned
// about. Two of these three are security answers and the third is the whole product decision: the
// question is open until the parcel is packed, and not one status further.

describe("the buyer's link (#699)", () => {
  describe("token shape", () => {
    it("accepts our own prefix with something after it", () => {
      assert.equal(isSaleShareTokenShape(`${SALE_SHARE_TOKEN_PREFIX}abc`), true);
    });

    it("rejects the prefix alone, an empty string and other credentials", () => {
      assert.equal(isSaleShareTokenShape(SALE_SHARE_TOKEN_PREFIX), false);
      assert.equal(isSaleShareTokenShape(""), false);
      // A trade's share link and an Assistant token authorise different things, and are told apart
      // before anything is hashed.
      assert.equal(isSaleShareTokenShape("stmpx_abc"), false);
      assert.equal(isSaleShareTokenShape("stmpa_abc"), false);
    });
  });

  describe("serving a resolved token", () => {
    const now = new Date("2026-08-23T12:00:00Z");

    it("serves a link with no expiry", () => {
      assert.deepEqual(resolveSaleShareAccess({ expiresAt: null }, now), { ok: true });
    });

    it("refuses one whose day has passed, by name", () => {
      assert.deepEqual(resolveSaleShareAccess({ expiresAt: new Date("2026-08-23T11:59:59Z") }, now), {
        ok: false,
        reason: "expired",
      });
    });

    it("serves one that still has time on it", () => {
      assert.deepEqual(resolveSaleShareAccess({ expiresAt: new Date("2026-08-24T00:00:00Z") }, now), {
        ok: true,
      });
    });
  });

  describe("the window", () => {
    it("is open while the parcel is still being paid for", () => {
      assert.equal(canChooseSaleSet("ordered"), true);
      assert.equal(canChooseSaleSet("paid"), true);
    });

    it("closes the moment the copies are in the envelope", () => {
      // The whole point: from here the question has been answered in the physical world, and a pick
      // landing afterwards would rewrite the record and drop the seller's packing marks.
      assert.equal(canChooseSaleSet("packed"), false);
      assert.equal(canChooseSaleSet("sent"), false);
      assert.equal(canChooseSaleSet("received"), false);
    });

    it("says why it closed, in terms of the parcel", () => {
      assert.match(describeSaleChoiceClosed("packed"), /packed/);
      assert.match(describeSaleChoiceClosed("sent"), /on its way/);
      assert.match(describeSaleChoiceClosed("received"), /on its way/);
    });
  });

  describe("wording", () => {
    it("numbers the copies from one", () => {
      assert.equal(saleChoiceOptionLabel(0), "Copy 1");
      assert.equal(saleChoiceOptionLabel(2), "Copy 3");
    });

    it("asks a different question when there is only one copy left", () => {
      assert.match(saleChoicePrompt(1), /One copy/);
      assert.match(saleChoicePrompt(3), /3 of this stamp/);
    });
  });
});
