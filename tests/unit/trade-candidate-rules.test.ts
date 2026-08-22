import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeBlockedPromise,
  describeClosedPool,
  describeLapsedCandidate,
  describeLockedSwap,
  TRADE_CANDIDATE_OFFER_HINT,
  TRADE_CANDIDATE_SEND_HINT,
  hasTradeCandidates,
  tradeCandidateHint,
  tradeCandidateKey,
  tradeCandidateLabel,
  NO_CANDIDATES,
  TRADE_CANDIDATE_AXES,
  type TradeCandidateSubject,
} from "../../src/lib/trade-candidate-rules";

// Interchangeable copies on a give line (#657) — the key, and the words the pool is spoken about in.
//
// The load-bearing test is the first block: the key matches on **all four** axes, because #638 values
// a line on exactly that key and a pool matched any wider would let a certified copy or a block of
// four take a single's place and silently rewrite a balance both sides had agreed.

function copy(over: Partial<TradeCandidateSubject> = {}): TradeCandidateSubject {
  return {
    stampId: "s1",
    conditionId: "c1",
    certificateStatusId: null,
    formatId: null,
    ...over,
  };
}

describe("tradeCandidateKey", () => {
  it("matches two copies that agree on all four axes", () => {
    assert.equal(tradeCandidateKey(copy()), tradeCandidateKey(copy()));
  });

  it("separates copies differing in stamp or condition", () => {
    assert.notEqual(tradeCandidateKey(copy()), tradeCandidateKey(copy({ stampId: "s2" })));
    assert.notEqual(tradeCandidateKey(copy()), tradeCandidateKey(copy({ conditionId: "c2" })));
  });

  it("separates a certified copy from an uncertified one", () => {
    // Not a nicety: a certificate is priced, so swapping one in would move the line's value.
    assert.notEqual(
      tradeCandidateKey(copy()),
      tradeCandidateKey(copy({ certificateStatusId: "cert" }))
    );
  });

  it("separates a block of four from a single", () => {
    // A null format **means single** (ADR-0032), so this is two values and not a value and a gap.
    assert.notEqual(tradeCandidateKey(copy()), tradeCandidateKey(copy({ formatId: "block4" })));
  });

  it("joins both optional axes — the key catalogue valuation is computed on", () => {
    assert.deepEqual(TRADE_CANDIDATE_AXES, { format: true, certificate: true });
  });
});

describe("hasTradeCandidates", () => {
  it("is false only when there is neither an alternative nor a held-back copy", () => {
    assert.equal(hasTradeCandidates(NO_CANDIDATES), false);
    assert.equal(hasTradeCandidates({ available: 1, blocked: 0 }), true);
    // A line whose only match is held back still has something to say: otherwise the decision that
    // emptied the pool would be unreachable.
    assert.equal(hasTradeCandidates({ available: 0, blocked: 2 }), true);
  });
});

describe("tradeCandidateLabel", () => {
  it("counts what the partner would be offered", () => {
    assert.equal(tradeCandidateLabel({ available: 1, blocked: 0 }), "1 alternative");
    assert.equal(tradeCandidateLabel({ available: 3, blocked: 1 }), "3 alternatives");
  });

  it("says held back when nothing is offered", () => {
    assert.equal(tradeCandidateLabel({ available: 0, blocked: 1 }), "1 held back");
    assert.equal(tradeCandidateLabel({ available: 0, blocked: 4 }), "4 held back");
  });
});

describe("tradeCandidateHint", () => {
  it("says why a swap is free of consequence", () => {
    const hint = tradeCandidateHint({ available: 2, blocked: 0 });
    assert.match(hint, /2 other copies/);
    assert.match(hint, /changes no figure/);
    // Nothing about held-back copies where there are none.
    assert.doesNotMatch(hint, /held/);
  });

  it("adds what the collector held back", () => {
    assert.match(tradeCandidateHint({ available: 2, blocked: 1 }), /One more matches/);
    assert.match(tradeCandidateHint({ available: 0, blocked: 3 }), /3 more match/);
  });
});

describe("the refusals", () => {
  it("names the copy that is the promise", () => {
    const refusal = describeBlockedPromise("Copy #12");
    assert.match(refusal, /^Copy #12 /);
    assert.match(refusal, /not an alternative to it/);
  });

  it("names the status the pool is closed by", () => {
    assert.match(describeClosedPool("Agreed"), /agreed trade/);
  });
});

// The wording a lapsed candidate is refused in (#658). The dialog that offers a swap is a moment old
// by the time it is clicked, so the refusal has to say **which copy** and what happened to it.

describe("describeLapsedCandidate", () => {
  it("names the copy first, and always says it cannot take the line", () => {
    for (const reason of ["sold", "gone", "not-in-hand", "promised", "held-back", "unknown"] as const) {
      const message = describeLapsedCandidate("Copy #12", reason);
      assert.match(message, /^Copy #12 /, reason);
      assert.match(message, /cannot take this line\.$/, reason);
    }
  });

  it("tells the sold copy apart from the one promised elsewhere", () => {
    assert.notEqual(
      describeLapsedCandidate("Copy #12", "sold"),
      describeLapsedCandidate("Copy #12", "promised")
    );
  });

  it("refuses a locked swap with the step that would unfreeze it, and not otherwise", () => {
    assert.match(describeLockedSwap("Agreed", true), /Step the trade back to shared/);
    assert.match(describeLockedSwap("Closed", false), /cannot be changed/);
  });

  it("says the two controls on a row apart — which one goes, and which may be asked for", () => {
    assert.notEqual(TRADE_CANDIDATE_SEND_HINT, TRADE_CANDIDATE_OFFER_HINT);
    assert.match(TRADE_CANDIDATE_SEND_HINT, /promises/);
    assert.match(TRADE_CANDIDATE_OFFER_HINT, /every other trade/);
  });
});
