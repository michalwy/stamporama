import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allIn,
  bidStanding,
  headroom,
  lotHasSignal,
  lotNeedsComposition,
  lotOutcome,
  maxBidWithin,
  bidCosting,
  ceilingAllowing,
  settlementLinePrice,
  LOT_SIGNALS,
  summarizeAuctionSale,
  summarizeLotComposition,
  type AuctionLotSummaryRow,
  type LotLineValue,
} from "../../src/lib/auction-lot";

// allIn ---------------------------------------------------------------------

describe("allIn", () => {
  it("returns the bare bid when the seller charges nothing", () => {
    assert.equal(allIn("100"), "100.00");
    assert.equal(allIn(100, {}), "100.00");
  });

  it("applies the percentage premium", () => {
    assert.equal(allIn("100", { premiumPercent: "20" }), "120.00");
  });

  it("applies the fixed premium and shipping on top", () => {
    assert.equal(
      allIn("100", { premiumPercent: "20", premiumFixed: "2.50", shippingCost: "15" }),
      "137.50"
    );
  });

  it("charges the percentage on the hammer price only, never on the fixed fee or shipping", () => {
    // 100 + 20 + 5 + 10 — not 100 + 20% of 115.
    assert.equal(
      allIn("100", { premiumPercent: "20", premiumFixed: "5", shippingCost: "10" }),
      "135.00"
    );
  });

  it("rounds once at the end", () => {
    // 33.33 × 1.175 = 39.162750 — rounding the premium first would give 39.17.
    assert.equal(allIn("33.33", { premiumPercent: "17.5" }), "39.16");
  });

  it("treats a missing bid as no cost at all, not as zero", () => {
    assert.equal(allIn(null, { shippingCost: "15" }), null);
    assert.equal(allIn(undefined), null);
    assert.equal(allIn("  "), null);
  });

  it("treats an unrecorded fee as zero", () => {
    assert.equal(allIn("50", { premiumPercent: null, premiumFixed: undefined }), "50.00");
  });
});

// headroom ------------------------------------------------------------------

describe("headroom", () => {
  it("measures the catalogue value against the all-in cost, not the hammer price", () => {
    // 100 all-in is 135; a catalogue value of 200 leaves 65, not 100.
    assert.equal(
      headroom("200", "100", { premiumPercent: "20", premiumFixed: "5", shippingCost: "10" }),
      "65.00"
    );
  });

  it("goes negative once the bid has passed the catalogue value", () => {
    assert.equal(headroom("100", "120"), "-20.00");
  });

  it("is null when either side is unrecorded", () => {
    assert.equal(headroom(null, "100"), null);
    assert.equal(headroom("200", null), null);
  });

  it("is null rather than the catalogue value when nobody has bid yet", () => {
    assert.equal(headroom("200", undefined, { shippingCost: "15" }), null);
  });
});

// summarizeAuctionSale ------------------------------------------------------

const FEES = { premiumPercent: "20", premiumFixed: "1", shippingCost: "15" };

function lot(over: Partial<AuctionLotSummaryRow> = {}): AuctionLotSummaryRow {
  return { status: "open", currentBid: "100", catalogValue: "200", ...over };
}

/** A closed lot that derives to `won`: the result came in below the collector's own maximum. */
function wonLot(over: Partial<AuctionLotSummaryRow> = {}): AuctionLotSummaryRow {
  return lot({ status: "closed", myBid: "500", finalPrice: "100", ...over });
}

/** A closed lot that derives to `lost`: the result went past the maximum. */
function lostLot(over: Partial<AuctionLotSummaryRow> = {}): AuctionLotSummaryRow {
  return lot({ status: "closed", myBid: "50", finalPrice: "100", ...over });
}

/** A closed lot nobody bid on — tracked for the price alone. */
function observedLot(over: Partial<AuctionLotSummaryRow> = {}): AuctionLotSummaryRow {
  return lot({ status: "closed", myBid: null, finalPrice: "100", ...over });
}

describe("summarizeAuctionSale", () => {
  it("counts every lot by its derived outcome", () => {
    const s = summarizeAuctionSale([
      lot(),
      wonLot(),
      lostLot(),
      observedLot(),
      lot({ status: "cancelled" }),
    ]);
    assert.equal(s.lotCount, 5);
    assert.deepEqual(
      [s.pendingCount, s.wonCount, s.lostCount, s.observedCount, s.cancelledCount],
      [1, 1, 1, 1, 1]
    );
  });

  it("totals only the lots that cost money", () => {
    const s = summarizeAuctionSale(
      [lot(), wonLot(), lostLot(), observedLot(), lot({ status: "cancelled" })],
      FEES
    );
    assert.equal(s.payableCount, 2);
    assert.equal(s.bidTotal, "200.00");
    assert.equal(s.catalogTotal, "400.00");
  });

  it("charges shipping once for the parcel, and the premium per lot", () => {
    // Two lots at 100: 2 × (100 + 20 + 1) = 242, plus one shipping of 15.
    const s = summarizeAuctionSale([lot(), lot()], FEES);
    assert.equal(s.allInTotal, "257.00");
  });

  it("adds no shipping when nothing in the sale is payable", () => {
    const s = summarizeAuctionSale([lostLot()], FEES);
    assert.equal(s.payableCount, 0);
    assert.equal(s.allInTotal, "0.00");
    assert.equal(s.headroom, null);
  });

  it("prefers the settled price over the last observed bid", () => {
    const s = summarizeAuctionSale([wonLot({ currentBid: "100", finalPrice: "180" })]);
    assert.equal(s.bidTotal, "180.00");
  });

  it("falls back to the current bid on an open lot with no result yet", () => {
    const s = summarizeAuctionSale([lot({ currentBid: "100", finalPrice: null })]);
    assert.equal(s.bidTotal, "100.00");
  });

  it("flags payable lots that are missing a bid or a catalogue value", () => {
    const s = summarizeAuctionSale([
      lot(),
      lot({ currentBid: null }),
      lot({ catalogValue: null }),
      // A lost lot is not payable, so its gaps are nobody's business.
      lostLot({ currentBid: null, catalogValue: null }),
    ]);
    assert.equal(s.payableCount, 3);
    assert.equal(s.unbidCount, 1);
    assert.equal(s.unvaluedCount, 1);
    assert.equal(s.bidTotal, "200.00");
    assert.equal(s.catalogTotal, "400.00");
  });

  it("reports the parcel's headroom against its all-in cost", () => {
    // 400 catalogue − (242 premium-inclusive + 15 shipping).
    const s = summarizeAuctionSale([lot(), lot()], FEES);
    assert.equal(s.headroom, "143.00");
  });

  it("has no headroom when no payable lot carries both figures", () => {
    const s = summarizeAuctionSale([lot({ currentBid: null }), lot({ catalogValue: null })], FEES);
    assert.equal(s.headroom, null);
  });

  // Exposure (#523) — the budget question: what is owed if every proxy bid placed goes the whole
  // way, and what carrying the watchlist to its ceilings would cost.

  it("costs an open lot at the proxy maximum placed, not at what it stands at", () => {
    // 200 + 20% + 1 = 241, plus one shipping of 15. `currentBid` of 100 is an observation and says
    // nothing about what the collector is on the hook for.
    const s = summarizeAuctionSale([lot({ myBid: "200", currentBid: "100" })], FEES);
    assert.equal(s.committedTotal, "256.00");
  });

  it("commits nothing for an open lot with no bid placed", () => {
    // Shipping still lands, exactly as it does in `allInTotal` — the parcel is payable.
    const s = summarizeAuctionSale([lot({ myBid: null })], FEES);
    assert.equal(s.committedTotal, "15.00");
    assert.equal(s.ceilingTotal, "15.00");
    assert.equal(s.uncappedCount, 1);
  });

  it("takes the ceiling as it stands — it is an all-in figure already", () => {
    // 300 ceiling, not allIn(300) = 361: running the premium over it would charge it twice.
    const s = summarizeAuctionSale([lot({ myBid: "100", maxBid: "300" })], FEES);
    assert.equal(s.ceilingTotal, "315.00");
    assert.equal(s.committedTotal, "136.00");
  });

  it("keeps a bid placed past the ceiling in the ceiling total", () => {
    // Placed 200 (all-in 241) against a ceiling of 150 — the money at risk is the bid.
    const s = summarizeAuctionSale([lot({ myBid: "200", maxBid: "150" })], FEES);
    assert.equal(s.ceilingTotal, "256.00");
  });

  it("costs a won lot at what it fetched, in both totals", () => {
    // 100 + 20% + 1 = 121, plus shipping. A settled lot has no worst case left.
    const s = summarizeAuctionSale([wonLot({ finalPrice: "100", maxBid: "400" })], FEES);
    assert.equal(s.committedTotal, "136.00");
    assert.equal(s.ceilingTotal, "136.00");
    assert.equal(s.uncappedCount, 0);
  });

  it("leaves lost, observed and cancelled lots out of both totals", () => {
    const s = summarizeAuctionSale(
      [lostLot({ maxBid: "500" }), observedLot({ maxBid: "500" }), lot({ status: "cancelled", maxBid: "500" })],
      FEES
    );
    assert.equal(s.committedTotal, "0.00");
    assert.equal(s.ceilingTotal, "0.00");
    assert.equal(s.uncappedCount, 0);
  });

  it("charges shipping once across the parcel, and the premium per lot", () => {
    // Two ceilings of 200 → 400, plus one shipping of 15. A ceiling carries no premium.
    const s = summarizeAuctionSale([lot({ maxBid: "200" }), lot({ maxBid: "200" })], FEES);
    assert.equal(s.ceilingTotal, "415.00");
  });

  // Outpriced lots (#600) — the price has run past the ceiling, so nothing can come of the lot
  // until the ceiling is raised, and neither exposure figure should count it.

  it("leaves a lot the price has passed the ceiling out of both totals", () => {
    // Standing at 100, all-in 121, against a ceiling of 110 and no bid placed. Shipping still
    // lands, as it does whenever the parcel holds something payable.
    const s = summarizeAuctionSale([lot({ myBid: null, currentBid: "100", maxBid: "110" })], FEES);
    assert.equal(s.committedTotal, "15.00");
    assert.equal(s.ceilingTotal, "15.00");
    assert.equal(s.outpricedCount, 1);
    // Excluded from the totals, not from the parcel: it is still a lot that could be re-bid.
    assert.equal(s.payableCount, 1);
    assert.equal(s.uncappedCount, 0);
  });

  it("measures the price against the ceiling all-in, as the over-ceiling chip does", () => {
    // 100 is under a ceiling of 110 on its face; with the premium it costs 121, which is not. The
    // 90 placed is behind the price, so nothing here can still be won.
    const s = summarizeAuctionSale([lot({ myBid: "90", currentBid: "100", maxBid: "110" })], FEES);
    assert.equal(s.outpricedCount, 1);
    assert.equal(s.committedTotal, "15.00");
  });

  it("keeps a lot whose own bid still leads, even past the ceiling", () => {
    // Placed 200 against a ceiling of 110 and a price of 100: the lot can still be won at 200, so
    // that money is on the hook whatever the valuation says (`myBidOverCeiling`).
    const s = summarizeAuctionSale([lot({ myBid: "200", currentBid: "100", maxBid: "110" })], FEES);
    assert.equal(s.outpricedCount, 0);
    assert.equal(s.committedTotal, "256.00");
    assert.equal(s.ceilingTotal, "256.00");
  });

  it("keeps a lot with no ceiling recorded, whatever it stands at", () => {
    // Nothing has been passed: there is no ceiling to pass.
    const s = summarizeAuctionSale([lot({ myBid: "100", currentBid: "500", maxBid: null })], FEES);
    assert.equal(s.outpricedCount, 0);
    assert.equal(s.committedTotal, "136.00");
  });

  it("never calls a won lot outpriced", () => {
    // The lot is settled at 100 all-in 121; the ceiling of 110 it went past has nothing left to say.
    const s = summarizeAuctionSale([wonLot({ finalPrice: "100", maxBid: "110" })], FEES);
    assert.equal(s.outpricedCount, 0);
    assert.equal(s.committedTotal, "136.00");
  });

  it("is all zeroes for an empty sale", () => {
    const s = summarizeAuctionSale([], FEES);
    assert.deepEqual(
      [s.lotCount, s.payableCount, s.bidTotal, s.allInTotal, s.catalogTotal, s.headroom],
      [0, 0, "0.00", "0.00", "0.00", null]
    );
  });
});

// settlementLinePrice — what a won lot costs as a purchase line ---------------

describe("settlementLinePrice", () => {
  it("is the hammer price plus the seller's premium", () => {
    assert.equal(
      settlementLinePrice("100", { premiumPercent: "20", premiumFixed: "2.50" }),
      "122.50"
    );
  });

  it("never carries shipping, however the fees are passed", () => {
    // Shipping becomes `Purchase.shippingCost` and is distributed across the lines by
    // ADR-0009 §3; charging it here too would count it twice.
    assert.equal(settlementLinePrice("100", { premiumPercent: "20", shippingCost: "15" }), "120.00");
    assert.equal(settlementLinePrice("40", { shippingCost: "15" }), "40.00");
  });

  it("is null without a price", () => {
    assert.equal(settlementLinePrice(null, { premiumPercent: "20" }), null);
    assert.equal(settlementLinePrice("", {}), null);
  });
});

// maxBidWithin — the inverse of allIn ----------------------------------------

describe("maxBidWithin", () => {
  it("takes the fees back off the ceiling", () => {
    // 20% + 2 fixed: bidding 100 on a 100 ceiling would cost 122. 81.66 costs 99.99.
    assert.equal(maxBidWithin("100", { premiumPercent: "20", premiumFixed: "2" }), "81.66");
    assert.equal(allIn("81.66", { premiumPercent: "20", premiumFixed: "2" }), "99.99");
  });

  it("rounds down, never past the ceiling", () => {
    const bid = maxBidWithin("50", { premiumPercent: "17.5" })!;
    assert.ok(Number(allIn(bid, { premiumPercent: "17.5" })) <= 50);
  });

  it("is the ceiling itself when the seller charges nothing", () => {
    assert.equal(maxBidWithin("40"), "40.00");
  });

  it("counts shipping only when asked to", () => {
    assert.equal(maxBidWithin("100", { shippingCost: "15" }), "85.00");
    assert.equal(maxBidWithin("100", {}), "100.00");
  });

  it("has no answer without a ceiling, or when the fees alone eat it", () => {
    assert.equal(maxBidWithin(null), null);
    assert.equal(maxBidWithin(""), null);
    assert.equal(maxBidWithin("10", { premiumFixed: "10" }), null);
    assert.equal(maxBidWithin("10", { premiumFixed: "12" }), null);
  });
});

// bidCosting / ceilingAllowing — the two-sided columns' conversions -----------

describe("bidCosting", () => {
  const HOUSE = { premiumPercent: "20", premiumFixed: "1.50" };

  it("round-trips the total that was typed", () => {
    // The case that made this exist: `maxBidWithin` floors to 165.41, which costs 199.99 and shows
    // the collector a cent less than the figure they just stated.
    assert.equal(maxBidWithin("200", HOUSE), "165.41");
    assert.equal(allIn("165.41", HOUSE), "199.99");

    const bid = bidCosting("200", HOUSE)!;
    assert.equal(bid, "165.42");
    assert.equal(allIn(bid, HOUSE), "200.00");
  });

  it("is the total itself when the seller charges nothing", () => {
    assert.equal(bidCosting("40"), "40.00");
  });

  it("counts shipping only when asked to", () => {
    assert.equal(bidCosting("100", { shippingCost: "15" }), "85.00");
  });

  it("has no answer without a total, or when the fees alone exceed it", () => {
    assert.equal(bidCosting(null), null);
    assert.equal(bidCosting(""), null);
    assert.equal(bidCosting("10", { premiumFixed: "10" }), null);
    assert.equal(bidCosting("10", { premiumFixed: "12" }), null);
  });
});

describe("ceilingAllowing", () => {
  const HOUSE = { premiumPercent: "20", premiumFixed: "1.50" };

  it("leaves the typed bid still placeable", () => {
    // Rounding to nearest would store 199.99, and `maxBidWithin` would then hand back 165.40 — one
    // cent under the bid the collector asked to be able to place.
    const ceiling = ceilingAllowing("165.41", HOUSE)!;
    assert.equal(ceiling, "200.00");
    assert.ok(Number(maxBidWithin(ceiling, HOUSE)) >= 165.41);
  });

  it("does not push a whole-cent cost up to the next cent", () => {
    assert.equal(ceilingAllowing("40", HOUSE), "49.50");
    assert.equal(maxBidWithin("49.50", HOUSE), "40.00");
    assert.equal(ceilingAllowing("40"), "40.00");
  });

  it("has no answer without a bid", () => {
    assert.equal(ceilingAllowing(null), null);
    assert.equal(ceilingAllowing(""), null);
  });
});

// bidStanding — derived, never stored ----------------------------------------

describe("bidStanding", () => {
  it("reports leading while the placed bid still covers the price", () => {
    assert.equal(bidStanding("50", "40"), "leading");
    // A tie goes to the bid already placed.
    assert.equal(bidStanding("50", "50"), "leading");
  });

  it("reports outbid once the price has passed it", () => {
    assert.equal(bidStanding("50", "55"), "outbid");
  });

  it("answers nothing when either figure is missing", () => {
    assert.equal(bidStanding(null, "40"), null);
    assert.equal(bidStanding("40", null), null);
    assert.equal(bidStanding(null, null), null);
  });
});

// lotHasSignal — the derived states the toolbar filters by ----------------------

describe("lotHasSignal", () => {
  const now = new Date("2026-07-28T12:00:00.000Z");
  const later = new Date(now.getTime() + 24 * 60 * 60 * 1000);
  const earlier = new Date(now.getTime() - 60 * 60 * 1000);
  const fees = { premiumPercent: "10", premiumFixed: "2" };

  const live = (over: Partial<Parameters<typeof lotHasSignal>[1]> = {}) => ({
    status: "open" as const,
    endsAt: later,
    fees,
    ...over,
  });

  it("says a bid is still possible while the ceiling leaves room above the price", () => {
    // Ceiling 80 all-in → at most 70.90 hammer, which is above the 55 it stands at.
    assert.equal(lotHasSignal("bid-possible", live({ currentBid: "55", maxBid: "80" }), now), true);
    // The price has caught up with the room, so there is nothing left to do.
    assert.equal(lotHasSignal("bid-possible", live({ currentBid: "75", maxBid: "80" }), now), false);
    // Already placed everything that fits.
    assert.equal(
      lotHasSignal("bid-possible", live({ currentBid: "55", myBid: "70.90", maxBid: "80" }), now),
      false
    );
    // No ceiling: the question cannot be answered, so the lot is not offered as actionable.
    assert.equal(lotHasSignal("bid-possible", live({ currentBid: "55" }), now), false);
  });

  it("separates leading from outbid, and neither survives the close", () => {
    assert.equal(lotHasSignal("leading", live({ currentBid: "40", myBid: "50" }), now), true);
    assert.equal(lotHasSignal("outbid", live({ currentBid: "60", myBid: "50" }), now), true);
    assert.equal(lotHasSignal("outbid", live({ currentBid: "40", myBid: "50" }), now), false);
    assert.equal(
      lotHasSignal("leading", live({ endsAt: earlier, currentBid: "40", myBid: "50" }), now),
      false
    );
  });

  it("flags a price that has passed the ceiling all-in, whoever is winning", () => {
    // 75 + 10% + 2 = 84.50, past an 80 ceiling.
    assert.equal(lotHasSignal("over-ceiling", live({ currentBid: "75", maxBid: "80" }), now), true);
    assert.equal(lotHasSignal("over-ceiling", live({ currentBid: "60", maxBid: "80" }), now), false);
  });

  it("holds a closed lot that was still ahead as won-pending", () => {
    const closed = live({ endsAt: earlier, currentBid: "40", myBid: "50" });
    assert.equal(lotHasSignal("won-pending", closed, now), true);
    assert.equal(
      lotHasSignal("won-pending", live({ endsAt: earlier, currentBid: "60", myBid: "50" }), now),
      false
    );
  });

  it("says nothing at all about a lot that has been closed", () => {
    for (const signal of LOT_SIGNALS) {
      assert.equal(
        lotHasSignal(signal, { status: "closed", endsAt: earlier, currentBid: "40", myBid: "50", fees }, now),
        false
      );
    }
  });
});

// summarizeLotComposition ---------------------------------------------------

describe("summarizeLotComposition", () => {
  const line = (over: Partial<LotLineValue> = {}): LotLineValue => ({
    quantity: 1,
    unitValue: 10,
    unpriced: false,
    unconvertible: false,
    uncertain: false,
    ...over,
  });

  it("multiplies each line by its quantity and sums", () => {
    const s = summarizeLotComposition([line({ unitValue: 10, quantity: 3 }), line({ unitValue: 2.5 })]);
    assert.equal(s.catalogValue, "32.50");
    assert.equal(s.lineCount, 2);
    assert.equal(s.quantity, 4);
  });

  it("has no value at all — not zero — when nothing is priced", () => {
    const s = summarizeLotComposition([
      line({ unitValue: null, unpriced: true, quantity: 2 }),
      line({ unitValue: null, unpriced: true }),
    ]);
    // A composition entered but unpriced is unanswered, not worthless: `0.00` would make every
    // headroom against it read as a catastrophic overbid.
    assert.equal(s.catalogValue, null);
    assert.equal(s.unpricedLines, 2);
    assert.equal(s.quantity, 3);
  });

  it("counts an unpriced line without dropping it from the lot", () => {
    const s = summarizeLotComposition([line({ unitValue: 10 }), line({ unitValue: null, unpriced: true })]);
    assert.equal(s.catalogValue, "10.00");
    assert.equal(s.unpricedLines, 1);
    assert.equal(s.lineCount, 2);
  });

  it("keeps 'priced but unconvertible' apart from 'no price'", () => {
    const s = summarizeLotComposition([line({ unitValue: null, unconvertible: true })]);
    assert.equal(s.catalogValue, null);
    assert.equal(s.unconvertibleLines, 1);
    assert.equal(s.unpricedLines, 0);
  });

  it("marks the total uncertain only when an uncertain line actually contributed", () => {
    assert.equal(summarizeLotComposition([line({ uncertain: true })]).uncertain, true);
    assert.equal(
      summarizeLotComposition([line(), line({ unitValue: null, unpriced: true, uncertain: true })])
        .uncertain,
      false
    );
  });

  it("treats a zero-quantity line as contributing nothing", () => {
    const s = summarizeLotComposition([line({ quantity: 0 }), line({ quantity: 2 })]);
    assert.equal(s.catalogValue, "20.00");
    assert.equal(s.quantity, 2);
  });

  it("returns an empty composition for no lines", () => {
    const s = summarizeLotComposition([]);
    assert.deepEqual(s, {
      lineCount: 0,
      quantity: 0,
      catalogValue: null,
      unpricedLines: 0,
      unconvertibleLines: 0,
      uncertain: false,
    });
  });
});

// lotNeedsComposition -------------------------------------------------------

describe("lotNeedsComposition", () => {
  it("flags a lot with no lines, whatever became of it", () => {
    for (const status of ["open", "closed"] as const) {
      assert.equal(lotNeedsComposition({ status, lineCount: 0 }), true, status);
    }
  });

  it("never flags a cancelled lot — describing it buys nothing", () => {
    assert.equal(lotNeedsComposition({ status: "cancelled", lineCount: 0 }), false);
  });

  it("says nothing once a single line is entered", () => {
    for (const status of ["open", "closed", "cancelled"] as const) {
      assert.equal(lotNeedsComposition({ status, lineCount: 1 }), false, status);
    }
  });
});

// lotOutcome ----------------------------------------------------------------
//
// The rule the whole model now rests on: won/lost/observed are read off the money, never recorded.

describe("lotOutcome", () => {
  it("says nothing about a lot still in play", () => {
    assert.equal(lotOutcome({ status: "open", myBid: "50", finalPrice: "40" }), "pending");
  });

  it("carries a cancelled lot through whatever the figures say", () => {
    // A cancelled listing produced no result at all, so the figures on it are not a result either.
    assert.equal(lotOutcome({ status: "cancelled", myBid: "50", finalPrice: "40" }), "cancelled");
  });

  it("calls a closed lot with no bid of your own observed", () => {
    // The case the old vocabulary had nowhere to put: tracked purely to record what it fetched.
    assert.equal(lotOutcome({ status: "closed", myBid: null, finalPrice: "40" }), "observed");
    assert.equal(lotOutcome({ status: "closed", finalPrice: "40" }), "observed");
  });

  it("reads a result below your maximum as won", () => {
    // Winning pays the runner-up's maximum plus an increment, which lands under your own.
    assert.equal(lotOutcome({ status: "closed", myBid: "50", finalPrice: "40" }), "won");
  });

  it("reads a result above your maximum as lost", () => {
    assert.equal(lotOutcome({ status: "closed", myBid: "50", finalPrice: "60" }), "lost");
  });

  it("lets the tie-break decide at exactly your maximum, and only there", () => {
    const tie = { status: "closed" as const, myBid: "50", finalPrice: "50" };
    assert.equal(lotOutcome({ ...tie, wonTie: true }), "won");
    assert.equal(lotOutcome({ ...tie, wonTie: false }), "lost");
    // Unanswered reads as lost rather than guessing a win: a fabricated win would go on to be
    // settled into a purchase. The close form demands an answer, so this should not arise.
    assert.equal(lotOutcome({ ...tie, wonTie: null }), "lost");
    assert.equal(lotOutcome(tie), "lost");
    // Everywhere else the flag is meaningless and must not override the arithmetic.
    assert.equal(lotOutcome({ status: "closed", myBid: "50", finalPrice: "60", wonTie: true }), "lost");
    assert.equal(lotOutcome({ status: "closed", myBid: "50", finalPrice: "40", wonTie: false }), "won");
  });

  it("files a bid lot with no result as lost — legacy rows only", () => {
    // ADR-0021 §5 filed exactly this shape as "lost with no figure". Closing can no longer create
    // it, so reading it any other way would silently restate what the old rows meant.
    assert.equal(lotOutcome({ status: "closed", myBid: "50", finalPrice: null }), "lost");
  });

  it("treats a blank amount as absent, not as zero", () => {
    // `Number("")` is 0, which would make an unbid lot look like a maximum of nothing.
    assert.equal(lotOutcome({ status: "closed", myBid: "  ", finalPrice: "40" }), "observed");
  });
});
