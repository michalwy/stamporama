import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  CLOSING_ANY_LABEL,
  CLOSING_WINDOWS,
  OUTCOME_ANY_LABEL,
  describeLotClosingFilter,
  describeLotOutcomeFilter,
  withCount,
} from "../../src/app/c/[collectionSlug]/auctions/lot-filter-labels";

/**
 * What the lots toolbar's two folded controls say at rest (#1070).
 *
 * The trigger is the whole of what a dropdown announces without being opened, and two of the three
 * things it has to announce are easy to lose. **Which dimension it is** — `Ended` on its own names
 * none of five controls, and the issue behind this change exists because a filter could not be
 * found. And **`Show closed`**, which used to be a chip that lit: it widens the list, so the band
 * under the toolbar deliberately never names it (#1018), leaving this trigger as the only place it
 * is stated at rest.
 */
describe("auction lot filter labels", () => {
  describe("the closing trigger", () => {
    it("names the dimension even with nothing picked", () => {
      assert.equal(describeLotClosingFilter(undefined), "Closing: any");
    });

    it("names the picked window", () => {
      assert.equal(describeLotClosingFilter("today"), "Closing: Today");
      assert.equal(describeLotClosingFilter("week"), "Closing: This week");
      assert.equal(describeLotClosingFilter("ended"), "Closing: Ended");
    });

    it("covers every window the control offers", () => {
      for (const { value, label } of CLOSING_WINDOWS) {
        assert.equal(describeLotClosingFilter(value), `Closing: ${label}`);
      }
    });
  });

  describe("the outcome trigger", () => {
    it("states Show closed while it is the only thing on", () => {
      assert.equal(describeLotOutcomeFilter(undefined, false), "Outcome: any");
      assert.equal(describeLotOutcomeFilter(undefined, true), "Outcome: any + closed");
    });

    it("names the picked outcome, and says nothing about a switch that has no say", () => {
      assert.equal(describeLotOutcomeFilter("won", false), "Outcome: Won");
      // Picking an outcome already asks for closed lots (#504), so the stored switch is not
      // reported — the panel draws it disabled for the same reason.
      assert.equal(describeLotOutcomeFilter("won", true), "Outcome: Won");
    });

    it("labels a pending lot the way the row does", () => {
      // `pending` reads as *Open* on this screen (`AUCTION_LOT_OUTCOME_LABEL`), and the trigger has
      // to agree with the option the collector picked.
      assert.equal(describeLotOutcomeFilter("pending", false), "Outcome: Open");
    });
  });

  describe("a counted option row", () => {
    it("spells the count the way the party selects already do (#1029)", () => {
      assert.equal(withCount(OUTCOME_ANY_LABEL, 143), "Any outcome (143)");
      assert.equal(withCount(CLOSING_ANY_LABEL, 0), "Any time (0)");
    });

    it("draws bare while the first count fetch is in flight", () => {
      // A zero here would be a claim, and the wrong one: `FilterChip` renders bare for the same
      // reason rather than flashing one.
      assert.equal(withCount("Ended", undefined), "Ended");
    });
  });

  describe("the two labels a closing window carries", () => {
    it("keeps the band's wording as the band already had it (#1018)", () => {
      // The band names a filter so it can be found and switched off; a bare *Today* among a run of
      // other filters says nothing about which control set it.
      const today = CLOSING_WINDOWS.find((w) => w.value === "today");
      assert.equal(today?.bandLabel, "Closing today");
      assert.notEqual(today?.label, today?.bandLabel);
    });

    it("gives every window both", () => {
      for (const w of CLOSING_WINDOWS) {
        assert.ok(w.label.length > 0);
        assert.ok(w.bandLabel.length > 0);
      }
    });
  });
});
