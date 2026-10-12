import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  evaluateSoldElsewhereReadiness,
  isSetSoldElsewhere,
  needsActionRemedy,
  soldElsewhereRemoval,
  soldElsewhereRemovalLabel,
  soldElsewhereRemovalVia,
  soldElsewhereUpdateLabel,
} from "../../src/lib/offer-needs-action-remedy";
import {
  OFFER_STATES,
  flagsSoldElsewhere,
  isPreparedState,
} from "../../src/lib/offer-rules";

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

describe("isSetSoldElsewhere (#1804)", () => {
  const soldVia = new Map([
    ["a", "set-1"],
    ["b", "set-2"],
  ]);

  it("is a copy that left through another set's sale", () => {
    assert.equal(isSetSoldElsewhere({ id: "set-1", sold: false, itemIds: ["b"] }, soldVia), true);
  });

  it("is not a copy that left through this set's own sale", () => {
    assert.equal(isSetSoldElsewhere({ id: "set-1", sold: false, itemIds: ["a"] }, soldVia), false);
  });

  it("is never a set sold through this offer", () => {
    assert.equal(isSetSoldElsewhere({ id: "set-1", sold: true, itemIds: ["b"] }, soldVia), false);
  });

  it("is not a set none of whose copies has sold", () => {
    assert.equal(isSetSoldElsewhere({ id: "set-3", sold: false, itemIds: ["c"] }, soldVia), false);
  });
});

describe("soldElsewhereRemoval (#1805)", () => {
  it("removes every set sold elsewhere, and only those", () => {
    const a = { ...soldElsewhere, id: "a" };
    const b = { ...soldElsewhere, id: "b" };
    const plan = soldElsewhereRemoval([{ ...soldHere, id: "h" }, a, { ...forSale, id: "f" }, b]);
    assert.deepEqual(plan.remove.map((s) => s.id), ["a", "b"]);
    assert.equal(plan.leftToSell, 1);
  });

  it("counts a set in bidding elsewhere as still for sale", () => {
    const plan = soldElsewhereRemoval([soldElsewhere, biddingElsewhere]);
    assert.equal(plan.remove.length, 1);
    assert.equal(plan.leftToSell, 1);
  });

  it("leaves nothing to sell when the rest sold here", () => {
    const plan = soldElsewhereRemoval([soldHere, soldElsewhere]);
    assert.equal(plan.remove.length, 1);
    assert.equal(plan.leftToSell, 0);
  });

  it("has nothing to remove when no set sold elsewhere", () => {
    assert.equal(soldElsewhereRemoval([soldHere, forSale, biddingElsewhere]).remove.length, 0);
  });
});

describe("soldElsewhereRemovalLabel (#1805)", () => {
  it("names the count", () => {
    assert.equal(soldElsewhereRemovalLabel(1), "Remove 1 set sold elsewhere");
    assert.equal(soldElsewhereRemovalLabel(3), "Remove 3 sets sold elsewhere");
  });
});

describe("soldElsewhereRemovalVia (#1835)", () => {
  it("folds the removal into Update via Assistant on an active offer that has the update", () => {
    assert.equal(
      soldElsewhereRemovalVia({ state: "active", assistantUpdate: true, sets: [forSale, soldElsewhere] }),
      "update"
    );
  });

  it("keeps its own action where there is no Assistant update to fold it into", () => {
    assert.equal(
      soldElsewhereRemovalVia({ state: "active", assistantUpdate: false, sets: [forSale, soldElsewhere] }),
      "own"
    );
    for (const state of OFFER_STATES.filter((s) => s !== "active")) {
      assert.equal(
        soldElsewhereRemovalVia({ state, assistantUpdate: true, sets: [forSale, soldElsewhere] }),
        "own",
        state
      );
    }
  });

  it("offers nothing while no set has sold elsewhere", () => {
    assert.equal(
      soldElsewhereRemovalVia({ state: "active", assistantUpdate: true, sets: [forSale, soldHere] }),
      null
    );
    assert.equal(soldElsewhereRemovalVia({ state: "active", assistantUpdate: true, sets: [] }), null);
  });
});

describe("soldElsewhereUpdateLabel (#1835)", () => {
  it("counts the sets in the update's action", () => {
    assert.equal(soldElsewhereUpdateLabel(1), "Remove 1 set and update");
    assert.equal(soldElsewhereUpdateLabel(3), "Remove 3 sets and update");
  });
});

describe("evaluateSoldElsewhereReadiness (#1876)", () => {
  it("says nothing while no set has sold elsewhere", () => {
    assert.deepEqual(evaluateSoldElsewhereReadiness(0, "marking this offer ready"), []);
  });

  it("names the count, the refused step and the action that fixes it", () => {
    const [one] = evaluateSoldElsewhereReadiness(1, "marking this offer ready");
    assert.equal(one.code, "sets-sold-elsewhere");
    assert.equal(one.title, "1 set sold elsewhere");
    assert.equal(
      one.message,
      "1 set holds a copy already sold through another offer. Remove 1 set sold elsewhere before marking this offer ready."
    );
    const [two] = evaluateSoldElsewhereReadiness(2, "activating");
    assert.equal(two.title, "2 sets sold elsewhere");
    assert.equal(
      two.message,
      "2 sets hold a copy already sold through another offer. Remove 2 sets sold elsewhere before activating."
    );
  });
});

describe("the states a set sold elsewhere is flagged in (#1876)", () => {
  it("is the live states and the two an offer is prepared in, nothing else", () => {
    assert.deepEqual(
      OFFER_STATES.filter(isPreparedState),
      ["preparing", "ready"]
    );
    assert.deepEqual(
      [...OFFER_STATES.filter(flagsSoldElsewhere)].sort(),
      ["active", "pending", "preparing", "ready"]
    );
  });
});
