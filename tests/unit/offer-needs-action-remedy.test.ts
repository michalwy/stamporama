import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { needsActionRemedy } from "../../src/lib/offer-needs-action-remedy";
import { OFFER_STATES } from "../../src/lib/offer-rules";

const forSale = { sold: false, soldElsewhere: false, needsAction: false };
const soldHere = { sold: true, soldElsewhere: false, needsAction: false };
const soldElsewhere = { sold: false, soldElsewhere: true, needsAction: true };
const biddingElsewhere = { sold: false, soldElsewhere: false, needsAction: true };

const active = { state: "active" as const, needsAction: false, listingOutOfDate: false };

describe("needsActionRemedy (#1804)", () => {
  it("highlights Close when the last set left sold elsewhere", () => {
    assert.equal(
      needsActionRemedy({ ...active, needsAction: true, sets: [soldElsewhere] })?.action,
      "close"
    );
  });

  it("counts a set sold through this offer as gone too", () => {
    const remedy = needsActionRemedy({
      ...active,
      needsAction: true,
      sets: [soldHere, soldElsewhere],
    });
    assert.equal(remedy?.action, "close");
    assert.equal(remedy?.hint, "Last copy sold — close the listing");
  });

  it("highlights Close on an emptied listing", () => {
    assert.deepEqual(needsActionRemedy({ ...active, listingOutOfDate: true, sets: [] }), {
      action: "close",
      hint: "Nothing left in this listing — close it",
    });
    assert.equal(needsActionRemedy({ ...active, sets: [] })?.action, "close");
  });

  it("highlights Update while something is left to sell", () => {
    const remedy = needsActionRemedy({
      ...active,
      needsAction: true,
      sets: [soldElsewhere, forSale],
    });
    assert.equal(remedy?.action, "update");
    assert.equal(remedy?.hint, "Some copies sold elsewhere — update the listing");
  });

  it("does not count a copy in bidding elsewhere as sold", () => {
    const remedy = needsActionRemedy({ ...active, needsAction: true, sets: [biddingElsewhere] });
    assert.equal(remedy?.action, "update");
    assert.equal(remedy?.hint, "A copy is in bidding elsewhere — update the listing");
  });

  it("highlights Update on a listing out of step with nothing sold", () => {
    assert.deepEqual(needsActionRemedy({ ...active, listingOutOfDate: true, sets: [forSale] }), {
      action: "update",
      hint: "Listing out of step — update it",
    });
  });

  it("highlights nothing on an offer not flagged", () => {
    assert.equal(needsActionRemedy({ ...active, sets: [forSale, soldHere] }), null);
  });

  it("highlights nothing outside Active, where the pair is not offered", () => {
    for (const state of OFFER_STATES.filter((s) => s !== "active")) {
      assert.equal(
        needsActionRemedy({ state, needsAction: true, listingOutOfDate: true, sets: [soldElsewhere] }),
        null
      );
    }
  });
});
