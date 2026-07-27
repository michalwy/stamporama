import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  allIn,
  headroom,
  summarizeAuctionSale,
  type AuctionLotSummaryRow,
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
  return { status: "watching", currentBid: "100", catalogValue: "200", ...over };
}

describe("summarizeAuctionSale", () => {
  it("counts every lot by status", () => {
    const s = summarizeAuctionSale([
      lot(),
      lot({ status: "won" }),
      lot({ status: "lost" }),
      lot({ status: "cancelled" }),
    ]);
    assert.equal(s.lotCount, 4);
    assert.deepEqual(
      [s.watchingCount, s.wonCount, s.lostCount, s.cancelledCount],
      [1, 1, 1, 1]
    );
  });

  it("totals only the lots that cost money", () => {
    const s = summarizeAuctionSale(
      [lot(), lot({ status: "won" }), lot({ status: "lost" }), lot({ status: "cancelled" })],
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
    const s = summarizeAuctionSale([lot({ status: "lost" })], FEES);
    assert.equal(s.payableCount, 0);
    assert.equal(s.allInTotal, "0.00");
    assert.equal(s.headroom, null);
  });

  it("prefers the settled price over the last observed bid", () => {
    const s = summarizeAuctionSale([lot({ status: "won", currentBid: "100", finalPrice: "180" })]);
    assert.equal(s.bidTotal, "180.00");
  });

  it("falls back to the current bid when a closed lot has no final price", () => {
    const s = summarizeAuctionSale([lot({ status: "won", currentBid: "100", finalPrice: null })]);
    assert.equal(s.bidTotal, "100.00");
  });

  it("flags payable lots that are missing a bid or a catalogue value", () => {
    const s = summarizeAuctionSale([
      lot(),
      lot({ currentBid: null }),
      lot({ catalogValue: null }),
      // A lost lot is not payable, so its gaps are nobody's business.
      lot({ status: "lost", currentBid: null, catalogValue: null }),
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

  it("is all zeroes for an empty sale", () => {
    const s = summarizeAuctionSale([], FEES);
    assert.deepEqual(
      [s.lotCount, s.payableCount, s.bidTotal, s.allInTotal, s.catalogTotal, s.headroom],
      [0, 0, "0.00", "0.00", "0.00", null]
    );
  });
});
