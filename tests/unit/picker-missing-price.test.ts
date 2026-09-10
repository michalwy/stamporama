import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { priceValid, setsMissingPrice, missingPriceLabel } from "../../src/lib/picker-missing-price";

/**
 * **A picked set with no price says why** (#1080) — the far side of `picker-hidden-ticks.test.ts`.
 * There a submit acts on more than the collector can see; here it refuses to act because of
 * something the collector cannot see.
 *
 * The cases are written so that the two options the decision did **not** take come out differently
 * rather than merely worded differently. Option (b), surfacing invalid picked rows regardless of
 * the search, is a rendering choice and is not visible from here at all — which is itself the
 * argument for the split, since the arithmetic is the same either way and only the navigation
 * differs. Option (c), validating on pick, would make `setsMissingPrice` unreachable: it is aimed
 * at a state a tick cannot enter, because the price pre-fills from the offer's asking price. The
 * blank case below is the one that actually occurs, and it is a **cleared** field rather than an
 * unfilled one.
 */
describe("a picker's ticks that cannot be submitted (#1080)", () => {
  describe("priceValid", () => {
    it("accepts an ordinary price", () => {
      assert.equal(priceValid("12.50"), true);
    });

    it("accepts zero, because a set thrown in with another is a real line at nothing", () => {
      assert.equal(priceValid("0"), true);
      assert.equal(priceValid("0.00"), true);
    });

    it("rejects a blank field, which is a collector mid-edit rather than a price of nothing", () => {
      assert.equal(priceValid(""), false);
      assert.equal(priceValid("   "), false);
    });

    it("rejects a negative price and anything that is not a number", () => {
      assert.equal(priceValid("-1"), false);
      assert.equal(priceValid("abc"), false);
      assert.equal(priceValid("12,50"), false);
    });

    it("tolerates the whitespace a field hands back", () => {
      assert.equal(priceValid(" 12.50 "), true);
    });
  });

  describe("setsMissingPrice", () => {
    // Four ticked; the collector cleared two of them and then searched them away.
    const picks = [
      { offerSetId: "s1", price: "12.50" },
      { offerSetId: "s2", price: "" },
      { offerSetId: "s3", price: "0.00" },
      { offerSetId: "s4", price: "  " },
    ];

    it("names the sets that cannot be submitted, and only those", () => {
      assert.deepEqual(setsMissingPrice(picks), ["s2", "s4"]);
    });

    it("answers ids rather than a count, because the control has to show the rows", () => {
      // This is the whole objection to bare option (a): a number with no route to the rows. A
      // count-only helper could not drive the narrowing the decision landed on.
      const ids = setsMissingPrice(picks);
      assert.ok(Array.isArray(ids));
      assert.equal(new Set(ids).has("s2"), true);
    });

    it("is empty for a selection that can be submitted whole", () => {
      assert.deepEqual(setsMissingPrice([{ offerSetId: "s1", price: "1" }]), []);
    });

    it("is empty for an empty selection — nothing ticked is not the same as something invalid", () => {
      assert.deepEqual(setsMissingPrice([]), []);
    });

    it("is the same predicate the submit is gated on, so the two cannot disagree", () => {
      // A picker disabling its submit over a set its own control does not list is exactly the
      // failure one shared predicate exists to make impossible.
      const missing = setsMissingPrice(picks);
      assert.equal(
        picks.every((p) => priceValid(p.price)),
        missing.length === 0
      );
    });
  });

  describe("missingPriceLabel", () => {
    it("says nothing at all when nothing is missing", () => {
      assert.equal(missingPriceLabel(0), "");
      assert.equal(missingPriceLabel(-1), "");
    });

    it("agrees with itself in the singular", () => {
      assert.equal(missingPriceLabel(1), "1 picked set has no price");
    });

    it("counts in the plural", () => {
      assert.equal(missingPriceLabel(2), "2 picked sets have no price");
      assert.equal(missingPriceLabel(11), "11 picked sets have no price");
    });
  });
});
