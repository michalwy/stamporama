import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  describeLines,
  judgeTradeBalance,
  skewPct,
  summariseTradeSide,
  tradeGateBlockers,
  unvaluedAgreedLines,
  unvaluedLines,
  type TradeLineValue,
} from "../../src/lib/trade-balance";
import type { TradeBalanceRule } from "../../src/lib/trade-rules";

// The balancing arithmetic (#638; ADR-0039 §7). What matters here: the two valuations are summed
// apart and never added together, a missing figure is counted rather than assumed to be zero, an
// unknown-variant estimate still counts as a value, and the own-value skew warns without ever
// blocking.

const RULE: TradeBalanceRule = {
  balanceByValue: false,
  countTolerance: 0,
  valueTolerancePct: 0,
  ownValueWarnPct: 25,
};

function line(over: Partial<TradeLineValue> = {}): TradeLineValue {
  return {
    lineId: "l1",
    sectionId: "s1",
    side: "give",
    quantity: 1,
    label: "#00001 Chopin (MNH)",
    own: 10,
    ownUncertain: false,
    ownManual: false,
    agreed: 12,
    agreedUncertain: false,
    agreedManual: false,
    ...over,
  };
}

describe("summariseTradeSide", () => {
  it("counts pieces, not lines — three lines can be thirty stamps", () => {
    const totals = summariseTradeSide([
      line({ lineId: "a", side: "receive", quantity: 10 }),
      line({ lineId: "b", side: "receive", quantity: 20 }),
    ]);
    assert.equal(totals.lines, 2);
    assert.equal(totals.pieces, 30);
    assert.equal(totals.own, 300);
  });

  it("counts a missing figure rather than folding it in as a zero", () => {
    const totals = summariseTradeSide([line({ lineId: "a" }), line({ lineId: "b", own: null })]);
    assert.equal(totals.own, 10);
    assert.equal(totals.ownMissing, 1);
  });

  it("keeps the two valuations apart — different currencies, never one sum", () => {
    const totals = summariseTradeSide([line({ own: 10, agreed: 45 })]);
    assert.equal(totals.own, 10);
    assert.equal(totals.agreed, 45);
  });

  it("reports the estimates and the collector's own figures it is resting on", () => {
    const totals = summariseTradeSide([
      line({ lineId: "a", ownUncertain: true }),
      line({ lineId: "b", ownManual: true }),
    ]);
    assert.equal(totals.ownUncertain, 1);
    assert.equal(totals.ownManual, 1);
    assert.equal(totals.ownMissing, 0);
  });
});

describe("skewPct", () => {
  it("measures against the larger side and is symmetric", () => {
    assert.equal(skewPct(100, 80), 20);
    assert.equal(skewPct(80, 100), 20);
  });

  it("calls two zeroes zero apart rather than dividing by one", () => {
    assert.equal(skewPct(0, 0), 0);
  });
});

describe("judgeTradeBalance — count mode", () => {
  it("balances on pieces within the tolerance", () => {
    const give = summariseTradeSide([line({ lineId: "a" }), line({ lineId: "b" })]);
    const receive = summariseTradeSide([line({ lineId: "c", side: "receive", quantity: 3 })]);
    const strict = judgeTradeBalance(RULE, give, receive);
    assert.equal(strict.countDiff, -1);
    assert.equal(strict.countBalanced, false);
    const loose = judgeTradeBalance({ ...RULE, countTolerance: 2 }, give, receive);
    assert.equal(loose.countBalanced, true);
  });
});

describe("judgeTradeBalance — value mode", () => {
  const rule: TradeBalanceRule = { ...RULE, balanceByValue: true, valueTolerancePct: 5 };

  it("balances on the agreed figures, in percent", () => {
    const give = summariseTradeSide([line({ lineId: "a", agreed: 100 })]);
    const receive = summariseTradeSide([line({ lineId: "b", side: "receive", agreed: 97 })]);
    const verdict = judgeTradeBalance(rule, give, receive);
    assert.equal(verdict.valueDiff, 3);
    assert.equal(verdict.valuePct, 3);
    assert.equal(verdict.valueBalanced, true);
  });

  it("refuses to call an incomplete side balanced", () => {
    const give = summariseTradeSide([line({ lineId: "a", agreed: 100 })]);
    const receive = summariseTradeSide([
      line({ lineId: "b", side: "receive", agreed: 100 }),
      line({ lineId: "c", side: "receive", agreed: null }),
    ]);
    const verdict = judgeTradeBalance(rule, give, receive);
    assert.equal(verdict.valueComplete, false);
    assert.equal(verdict.valueBalanced, false);
  });
});

describe("the own-value skew", () => {
  it("is computed in count mode too — a piece-count trade can be just as lopsided", () => {
    const give = summariseTradeSide([line({ lineId: "a", own: 1000 })]);
    const receive = summariseTradeSide([line({ lineId: "b", side: "receive", own: 10 })]);
    const verdict = judgeTradeBalance(RULE, give, receive);
    assert.equal(verdict.byValue, false);
    assert.equal(verdict.ownDiff, 990);
    assert.equal(verdict.ownWarn, true);
  });

  it("warns without ever blocking — the count verdict is untouched by it", () => {
    const give = summariseTradeSide([line({ lineId: "a", own: 1000 })]);
    const receive = summariseTradeSide([line({ lineId: "b", side: "receive", own: 10 })]);
    const verdict = judgeTradeBalance(RULE, give, receive);
    assert.equal(verdict.countBalanced, true);
    assert.equal(verdict.ownWarn, true);
  });

  it("stays quiet inside the threshold", () => {
    const give = summariseTradeSide([line({ lineId: "a", own: 100 })]);
    const receive = summariseTradeSide([line({ lineId: "b", side: "receive", own: 90 })]);
    assert.equal(judgeTradeBalance(RULE, give, receive).ownWarn, false);
  });
});

describe("the gates", () => {
  it("names an unvalued line rather than counting it", () => {
    const values = [line({ lineId: "a" }), line({ lineId: "b", own: null, label: "#00002 Kościuszko (MNH)" })];
    const blockers = tradeGateBlockers(values, new Set(), true);
    assert.equal(blockers.length, 1);
    assert.equal(blockers[0].kind, "own-unvalued");
    assert.match(blockers[0].message, /#00002 Kościuszko \(MNH\)/);
  });

  it("counts an unknown-variant estimate as a value", () => {
    const values = [line({ own: 4, ownUncertain: true })];
    assert.equal(unvaluedLines(values).length, 0);
    assert.equal(tradeGateBlockers(values, new Set(), true).length, 0);
  });

  it("counts the collector's own manual figure as a value", () => {
    const values = [line({ own: 4, ownManual: true })];
    assert.equal(tradeGateBlockers(values, new Set(), true).length, 0);
  });

  it("asks for the agreed figure only where value balancing decides", () => {
    const values = [
      line({ lineId: "a", sectionId: "byValue", agreed: null }),
      line({ lineId: "b", sectionId: "byCount", agreed: null }),
    ];
    assert.equal(unvaluedAgreedLines(values, new Set()).length, 0);
    const covered = unvaluedAgreedLines(values, new Set(["byValue"]));
    assert.deepEqual(covered.map((l) => l.lineId), ["a"]);
  });

  it("raises both gaps at once so one fix does not uncover the next", () => {
    const values = [line({ sectionId: "byValue", own: null, agreed: null })];
    const kinds = tradeGateBlockers(values, new Set(["byValue"]), true).map((b) => b.kind);
    assert.deepEqual(kinds, ["own-unvalued", "agreed-unvalued"]);
  });

  it("refuses a value-balanced trade that names no catalogue as one fault, not forty", () => {
    const values = [line({ sectionId: "byValue", agreed: null }), line({ lineId: "b", sectionId: "byValue", agreed: null })];
    const blockers = tradeGateBlockers(values, new Set(["byValue"]), false);
    assert.deepEqual(blockers.map((b) => b.kind), ["agreed-no-catalog"]);
    assert.deepEqual(blockers[0].lines, []);
  });
});

describe("describeLines", () => {
  it("names a few and counts the rest", () => {
    const many = Array.from({ length: 8 }, (_, i) => line({ lineId: `l${i}`, label: `#${i}` }));
    assert.equal(describeLines(many), "#0, #1, #2, #3, #4, and 3 more");
  });
});
