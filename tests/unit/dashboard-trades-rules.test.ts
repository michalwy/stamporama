import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  sortByStageAge,
  tradeShippingGroup,
  tradeShippingItem,
  tradeStageSince,
  type DashboardTrade,
} from "../../src/lib/dashboard-trades-rules";
import {
  agreedAtOnTransition,
  isTradeShippingStage,
  tradeShippingStage,
  TRADE_STATUSES,
} from "../../src/lib/trade-rules";
import {
  describeTradeBalanceShort,
  judgeTradeBalance,
  type TradeSideTotals,
} from "../../src/lib/trade-balance";

// The dashboard's Trades section (#1813): which agreed trades wait on a parcel, since when, and how
// a row says it. The reads are in `tests/integration/dashboard-trades.test.ts`.

describe("tradeShippingStage (#1813)", () => {
  it("puts an agreed trade not yet sent in To send, whatever the partner's parcel did", () => {
    assert.equal(tradeShippingStage("agreed", null, null), "to-send");
    assert.equal(tradeShippingStage("agreed", null, "2026-10-01"), "to-send");
  });

  it("puts a sent trade still missing the partner's parcel in Waiting for the partner", () => {
    assert.equal(tradeShippingStage("agreed", "2026-10-01", null), "awaiting-partner");
  });

  it("leaves out an agreed trade with both parcels accounted for — it waits on closing", () => {
    assert.equal(tradeShippingStage("agreed", "2026-10-01", "2026-10-05"), null);
  });

  it("leaves out every status but agreed", () => {
    for (const status of TRADE_STATUSES.filter((s) => s !== "agreed")) {
      assert.equal(tradeShippingStage(status, null, null), null, status);
    }
  });

  it("reads only its own spellings off a URL", () => {
    assert.equal(isTradeShippingStage("to-send"), true);
    assert.equal(isTradeShippingStage("awaiting-partner"), true);
    assert.equal(isTradeShippingStage("agreed"), false);
  });
});

describe("agreedAtOnTransition (#1813)", () => {
  const now = new Date("2026-10-11T12:00:00Z");

  it("stamps reaching agreed", () => {
    assert.equal(agreedAtOnTransition("agreed", now), now);
  });

  it("clears going back to a status the list can be edited in", () => {
    assert.equal(agreedAtOnTransition("shared", now), null);
    assert.equal(agreedAtOnTransition("preparing", now), null);
  });

  it("keeps the moment through closed and cancelled", () => {
    assert.equal(agreedAtOnTransition("closed", now), undefined);
    assert.equal(agreedAtOnTransition("cancelled", now), undefined);
  });
});

function trade(over: Partial<DashboardTrade> = {}): DashboardTrade {
  return {
    id: "t1",
    tradeNo: 1,
    partnerName: "Karel",
    agreedAt: "2026-10-01T00:00:00.000Z",
    sentAt: null,
    ...over,
  };
}

describe("dashboard Trades rows (#1813)", () => {
  it("measures To send from the agreement and Waiting from the parcel going out", () => {
    const t = trade({ sentAt: "2026-10-04T00:00:00.000Z" });
    assert.equal(tradeStageSince("to-send", t), "2026-10-01T00:00:00.000Z");
    assert.equal(tradeStageSince("awaiting-partner", t), "2026-10-04T00:00:00.000Z");
  });

  it("orders longest waiting first, an unknown moment before any known one, ties by number", () => {
    const rows = [
      trade({ id: "late", tradeNo: 1, agreedAt: "2026-10-09T00:00:00.000Z" }),
      trade({ id: "early-b", tradeNo: 5, agreedAt: "2026-10-02T00:00:00.000Z" }),
      trade({ id: "unknown", tradeNo: 9, agreedAt: null }),
      trade({ id: "early-a", tradeNo: 3, agreedAt: "2026-10-02T00:00:00.000Z" }),
    ];
    assert.deepEqual(
      sortByStageAge("to-send", rows).map((t) => t.id),
      ["unknown", "early-a", "early-b", "late"]
    );
  });

  it("names the partner, the number and the balance, and opens the trade", () => {
    const item = tradeShippingItem("to-send", trade({ id: "abc", tradeNo: 12 }), "I give 3 · I receive 4");
    assert.deepEqual(item, {
      key: "abc",
      label: "Karel",
      detail: "#12 · I give 3 · I receive 4",
      at: "2026-10-01T00:00:00.000Z",
      href: "trades/abc",
    });
  });

  it("opens each group on exactly its set of the trades list", () => {
    assert.equal(tradeShippingGroup("to-send", 0, []).href, "trades?shipping=to-send");
    const waiting = tradeShippingGroup("awaiting-partner", 3, []);
    assert.equal(waiting.title, "Waiting for the partner");
    assert.equal(waiting.count, 3);
    assert.equal(waiting.href, "trades?shipping=awaiting-partner");
  });
});

function side(over: Partial<TradeSideTotals>): TradeSideTotals {
  return {
    lines: 1,
    pieces: 1,
    own: 0,
    ownMissing: 0,
    ownUncertain: 0,
    ownManual: 0,
    agreed: 0,
    agreedMissing: 0,
    agreedUncertain: 0,
    agreedManual: 0,
    ...over,
  };
}

describe("describeTradeBalanceShort (#1813)", () => {
  const rule = { balanceByValue: false, countTolerance: 0, valueTolerancePct: 0, ownValueWarnPct: 25 };

  it("states pieces each way on a count trade", () => {
    const v = judgeTradeBalance(rule, side({ pieces: 12, agreed: 50 }), side({ pieces: 10 }));
    assert.equal(describeTradeBalanceShort(v, "EUR"), "I give 12 · I receive 10");
  });

  it("states the agreed figures each way on a value trade", () => {
    const v = judgeTradeBalance(
      { ...rule, balanceByValue: true },
      side({ pieces: 2, agreed: 120 }),
      side({ pieces: 5, agreed: 115.5 })
    );
    assert.equal(describeTradeBalanceShort(v, "CZK"), "I give 120.00 CZK · I receive 115.50 CZK");
  });

  it("falls back to pieces, and says so, when a value side is missing a figure", () => {
    const v = judgeTradeBalance(
      { ...rule, balanceByValue: true },
      side({ pieces: 2, agreed: 120 }),
      side({ pieces: 5, agreed: 100, agreedMissing: 1 })
    );
    assert.equal(describeTradeBalanceShort(v, "EUR"), "I give 2 · I receive 5 (not all valued)");
  });
});
