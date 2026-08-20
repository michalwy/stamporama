import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  TRADE_STATUSES,
  TRADE_STATUS_TRANSITIONS,
  canTransitionTrade,
  isTradeContentEditable,
  isTradeStatus,
  isTradeSide,
  resolveBalanceRule,
  describeBalanceRule,
  isTradeShippingComplete,
  type TradeBalanceRule,
} from "../../src/lib/trade-rules";

// The pure half of the trade module (#646; ADR-0039). What matters here: the lifecycle cannot be
// stepped sideways, an agreed list is locked, and a section's balance rule is inherited **whole** or
// stated **whole** — never half of each.

describe("trade lifecycle (#646)", () => {
  it("moves forwards along the line", () => {
    assert.ok(canTransitionTrade("preparing", "shared"));
    assert.ok(canTransitionTrade("shared", "agreed"));
    assert.ok(canTransitionTrade("agreed", "closed"));
  });

  it("allows one step back while nothing is settled", () => {
    assert.ok(canTransitionTrade("shared", "preparing"));
    assert.ok(canTransitionTrade("agreed", "shared"));
  });

  it("refuses a jump over a stage", () => {
    assert.equal(canTransitionTrade("preparing", "agreed"), false);
    assert.equal(canTransitionTrade("preparing", "closed"), false);
    assert.equal(canTransitionTrade("shared", "closed"), false);
  });

  it("can be cancelled from any live status, and revived to preparing", () => {
    assert.ok(canTransitionTrade("preparing", "cancelled"));
    assert.ok(canTransitionTrade("shared", "cancelled"));
    assert.ok(canTransitionTrade("agreed", "cancelled"));
    assert.ok(canTransitionTrade("cancelled", "preparing"));
  });

  it("leaves nothing after closed — un-closing is #644's decision, not this table's", () => {
    assert.deepEqual(TRADE_STATUS_TRANSITIONS.closed, []);
    assert.equal(canTransitionTrade("closed", "agreed"), false);
    assert.equal(canTransitionTrade("closed", "cancelled"), false);
  });

  it("never lists a status that is not one, and never lists itself", () => {
    for (const from of TRADE_STATUSES) {
      for (const to of TRADE_STATUS_TRANSITIONS[from]) {
        assert.ok(isTradeStatus(to), `${to} is not a status`);
        assert.notEqual(to, from, `${from} lists itself`);
      }
    }
  });

  it("locks the list once the partner is holding a copy of it", () => {
    assert.ok(isTradeContentEditable("preparing"));
    assert.ok(isTradeContentEditable("shared"));
    assert.equal(isTradeContentEditable("agreed"), false);
    assert.equal(isTradeContentEditable("closed"), false);
    assert.equal(isTradeContentEditable("cancelled"), false);
  });
});

describe("trade sides (#646)", () => {
  it("knows its two, and nothing else", () => {
    assert.ok(isTradeSide("give"));
    assert.ok(isTradeSide("receive"));
    assert.equal(isTradeSide("both"), false);
    assert.equal(isTradeSide(""), false);
  });
});

const tradeRule: TradeBalanceRule = {
  balanceByValue: false,
  countTolerance: 2,
  valueTolerancePct: 0,
  ownValueWarnPct: 25,
};

describe("resolveBalanceRule (#646/#638)", () => {
  it("with no section at all, the trade's own rule is what the whole is judged against", () => {
    assert.deepEqual(resolveBalanceRule(tradeRule, null), { ...tradeRule, inherited: true });
  });

  it("inherits the rule **whole** when the section states none", () => {
    const resolved = resolveBalanceRule(tradeRule, {
      balanceByValue: null,
      // Left over from an override that was cleared: still ignored, because `balanceByValue` is
      // what says whether this section states a rule at all.
      countTolerance: 99,
      valueTolerancePct: 99,
      ownValueWarnPct: 99,
    });
    assert.deepEqual(resolved, { ...tradeRule, inherited: true });
  });

  it("takes the section's rule whole when it states one", () => {
    assert.deepEqual(
      resolveBalanceRule(tradeRule, {
        balanceByValue: true,
        countTolerance: 0,
        valueTolerancePct: 5,
        ownValueWarnPct: 40,
      }),
      {
        balanceByValue: true,
        countTolerance: 0,
        valueTolerancePct: 5,
        ownValueWarnPct: 40,
        inherited: false,
      }
    );
  });

  it("falls back to the trade's skew warning only, which is the collector's own guard", () => {
    // A section may state how it is *balanced* without restating what counts as giving too much
    // away — that threshold is about the collector, not about the negotiation.
    const resolved = resolveBalanceRule(tradeRule, {
      balanceByValue: true,
      countTolerance: null,
      valueTolerancePct: 10,
      ownValueWarnPct: null,
    });
    assert.equal(resolved.ownValueWarnPct, 25);
    assert.equal(resolved.inherited, false);
  });
});

describe("describeBalanceRule (#646)", () => {
  it("says the mode and its tolerance as one fact", () => {
    assert.equal(describeBalanceRule(tradeRule), "By count ±2");
    assert.equal(describeBalanceRule({ ...tradeRule, countTolerance: 0 }), "By count");
    assert.equal(
      describeBalanceRule({ ...tradeRule, balanceByValue: true, valueTolerancePct: 5 }),
      "By value ±5%"
    );
    assert.equal(
      describeBalanceRule({ ...tradeRule, balanceByValue: true, valueTolerancePct: 0 }),
      "By value"
    );
  });

  it("does not print the trailing zeros a DECIMAL column carries", () => {
    assert.equal(
      describeBalanceRule({ ...tradeRule, balanceByValue: true, valueTolerancePct: 5.0 }),
      "By value ±5%"
    );
    assert.equal(
      describeBalanceRule({ ...tradeRule, balanceByValue: true, valueTolerancePct: 2.5 }),
      "By value ±2.5%"
    );
  });
});

describe("shipping (#646)", () => {
  it("is complete only when both parcels are accounted for, in either order", () => {
    const now = new Date();
    assert.equal(isTradeShippingComplete(null, null), false);
    assert.equal(isTradeShippingComplete(now, null), false);
    assert.equal(isTradeShippingComplete(null, now), false);
    assert.ok(isTradeShippingComplete(now, now));
  });
});
