import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { lotsInState, parseLotStateFilter } from "../../src/lib/intake-filter-params";
import { withAskedForLot } from "../../src/app/c/[collectionSlug]/shared/lot-arrival";

/**
 * A purchase order's lots filtered by state (#1394): *Open*, *Closed*, or both — both being the
 * default, so nothing is hidden until the collector asks.
 *
 * What the tests below cannot see is the order-level read, which narrows the copies in SQL through
 * the lot clause of its scope, and the summary, which narrows the headings over enriched rows; both
 * take the value through `parseLotStateFilter`, which is why the parser is held to its vocabulary.
 */
describe("lot-state filter (#1394)", () => {
  const a = { id: "a", status: "open" };
  const b = { id: "b", status: "closed" };
  const c = { id: "c", status: "open" };
  const order = [a, b, c];

  describe("parsing", () => {
    it("reads the two states", () => {
      assert.equal(parseLotStateFilter("open"), "open");
      assert.equal(parseLotStateFilter("closed"), "closed");
    });

    it("drops anything else to both, which only ever widens the read", () => {
      for (const raw of [null, "", "both", "OPEN", "settled"]) {
        assert.equal(parseLotStateFilter(raw), undefined);
      }
    });
  });

  describe("which lots the by-lot view draws", () => {
    it("draws every lot with no state chosen", () => {
      assert.deepEqual(lotsInState(order, undefined), order);
    });

    it("draws the open lots alone, in the order's own order", () => {
      assert.deepEqual(lotsInState(order, "open"), [a, c]);
    });

    it("draws the closed lots alone", () => {
      assert.deepEqual(lotsInState(order, "closed"), [b]);
    });

    it("does not hand back the list it was given", () => {
      assert.notEqual(lotsInState(order, undefined), order);
    });
  });

  describe("a lot a link asked for", () => {
    it("is drawn even when the remembered state hides it, and nothing else is let through", () => {
      // A copy's *Go to purchase* on a closed lot, landing on an order remembered as *Open*: the
      // #1356 rule, shared with the auction sale.
      const { lots, exception } = withAskedForLot(order, lotsInState(order, "open"), "b");
      assert.deepEqual(lots, [a, b, c]);
      assert.equal(exception, b);
    });
  });
});
