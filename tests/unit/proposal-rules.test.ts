import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isProposalOpen,
  parseProposalLotPacking,
  parseProposalNo,
  proposalNewLotSets,
  proposalLotPrice,
  proposalLotRefusal,
  proposalLotsRefusal,
  proposalMoveRefusal,
  proposalRenumbersLots,
  proposalStatusAfter,
  proposalTakesLots,
  sentProposalLotRefusal,
  proposalStatusOf,
  proposalTotal,
  proposalConversionRefusal,
  proposalLotCurrency,
  proposalSaleLotNote,
  proposalSaleLotRefusal,
  proposalSaleTargetRefusal,
  proposalSaleTotals,
  type ProposalTotalLot,
} from "../../src/lib/proposal-rules";

// A proposal's rules (#2287; ADR-0075): its status, what may join it, and its total.

describe("proposal status (#2287)", () => {
  it("is open while preparing or sent, and closed once sold or declined", () => {
    assert.equal(isProposalOpen("preparing"), true);
    assert.equal(isProposalOpen("sent"), true);
    assert.equal(isProposalOpen("sold"), false);
    assert.equal(isProposalOpen("declined"), false);
  });

  it("reads an unknown stored status as Preparing", () => {
    assert.equal(proposalStatusOf("sent"), "sent");
    assert.equal(proposalStatusOf("lost"), "preparing");
  });

  it("is marked sent only from Preparing and only with a lot", () => {
    assert.equal(proposalMoveRefusal("preparing", "send", 2), null);
    assert.match(proposalMoveRefusal("preparing", "send", 0)!, /at least one lot/);
    assert.match(proposalMoveRefusal("sent", "send", 2)!, /already been sent/);
    assert.equal(proposalStatusAfter("send"), "sent");
  });

  it("is declined from either open status, and nothing moves a closed one", () => {
    assert.equal(proposalMoveRefusal("preparing", "decline", 0), null);
    assert.equal(proposalMoveRefusal("sent", "decline", 3), null);
    assert.equal(proposalStatusAfter("decline"), "declined");
    for (const status of ["sold", "declined"] as const) {
      assert.match(proposalMoveRefusal(status, "decline", 1)!, /does not change/);
      assert.match(proposalMoveRefusal(status, "send", 1)!, /does not change/);
      assert.match(proposalLotsRefusal(status)!, /do not change/);
    }
  });
});

describe("a sent proposal is fixed (#2307)", () => {
  it("takes lots and changes to them only while it is being prepared", () => {
    assert.equal(proposalTakesLots("preparing"), true);
    for (const status of ["sent", "sold", "declined"] as const) assert.equal(proposalTakesLots(status), false);
    assert.equal(proposalLotsRefusal("preparing"), null);
    assert.match(proposalLotsRefusal("sent")!, /has been sent .* Reopen it/);
  });

  it("is reopened only from Sent, back to Preparing", () => {
    assert.equal(proposalMoveRefusal("sent", "reopen", 1), null);
    assert.match(proposalMoveRefusal("preparing", "reopen", 1)!, /already being prepared/);
    for (const status of ["sold", "declined"] as const) {
      assert.match(proposalMoveRefusal(status, "reopen", 1)!, /does not change/);
    }
    assert.equal(proposalStatusAfter("reopen"), "preparing");
  });

  it("names the offer, its lot and the proposal when an edit of a sent lot is refused", () => {
    assert.equal(
      sentProposalLotRefusal({ offerNo: 2680, proposalNo: 4, lotNo: 3 }),
      "Offer #2680 is lot 3 of proposal #4, which has been sent — reopen the proposal to change it."
    );
    assert.match(sentProposalLotRefusal({ offerNo: 1, proposalNo: 4, lotNo: null }), /is a lot of proposal #4/);
  });

  it("renumbers the lots after one is taken out only before the buyer has been sent them", () => {
    assert.equal(proposalRenumbersLots("preparing", false), true);
    assert.equal(proposalRenumbersLots("preparing", true), false);
    assert.equal(proposalRenumbersLots("sent", true), false);
  });
});

describe("a proposal's lots (#2287)", () => {
  const fit = { offerNo: 7, onDirect: true, state: "ready" as const, proposalId: null };

  it("takes an open Direct offer in no proposal", () => {
    assert.equal(proposalLotRefusal(fit, "p1"), null);
    assert.equal(proposalLotRefusal({ ...fit, state: "active" }, "p1"), null);
  });

  it("refuses an offer elsewhere, closed, or already in a proposal, by its number", () => {
    assert.match(proposalLotRefusal({ ...fit, onDirect: false }, "p1")!, /Offer #7 is not on the Direct platform/);
    assert.match(proposalLotRefusal({ ...fit, state: "sold" }, "p1")!, /Offer #7 is sold/);
    assert.match(proposalLotRefusal({ ...fit, state: "withdrawn" }, "p1")!, /withdrawn/);
    assert.match(proposalLotRefusal({ ...fit, proposalId: "p1" }, "p1")!, /already a lot of this proposal/);
    assert.match(proposalLotRefusal({ ...fit, proposalId: "p2" }, "p1")!, /another proposal/);
  });
});

describe("a proposal's total (#2287)", () => {
  const lot = (over: Partial<ProposalTotalLot>): ProposalTotalLot => ({
    state: "ready",
    listingType: "fixed",
    price: "0.00",
    startingPrice: null,
    ...over,
  });

  it("states a quick buy at its price and an auction at its opening figure", () => {
    assert.equal(proposalLotPrice(lot({ price: "12.5" })), "12.50");
    assert.equal(proposalLotPrice(lot({ listingType: "auction", price: "0.00", startingPrice: "4.00" })), "4.00");
    assert.equal(proposalLotPrice(lot({})), null);
  });

  it("sums the lots not withdrawn, sold ones included, and counts the unpriced apart", () => {
    assert.deepEqual(
      proposalTotal([
        lot({ price: "10.10" }),
        lot({ state: "sold", price: "5.20" }),
        lot({ state: "withdrawn", price: "100.00" }),
        lot({}),
      ]),
      { total: "15.30", unpriced: 1 }
    );
    assert.deepEqual(proposalTotal([]), { total: "0.00", unpriced: 0 });
  });
});

describe("a proposal's address (#2287)", () => {
  it("reads a positive whole number and nothing else", () => {
    assert.equal(parseProposalNo("4"), 4);
    for (const raw of ["0", "-1", "4a", "", "1.5"]) assert.equal(parseProposalNo(raw), undefined);
  });
});

describe("a proposal becoming a sale (#2289)", () => {
  it("is refused once closed, and when nothing is ticked", () => {
    assert.equal(proposalConversionRefusal("preparing", 1), null);
    assert.equal(proposalConversionRefusal("sent", 2), null);
    assert.match(proposalConversionRefusal("sent", 0)!, /decline the proposal instead/);
    assert.match(proposalConversionRefusal("sold", 1)!, /sold — it does not change/);
    assert.match(proposalConversionRefusal("declined", 1)!, /declined — it does not change/);
  });

  it("sells a lot of this proposal that is open and has a set left, from any open state", () => {
    const lot = { offerNo: 7, state: "preparing" as const, inProposal: true, hasSetToSell: true };
    assert.equal(proposalSaleLotRefusal(lot), null);
    assert.equal(proposalSaleLotRefusal({ ...lot, state: "ready" }), null);
    assert.match(proposalSaleLotRefusal({ ...lot, inProposal: false })!, /Offer #7 is not a lot of this proposal/);
    assert.match(proposalSaleLotRefusal({ ...lot, state: "withdrawn" })!, /Offer #7 is withdrawn/);
    assert.match(proposalSaleLotRefusal({ ...lot, state: "sold" })!, /Offer #7 is sold/);
    assert.match(proposalSaleLotRefusal({ ...lot, hasSetToSell: false })!, /nothing left to sell/);
  });

  it("joins the contact's sale not yet sent, in the lots' currency, on any platform", () => {
    const sale = { saleNo: 12, buyerId: "c1", sent: false, currency: "PLN" };
    assert.equal(proposalSaleTargetRefusal(sale, "c1", "PLN"), null);
    assert.match(proposalSaleTargetRefusal({ ...sale, buyerId: "c2" }, "c1", "PLN")!, /Sale #12 is not this contact's/);
    assert.match(proposalSaleTargetRefusal({ ...sale, buyerId: null }, "c1", "PLN")!, /not this contact's/);
    assert.match(proposalSaleTargetRefusal({ ...sale, sent: true }, "c1", "PLN")!, /already been sent/);
    assert.match(
      proposalSaleTargetRefusal({ ...sale, currency: "EUR" }, "c1", "PLN")!,
      /Sale #12 is in EUR, but the lots are in PLN/
    );
  });

  it("takes the one currency the ticked lots share, and refuses a mix", () => {
    assert.deepEqual(proposalLotCurrency(["PLN", "PLN"]), { ok: true, currency: "PLN" });
    const mixed = proposalLotCurrency(["PLN", "EUR", "PLN"]);
    assert.equal(mixed.ok, false);
    assert.match(!mixed.ok ? mixed.message : "", /PLN and EUR/);
    assert.equal(proposalLotCurrency([]).ok, false);
  });
});

describe("the convert window's lots and footer (#2336)", () => {
  it("greys a lot sold already, withdrawn, or with nothing left to sell, saying why", () => {
    assert.equal(proposalSaleLotNote("sold", 0), "Already sold");
    assert.equal(proposalSaleLotNote("withdrawn", 1), "Withdrawn");
    assert.match(proposalSaleLotNote("ready", 0)!, /Nothing left to sell/);
    assert.equal(proposalSaleLotNote("preparing", 1), null);
    assert.equal(proposalSaleLotNote("active", 2), null);
  });

  it("sums the ticked lots — every set at the lot's price — and weighs them against their cost", () => {
    const totals = proposalSaleTotals([
      { price: "4.00", setsToSell: 2, copiesToSell: 2, costPrice: "1.50" },
      { price: "10", setsToSell: 1, copiesToSell: 3, costPrice: "12.00" },
    ]);
    assert.deepEqual(totals, {
      lots: 2,
      sets: 3,
      copies: 5,
      total: "18.00",
      cost: "15.00",
      costLots: 2,
      profit: { amount: "3.00", percent: 20 },
    });
  });

  it("weighs only the lots with a cost, and says a loss as a negative margin", () => {
    const totals = proposalSaleTotals([
      { price: "2.00", setsToSell: 1, copiesToSell: 1, costPrice: "5.00" },
      { price: "3.00", setsToSell: 1, copiesToSell: 1, costPrice: null },
    ]);
    assert.equal(totals.total, "5.00");
    assert.equal(totals.cost, "5.00");
    assert.equal(totals.costLots, 1);
    assert.deepEqual(totals.profit, { amount: "-3.00", percent: -60 });
  });

  it("has no total and no margin while a typed price is not one, and no cost when none is known", () => {
    const totals = proposalSaleTotals([
      { price: "", setsToSell: 1, copiesToSell: 1, costPrice: "1.00" },
      { price: "2.00", setsToSell: 1, copiesToSell: 1, costPrice: null },
    ]);
    assert.equal(totals.total, null);
    assert.equal(totals.profit, null);
    assert.equal(totals.cost, "1.00");
    assert.deepEqual(proposalSaleTotals([]), {
      lots: 0,
      sets: 0,
      copies: 0,
      total: "0.00",
      cost: null,
      costLots: 0,
      profit: null,
    });
  });
});

describe("new lots from copies (#2299)", () => {
  it("makes an offer of each copy, or one offer of one set holding them all", () => {
    assert.deepEqual(proposalNewLotSets(["a", "b", "c"], "each"), [[["a"]], [["b"]], [["c"]]]);
    assert.deepEqual(proposalNewLotSets(["a", "b", "c"], "together"), [[["a", "b", "c"]]]);
  });

  it("makes the same one offer of a single copy either way", () => {
    assert.deepEqual(proposalNewLotSets(["a"], "each"), [[["a"]]]);
    assert.deepEqual(proposalNewLotSets(["a"], "together"), [[["a"]]]);
  });

  it("counts a copy picked twice once, and makes nothing of nothing", () => {
    assert.deepEqual(proposalNewLotSets(["a", "b", "a"], "each"), [[["a"]], [["b"]]]);
    assert.deepEqual(proposalNewLotSets([], "together"), []);
  });

  it("reads only the two packings", () => {
    assert.equal(parseProposalLotPacking("each"), "each");
    assert.equal(parseProposalLotPacking("together"), "together");
    assert.equal(parseProposalLotPacking("perCopy"), null);
    assert.equal(parseProposalLotPacking(null), null);
  });
});
