import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  countTradeAttention,
  describeTradeAttention,
  firstTradeAttention,
  hasTradeLineSignals,
  indexTradeLineSignals,
  tradeAttentionSelector,
  tradeLineSignals,
  type TradeSignalSources,
} from "../../src/lib/trade-line-signals";
import type { TradeFeedbackItem } from "../../src/lib/trade-feedback";
import type { DepartedCopy, ListedCopy } from "../../src/lib/trade-reservation-rules";
import type { TradeLineRealisation } from "../../src/lib/trade-realisation";

// Every signal about a line, resolved to the line (#662). What matters here: a row asks once and
// gets one answer, a handled remark stays on its line rather than disappearing, the strip above
// counts *things to go and deal with* rather than rows in the reads, and the blocker leads the jump.

function feedbackItem(overrides: Partial<TradeFeedbackItem> = {}): TradeFeedbackItem {
  return {
    id: "f1",
    lineId: "l1",
    side: "give",
    sectionId: "s1",
    sectionName: "Mint",
    lineLabel: "Mi 1234",
    note: null,
    rejected: false,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    resolvedAt: null,
    resolution: null,
    ...overrides,
  };
}

function listed(itemId: string, offerNo = 14): ListedCopy {
  return {
    itemId,
    label: `Copy #${offerNo}`,
    offer: { offerId: `o${offerNo}`, offerNo, label: "Chopin block", platformName: "Delcampe" },
  };
}

function departed(itemId: string, reason: DepartedCopy["reason"] = "sold"): DepartedCopy {
  return { itemId, label: `Copy #${itemId}`, reason };
}

describe("indexTradeLineSignals", () => {
  it("puts a line's remark on that line and nothing on the others", () => {
    const index = indexTradeLineSignals({ feedback: { items: [feedbackItem()] } });
    assert.equal(tradeLineSignals(index, "l1", null).feedback?.id, "f1");
    assert.equal(tradeLineSignals(index, "l2", null).feedback, null);
  });

  it("keeps a handled remark on its line — it is still what the partner said", () => {
    const index = indexTradeLineSignals({
      feedback: {
        items: [feedbackItem({ resolvedAt: "2026-02-01T00:00:00.000Z", resolution: "dismissed" })],
      },
    });
    assert.equal(tradeLineSignals(index, "l1", null).feedback?.resolution, "dismissed");
  });

  it("leaves the note about the whole exchange off every row", () => {
    const index = indexTradeLineSignals({
      feedback: { items: [feedbackItem({ id: "f0", lineId: null, side: null })] },
    });
    assert.equal(index.feedbackByLine.size, 0);
  });

  it("collects every listing of one copy, and tells a copy's signals apart by side", () => {
    const index = indexTradeLineSignals({
      reservation: {
        listed: [listed("i1", 14), listed("i1", 15), listed("i2")],
        departed: [departed("i3", "disposed")],
      },
    });
    assert.equal(tradeLineSignals(index, "l1", "i1").listed.length, 2);
    assert.equal(tradeLineSignals(index, "l3", "i3").departed?.reason, "disposed");
    // A receive line names no copy, so nothing about one can be true of it.
    assert.equal(hasTradeLineSignals(tradeLineSignals(index, "l1", null)), false);
  });
});

describe("a substitution (#644)", () => {
  const substitution = {
    lineId: "l7",
    itemId: "i7",
    promisedStampId: "s1",
    arrivedStampId: "s2",
    promisedLabel: "Mi 401",
    arrivedLabel: "Mi 402",
  };

  it("lands on the line it is about, and makes that line worth marking", () => {
    const index = indexTradeLineSignals({ intake: { substitutions: [substitution] } });
    const signals = tradeLineSignals(index, "l7", null);
    assert.equal(signals.substituted?.arrivedLabel, "Mi 402");
    assert.ok(hasTradeLineSignals(signals));
    assert.equal(tradeLineSignals(index, "l8", null).substituted, null);
  });

  it("is one row to look at however many pieces came as something else", () => {
    const counts = countTradeAttention({
      intake: {
        substitutions: [substitution, { ...substitution, itemId: "i8", arrivedLabel: "Mi 403" }],
      },
    });
    assert.equal(counts.substituted, 1);
    assert.equal(describeTradeAttention(counts), "1 line came as something else");
  });
});

describe("countTradeAttention", () => {
  const sources: TradeSignalSources = {
    feedback: {
      items: [
        feedbackItem(),
        feedbackItem({ id: "f2", lineId: "l2" }),
        feedbackItem({ id: "f3", lineId: "l3", resolvedAt: "2026-02-01T00:00:00.000Z" }),
        feedbackItem({ id: "f0", lineId: null }),
      ],
    },
    reservation: { listed: [listed("i1", 14), listed("i1", 15)], departed: [departed("i9")] },
  };

  it("counts open line remarks only — handled ones and the trade's own note are not outstanding", () => {
    assert.equal(countTradeAttention(sources).remarks, 2);
  });

  it("counts copies rather than listings: two listings of one copy are one row to deal with", () => {
    assert.equal(countTradeAttention(sources).listed, 1);
  });

  it("reads out with the blocker first and says nothing when there is nothing to say", () => {
    assert.equal(
      describeTradeAttention(countTradeAttention(sources)),
      "1 copy listed elsewhere · 2 partner remarks · 1 promised copy gone"
    );
    assert.equal(describeTradeAttention(countTradeAttention({})), null);
  });
});

describe("firstTradeAttention", () => {
  it("leads with the collision, which is what blocks the agreement", () => {
    const target = firstTradeAttention({
      feedback: { items: [feedbackItem()] },
      reservation: { listed: [listed("i1")], departed: [departed("i9")] },
    });
    assert.deepEqual(target, { kind: "copy", itemId: "i1" });
    assert.equal(tradeAttentionSelector(target!), '[data-trade-copy="i1"]');
  });

  it("falls to the topmost open remark, then to a departure, then to nothing", () => {
    assert.deepEqual(
      firstTradeAttention({
        feedback: {
          items: [feedbackItem({ resolvedAt: "2026-02-01T00:00:00.000Z" }), feedbackItem({ id: "f2", lineId: "l2" })],
        },
        reservation: { listed: [], departed: [departed("i9")] },
      }),
      { kind: "line", lineId: "l2" }
    );
    assert.deepEqual(firstTradeAttention({ reservation: { listed: [], departed: [departed("i9")] } }), {
      kind: "copy",
      itemId: "i9",
    });
    assert.equal(firstTradeAttention({}), null);
  });
});

// ── The verdict, indexed like every other signal (#642) ─────────────────────────────────────────

function verdict(
  lineId: string,
  fulfillment: TradeLineRealisation["fulfillment"],
  note: string | null = null
): TradeLineRealisation {
  return { lineId, side: "give", fulfillment, note };
}

describe("the realisation index (#642)", () => {
  it("carries a verdict to the row it is about, on either side", () => {
    const index = indexTradeLineSignals({
      realisation: { lines: [verdict("l1", "withdrawn", "gum toned")] },
    });
    const signals = tradeLineSignals(index, "l1", null);
    assert.equal(signals.realisation?.fulfillment, "withdrawn");
    assert.equal(signals.realisation?.note, "gum toned");
    assert.equal(hasTradeLineSignals(signals), true);
  });

  it("says nothing about a line nobody has answered for", () => {
    // Every line of a freshly agreed trade is pending, and a mark on all of them would be a mark
    // that says nothing.
    const index = indexTradeLineSignals({ realisation: { lines: [verdict("l1", "pending")] } });
    const signals = tradeLineSignals(index, "l1", null);
    assert.equal(signals.realisation, null);
    assert.equal(hasTradeLineSignals(signals), false);
  });

  it("keeps a fulfilled line's mark — it is progress toward closing", () => {
    const index = indexTradeLineSignals({ realisation: { lines: [verdict("l1", "fulfilled")] } });
    assert.equal(tradeLineSignals(index, "l1", null).realisation?.fulfillment, "fulfilled");
  });

  it("is not a fourth kind of attention", () => {
    // What an unanswered line is outstanding *for* is closing, and that is stated as the closing
    // gate on the balance panel rather than counted in the strip above the columns.
    const sources: TradeSignalSources = {
      realisation: { lines: [verdict("l1", "pending"), verdict("l2", "withdrawn")] },
    };
    assert.equal(countTradeAttention(sources).total, 0);
    assert.equal(describeTradeAttention(countTradeAttention(sources)), null);
    assert.equal(firstTradeAttention(sources), null);
  });
});
