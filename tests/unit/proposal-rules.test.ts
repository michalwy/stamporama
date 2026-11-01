import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  isProposalOpen,
  parseProposalNo,
  proposalLotPrice,
  proposalLotRefusal,
  proposalLotsRefusal,
  proposalMoveRefusal,
  proposalStatusAfter,
  proposalStatusOf,
  proposalTotal,
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
    assert.equal(proposalLotsRefusal("sent"), null);
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
