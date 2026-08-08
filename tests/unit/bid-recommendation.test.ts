import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DEFAULT_BID_CEILING_PERCENT,
  DEFAULT_BID_FALLBACK_PERCENT,
  DEFAULT_BID_FLOOR_PERCENT,
  MAX_BID_PERCENT,
  MIN_BID_PERCENT,
  parseBidPercent,
  recommendBid,
  type BidLine,
} from "../../src/lib/bid-recommendation";

const BAND = {
  bidFloorPercent: DEFAULT_BID_FLOOR_PERCENT,
  bidCeilingPercent: DEFAULT_BID_CEILING_PERCENT,
};

/** A market-anchored line, with the parts a test does not care about filled in. */
function line(anchor: number | null, overrides: Partial<BidLine> = {}): BidLine {
  return { quantity: 1, anchor, source: "market", unconvertible: false, ...overrides };
}

// The percentages a collection stores (#508) ---------------------------------

describe("bid percentage vocabulary", () => {
  it("defaults to a 75–125 band and a fallback that changes nothing", () => {
    assert.equal(DEFAULT_BID_FLOOR_PERCENT, 75);
    assert.equal(DEFAULT_BID_CEILING_PERCENT, 125);
    // 100 is the point: until a ratio has been learned, a catalogue anchor is the catalogue value
    // itself, which is exactly what the existing quick fill (#370) writes.
    assert.equal(DEFAULT_BID_FALLBACK_PERCENT, 100);
  });

  it("accepts positive whole percentages and nothing else", () => {
    assert.equal(parseBidPercent(75), 75);
    assert.equal(parseBidPercent("125"), 125);
    assert.equal(parseBidPercent(" 40 "), 40);
    assert.equal(parseBidPercent(MIN_BID_PERCENT), MIN_BID_PERCENT);
    assert.equal(parseBidPercent(MAX_BID_PERCENT), MAX_BID_PERCENT);

    assert.equal(parseBidPercent(0), null);
    assert.equal(parseBidPercent(-10), null);
    assert.equal(parseBidPercent(87.5), null);
    assert.equal(parseBidPercent(MAX_BID_PERCENT + 1), null);
    assert.equal(parseBidPercent(""), null);
    assert.equal(parseBidPercent(null), null);
    assert.equal(parseBidPercent("half"), null);
  });

  it("does not require the band to straddle the fair figure", () => {
    // "I only buy at 40–60% of what it is worth" is a trading style, not a mistake (ADR-0029 §4).
    const rec = recommendBid([line(100)], { bidFloorPercent: 40, bidCeilingPercent: 60 });
    assert.equal(rec.floor?.allIn, "40.00");
    assert.equal(rec.walkAway?.allIn, "60.00");
  });
});

// The recommendation ---------------------------------------------------------

describe("recommendBid", () => {
  it("answers nothing for a lot with no lines", () => {
    const rec = recommendBid([], BAND);
    assert.equal(rec.fair, null);
    assert.equal(rec.floor, null);
    assert.equal(rec.walkAway, null);
    assert.equal(rec.marketLines, 0);
    assert.equal(rec.catalogueLines, 0);
    assert.equal(rec.unanchoredLines, 0);
    assert.equal(rec.unconvertibleLines, 0);
  });

  it("is null, not zero, when no line could be anchored", () => {
    // A lot whose composition is entered but unpriceable is unanswered, not worthless — a 0.00
    // would make every headroom read as a catastrophic overbid.
    const rec = recommendBid([line(null), line(null)], BAND);
    assert.equal(rec.fair, null);
    assert.equal(rec.floor, null);
    assert.equal(rec.walkAway, null);
    assert.equal(rec.unanchoredLines, 2);
  });

  it("gives the three figures around the sum of the anchored lines", () => {
    const rec = recommendBid([line(30), line(10)], BAND);
    assert.equal(rec.fair?.allIn, "40.00");
    assert.equal(rec.floor?.allIn, "30.00");
    assert.equal(rec.walkAway?.allIn, "50.00");
  });

  it("counts anchored lines by which anchor they used", () => {
    const rec = recommendBid(
      [
        line(12),
        line(8, { source: "catalogue" }),
        line(5, { source: "catalogue" }),
        line(null),
        line(99, { unconvertible: true }),
      ],
      BAND
    );
    assert.equal(rec.marketLines, 1);
    assert.equal(rec.catalogueLines, 2);
    assert.equal(rec.unanchoredLines, 1);
    assert.equal(rec.unconvertibleLines, 1);
    // The unconvertible line's 99 is not in the total, and neither is the unanchored one.
    assert.equal(rec.fair?.allIn, "25.00");
  });

  it("keeps an unconvertible line out of the total without calling it unpriced", () => {
    // It exists and cannot be summed. Filing it as unanchored would send the collector off to
    // enter a value that is already there.
    const rec = recommendBid([line(20), line(null, { unconvertible: true })], BAND);
    assert.equal(rec.unconvertibleLines, 1);
    assert.equal(rec.unanchoredLines, 0);
    assert.equal(rec.fair?.allIn, "20.00");
  });

  it("multiplies by quantity and nothing else", () => {
    // A block of four at quantity 2 is two blocks' worth of the block's own anchor (ADR-0020),
    // and a lot is the plain sum of its lines — no bulk discount (ADR-0029 §6).
    const rec = recommendBid([line(7.5, { quantity: 4 }), line(2, { quantity: 3 })], BAND);
    assert.equal(rec.fair?.allIn, "36.00");
    assert.equal(rec.floor?.allIn, "27.00");
    assert.equal(rec.walkAway?.allIn, "45.00");
  });

  it("treats a broken quantity as none of them rather than as one", () => {
    const rec = recommendBid([line(10, { quantity: 0 }), line(10, { quantity: -3 })], BAND);
    // Both lines are anchored — they contribute a figure of nothing, not no figure.
    assert.equal(rec.marketLines, 2);
    assert.equal(rec.unanchoredLines, 0);
    assert.equal(rec.fair?.allIn, "0.00");
  });

  it("shows the bid to type inside each figure, on the sale's per-lot fees", () => {
    const rec = recommendBid([line(100)], BAND, { premiumPercent: 20, premiumFixed: 1.5 });
    assert.equal(rec.fair?.allIn, "100.00");
    // (100 − 1.50) / 1.2 = 82.083…, rounded down so the all-in never passes the figure.
    assert.equal(rec.fair?.bid, "82.08");
    // (75 − 1.50) / 1.2 = 61.25
    assert.equal(rec.floor?.allIn, "75.00");
    assert.equal(rec.floor?.bid, "61.25");
    // (125 − 1.50) / 1.2 = 102.916…
    assert.equal(rec.walkAway?.allIn, "125.00");
    assert.equal(rec.walkAway?.bid, "102.91");
  });

  it("ignores the sale's shipping, as everywhere a single lot is costed", () => {
    const withShipping = recommendBid([line(100)], BAND, {
      premiumPercent: 20,
      premiumFixed: 1.5,
      shippingCost: 25,
    });
    const without = recommendBid([line(100)], BAND, { premiumPercent: 20, premiumFixed: 1.5 });
    assert.deepEqual(withShipping, without);
  });

  it("reports no bid when the fees alone eat the figure", () => {
    const rec = recommendBid([line(1)], BAND, { premiumFixed: 5 });
    assert.equal(rec.floor?.allIn, "0.75");
    // No hammer price produces that total, which is a real answer rather than a zero.
    assert.equal(rec.floor?.bid, null);
  });

  it("scales the band off the unrounded sum", () => {
    // The displayed fair figure is 10.00, but the band is a percentage of the 10.004 behind it —
    // rounding once, at the end, rather than compounding a cent of display rounding into the
    // figures the bidding is actually done against.
    const rec = recommendBid([line(10.004)], { bidFloorPercent: 100, bidCeilingPercent: 1000 });
    assert.equal(rec.fair?.allIn, "10.00");
    assert.equal(rec.walkAway?.allIn, "100.04");
  });
});
