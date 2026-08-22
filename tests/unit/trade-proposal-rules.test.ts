import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  canProposeTradeCopy,
  describeTradeProposalClosed,
  tradeProposalActionLabels,
  tradeProposalBanner,
  tradeProposalHint,
  tradeProposalOptionLabel,
  tradeProposalPrompt,
  tradeProposalUnansweredNote,
  TRADE_PROPOSAL_ALREADY_TAKEN,
  TRADE_PROPOSAL_NOT_OFFERED,
} from "../../src/lib/trade-proposal-rules";
import { TRADE_STATUSES } from "../../src/lib/trade-rules";

// The partner's pick of which copy they receive (#658) — the window, and the words it is spoken
// about in on both sides of the link.
//
// The load-bearing test is the first block. A pick is an answer to a list that has been **handed
// over**, so the window is `shared` and nothing else: before it the collector is still composing,
// and from `agreed` on the list is locked for both sides and a suggestion nobody answered is closed
// out with the trade.

describe("canProposeTradeCopy", () => {
  it("takes a pick while the list is shared", () => {
    assert.equal(canProposeTradeCopy("shared"), true);
  });

  it("takes one in no other status — narrower than the pool's own window and than feedback's", () => {
    for (const status of TRADE_STATUSES) {
      if (status === "shared") continue;
      assert.equal(canProposeTradeCopy(status), false, status);
    }
  });

  it("says why it is closed, differently before and after the negotiation", () => {
    assert.match(describeTradeProposalClosed("preparing"), /still being put together/);
    assert.match(describeTradeProposalClosed("agreed"), /agreed/);
    assert.match(describeTradeProposalClosed("closed"), /closed/);
  });
});

describe("what the partner reads", () => {
  it("asks the question with the number of copies in it", () => {
    assert.equal(tradeProposalPrompt(2), "Two of these would do — which would you like?");
    assert.match(tradeProposalPrompt(4), /^4 of these/);
  });

  it("names a copy by its place in the choice and by nothing the collection knows it by", () => {
    assert.equal(tradeProposalOptionLabel(0), "Copy 1");
    assert.equal(tradeProposalOptionLabel(2), "Copy 3");
  });

  it("tells a partner what became of a request nobody answered", () => {
    assert.match(tradeProposalUnansweredNote("agreed"), /asked for a different copy/);
    assert.match(tradeProposalUnansweredNote("agreed"), /agreed/);
  });
});

describe("what the collector reads", () => {
  it("names the copy in the hover, and points at the one screen it can be looked at on", () => {
    const hint = tradeProposalHint("Copy #12");
    assert.match(hint, /Copy #12/);
    assert.match(hint, /alternatives/);
  });

  it("states the request over the copies it is about, and that granting it moves no figure", () => {
    const banner = tradeProposalBanner("Copy #12");
    assert.match(banner, /Copy #12/);
    assert.match(banner, /no figure/);
  });

  it("names the two answers after what they do", () => {
    const labels = tradeProposalActionLabels("Copy #12");
    assert.equal(labels.accept, "Send Copy #12 instead");
    assert.match(labels.dismiss, /Keep/);
  });
});

describe("refusals", () => {
  it("has one sentence for a copy that is not on offer and one for a copy already asked for", () => {
    assert.notEqual(TRADE_PROPOSAL_NOT_OFFERED, TRADE_PROPOSAL_ALREADY_TAKEN);
    assert.match(TRADE_PROPOSAL_ALREADY_TAKEN, /another line/);
  });
});
