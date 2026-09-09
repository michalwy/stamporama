import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  arrivalLotId,
  byLotWithArrival,
} from "../../src/app/c/[collectionSlug]/purchases/[purchaseId]/lot-arrival";

/**
 * What a `?lot=` deep link into a purchase order resolves to (#911).
 *
 * The defect these guard is a link that did something or nothing depending on how the collector
 * last left the screen: only the by-lot view draws lot cards, so in the flat and by-issue views
 * the arrival had nothing to open, scroll to or flash — and consumed the param regardless.
 *
 * Both halves of the fix are pure and are therefore here rather than left to a reading of the
 * panel: an arrival forces the by-lot view, and the param is consumed only where it was answered.
 * What no unit test here can see is that the switch is *transient* — that lives in component
 * state and in which setter writes the preference — so `byLotWithArrival` is tested for what it
 * computes and the panel's comments carry the rest.
 */
describe("lot arrival", () => {
  const lots = ["lot-a", "lot-b", "lot-c"];

  describe("which lot is being pointed at", () => {
    it("resolves a lot this order holds", () => {
      assert.equal(arrivalLotId("lot-b", lots), "lot-b");
    });

    it("is null with no param at all", () => {
      assert.equal(arrivalLotId(null, lots), null);
      assert.equal(arrivalLotId(undefined, lots), null);
    });

    it("is null for a lot the order does not hold, so the param is never consumed", () => {
      // The lot was deleted, or the copy was moved out of it, after the link was made. There is
      // nothing to open, scroll to or flash — and the panel keys its `router.replace` on this
      // same answer, so the address bar keeps the parameter rather than tidying itself over a
      // screen that did not react.
      assert.equal(arrivalLotId("lot-z", lots), null);
    });

    it("is null on an order with no lots", () => {
      assert.equal(arrivalLotId("lot-a", []), null);
    });

    it("does not match on a prefix or a case fold — an id is an id", () => {
      assert.equal(arrivalLotId("lot", lots), null);
      assert.equal(arrivalLotId("lot-a ", lots), null);
      assert.equal(arrivalLotId("LOT-A", lots), null);
    });

    it("treats an empty param as no param", () => {
      // `?lot=` with nothing after it: `URLSearchParams.get` answers "", which names no lot.
      assert.equal(arrivalLotId("", lots), null);
    });
  });

  describe("how the copies are grouped while an arrival is live", () => {
    it("forces the by-lot view when the collector's preference is anything else", () => {
      assert.equal(byLotWithArrival(false, true), true);
    });

    it("leaves the by-lot view alone when that is already the preference", () => {
      assert.equal(byLotWithArrival(true, true), true);
    });

    it("changes nothing when there is no arrival", () => {
      assert.equal(byLotWithArrival(false, false), false);
      assert.equal(byLotWithArrival(true, false), true);
    });
  });
});
