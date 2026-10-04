import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  lineConditionCandidates,
  lineConditionKind,
  lineConditionLabel,
  normalizeLineCondition,
  onlySettledLots,
} from "../../src/lib/auction-line-condition";
import {
  lotLineRangeOf,
  summarizeAuctionSale,
  summarizeLotComposition,
} from "../../src/lib/auction-lot";
import { recommendBid } from "../../src/lib/bid-recommendation";
import { duplicateMatches, type AtRiskLine } from "../../src/lib/auction-duplicates";
import { watchlistLot, type WatchlistLotRow } from "../../src/lib/agent-api/auction-reads";
import { bidLine, bidRecommendation } from "../../src/lib/agent-api/bid-reads";

// A lot line's condition can be unknown, or one of several (#1623). A listing often does not say —
// *Czysty* is MNH or MH — and a composition that is quietly wrong is worse than one left open, so a
// line holds a condition, a set it may be in, or nothing, and is valued as a range over them.

const CONDITIONS = [
  { id: "mnh", name: "Mint never hinged", abbreviation: "MNH" },
  { id: "mh", name: "Mint hinged", abbreviation: "MH" },
  { id: "used", name: "Used", abbreviation: "U" },
];
const IDS = CONDITIONS.map((c) => c.id);

describe("normalizeLineCondition — one stored shape for three answers", () => {
  it("keeps a settled condition and drops any set sent beside it", () => {
    assert.deepEqual(normalizeLineCondition({ conditionId: "mnh", possibleConditionIds: ["mh"] }), {
      conditionId: "mnh",
      possibleConditionIds: [],
    });
  });

  it("reads a set of one as that condition, so the lot is not marked over an answered question", () => {
    assert.deepEqual(normalizeLineCondition({ conditionId: null, possibleConditionIds: ["mh", "mh"] }), {
      conditionId: "mh",
      possibleConditionIds: [],
    });
  });

  it("keeps a set of two or more, and reads nothing at all as unknown", () => {
    const oneOf = normalizeLineCondition({ conditionId: "", possibleConditionIds: ["mnh", "mh"] });
    assert.deepEqual(oneOf, { conditionId: null, possibleConditionIds: ["mnh", "mh"] });
    assert.equal(lineConditionKind(oneOf), "oneOf");
    const unknown = normalizeLineCondition({ conditionId: null });
    assert.equal(lineConditionKind(unknown), "unknown");
  });
});

describe("lineConditionCandidates", () => {
  it("is the settled condition, the set in the collection's order, or every condition", () => {
    assert.deepEqual(lineConditionCandidates({ conditionId: "mh", possibleConditionIds: [] }, IDS), ["mh"]);
    assert.deepEqual(
      lineConditionCandidates({ conditionId: null, possibleConditionIds: ["used", "mnh"] }, IDS),
      ["mnh", "used"]
    );
    assert.deepEqual(lineConditionCandidates({ conditionId: null, possibleConditionIds: [] }, IDS), IDS);
  });

  it("keeps a possible condition the collection order does not know, rather than narrowing silently", () => {
    assert.deepEqual(
      lineConditionCandidates({ conditionId: null, possibleConditionIds: ["gone", "mh"] }, IDS),
      ["mh", "gone"]
    );
  });
});

describe("lineConditionLabel", () => {
  it("names a set as `MNH or MH` and an unknown condition as such", () => {
    assert.equal(
      lineConditionLabel({ conditionId: null, possibleConditionIds: ["mh", "mnh"] }, CONDITIONS).short,
      "MNH or MH"
    );
    assert.equal(
      lineConditionLabel({ conditionId: null, possibleConditionIds: [] }, CONDITIONS).long,
      "Condition unknown"
    );
    assert.equal(lineConditionLabel({ conditionId: "used", possibleConditionIds: [] }, CONDITIONS).short, "U");
  });
});

describe("lotLineRangeOf — valued from the lowest possible condition to the highest", () => {
  const priced = (baseAmount: number) => ({ unpriced: false, baseAmount, uncertain: false });
  const none = { unpriced: true, baseAmount: null, uncertain: false };

  it("states the low and the high end over the priced conditions", () => {
    const value = lotLineRangeOf(2, [priced(40), priced(20)], 1, true);
    assert.equal(value.unitValue, 20);
    assert.equal(value.unitValueHigh, 40);
    assert.equal(value.unpriced, false);
    assert.equal(value.conditionUnsettled, true);
  });

  it("leaves an unpriced condition out of the range and counts it, rather than emptying the line", () => {
    const value = lotLineRangeOf(1, [priced(40), none, undefined], 1, true);
    assert.equal(value.unitValue, 40);
    assert.equal(value.unitValueHigh, 40);
    assert.equal(value.unpricedConditions, 2);
  });

  it("is unpriced only when no possible condition is priced, and marked only when every one is", () => {
    const unpriced = lotLineRangeOf(1, [none, none], 1, true);
    assert.equal(unpriced.unpriced, true);
    assert.equal(unpriced.mark, null);
    const marked = lotLineRangeOf(
      1,
      [
        { ...none, mark: "nonexistent" as const },
        { ...none, mark: "undeterminable" as const },
      ],
      1,
      true
    );
    assert.equal(marked.mark, "nonexistent");
    const partly = lotLineRangeOf(1, [{ ...none, mark: "nonexistent" as const }, none], 1, true);
    assert.equal(partly.mark, null);
  });

  it("calls the line unconvertible, not unpriced, when the rate is what is missing", () => {
    const value = lotLineRangeOf(1, [priced(10), priced(30)], null, true);
    assert.equal(value.unconvertible, true);
    assert.equal(value.unpriced, false);
  });

  it("reads a settled line exactly as before", () => {
    const value = lotLineRangeOf(3, [priced(10)], 2, false);
    assert.equal(value.unitValue, 20);
    assert.equal(value.conditionUnsettled, undefined);
  });
});

describe("summarizeLotComposition with a range", () => {
  it("sums the low ends into the catalogue value and the high ends beside it", () => {
    const s = summarizeLotComposition([
      { quantity: 1, unitValue: 10, unitValueHigh: 25, unpriced: false, mark: null, unconvertible: false, uncertain: false, conditionUnsettled: true },
      { quantity: 2, unitValue: 5, unpriced: false, mark: null, unconvertible: false, uncertain: false },
    ]);
    assert.equal(s.catalogValue, "20.00");
    assert.equal(s.catalogValueHigh, "35.00");
    assert.equal(s.unsettledLines, 1);
  });

  it("says one figure when the possible conditions happen to be priced alike", () => {
    const s = summarizeLotComposition([
      { quantity: 1, unitValue: 10, unitValueHigh: 10, unpriced: false, mark: null, unconvertible: false, uncertain: false, conditionUnsettled: true },
    ]);
    assert.equal(s.catalogValueHigh, null);
    assert.equal(s.unsettledLines, 1);
  });
});

describe("summarizeAuctionSale with a range", () => {
  it("takes the low end into the total and the headroom, and states the high end beside them", () => {
    const s = summarizeAuctionSale([
      { status: "open", myBid: "10.00", currentBid: "10.00", catalogValue: "20.00", catalogValueHigh: "50.00" },
      { status: "open", myBid: "5.00", currentBid: "5.00", catalogValue: "10.00" },
    ]);
    assert.equal(s.catalogTotal, "30.00");
    assert.equal(s.catalogTotalHigh, "60.00");
    assert.equal(s.rangeLotCount, 1);
    assert.equal(s.headroom, "15.00");
  });

  it("has no high end when no lot has a range", () => {
    const s = summarizeAuctionSale([{ status: "open", myBid: "1.00", catalogValue: "2.00" }]);
    assert.equal(s.catalogTotalHigh, null);
    assert.equal(s.rangeLotCount, 0);
  });
});

describe("recommendBid with a range", () => {
  const band = { bidFloorPercent: 50, bidCeilingPercent: 150 };

  it("bids from the low anchors and states the high ones beside them", () => {
    const rec = recommendBid(
      [
        { quantity: 1, anchor: 10, anchorHigh: 30, source: "catalogue", unconvertible: false },
        { quantity: 2, anchor: 5, source: "market", unconvertible: false },
      ],
      band
    );
    assert.equal(rec.fair?.allIn, "20.00");
    assert.equal(rec.high?.fair.allIn, "40.00");
    assert.equal(rec.high?.floor.allIn, "20.00");
    assert.equal(rec.high?.walkAway.allIn, "60.00");
  });

  it("has no high end when every line is one figure", () => {
    const rec = recommendBid([{ quantity: 1, anchor: 10, source: "catalogue", unconvertible: false }], band);
    assert.equal(rec.high, null);
  });
});

describe("duplicate warning with a condition to settle", () => {
  const atRisk: AtRiskLine = {
    lotId: "other",
    auctionLotNo: 7,
    saleId: "s",
    lotTitle: null,
    stampId: "st",
    familyIds: [],
    stampLabel: "Mi 1",
    conditionId: null,
    conditionLabel: "MNH or MH",
    formatId: null,
    formatLabel: null,
    certificateStatusId: null,
    certificateStatusLabel: null,
  };

  it("never warns hard over a condition nobody has settled, on either side", () => {
    const line = { stampId: "st", conditionId: null, formatId: null, certificateStatusId: null };
    assert.equal(duplicateMatches([line], [atRisk])[0].strength, "soft");
    assert.equal(
      duplicateMatches([{ ...line, conditionId: "mnh" }], [atRisk])[0].strength,
      "soft"
    );
  });
});

describe("onlySettledLots — a lot is market evidence once every condition is settled", () => {
  it("keeps the lots whose every line has a condition, and drops the rest whole", () => {
    const lots = onlySettledLots([
      { id: "a", lines: [{ conditionId: "mnh", condition: { name: "MNH" } }] },
      {
        id: "b",
        lines: [
          { conditionId: "mnh", condition: { name: "MNH" } },
          { conditionId: null, condition: null },
        ],
      },
    ]);
    assert.deepEqual(
      lots.map((lot) => lot.id),
      ["a"]
    );
  });
});

describe("the agent's reads report the possible conditions and the range", () => {
  const row: WatchlistLotRow = {
    id: "l1",
    saleName: "S",
    sellerName: "Seller",
    platformName: "Allegro",
    currency: "PLN",
    auctionLotNo: 1,
    lotNo: null,
    url: null,
    title: "Lot",
    derivedTitle: null,
    status: "open",
    endsAt: new Date("2026-10-05T12:00:00Z"),
    startingPrice: null,
    currentBid: null,
    checkedAt: null,
    allIn: null,
    myBid: null,
    myAllIn: null,
    maxBid: null,
    ceiling: null,
    ceilingSetApart: false,
    bidRoom: null,
    standing: null,
    overCeiling: null,
    myBidOverCeiling: null,
    premiumPercent: null,
    premiumFixed: null,
    notStamps: false,
    notStampsDescription: null,
    tags: [],
    catalogValue: "20.00",
    catalogValueHigh: "40.00",
    recommendation: {
      fair: { allIn: "16.00", bid: "16.00" },
      high: { fair: { allIn: "32.00", bid: "32.00" } },
    },
    conditionToSettle: true,
    unsettledLines: [
      { stamp: "Mi 1", possibleConditions: ["MNH", "MH"], unknown: false },
      { stamp: "Mi 2", possibleConditions: [], unknown: true },
    ],
  };

  it("names the unsettled lines and gives both ends of the value and the recommendation", () => {
    const lot = watchlistLot(row, new Date("2026-10-04T12:00:00Z"), "/p");
    assert.equal(lot.conditionToSettle, true);
    assert.equal(lot.catalogueValue, "20.00");
    assert.equal(lot.catalogueValueHigh, "40.00");
    assert.deepEqual(lot.recommended, { allIn: "16.00", bid: "16.00" });
    assert.deepEqual(lot.recommendedHigh, { allIn: "32.00", bid: "32.00" });
    assert.deepEqual(lot.unsettledLines, [
      { stamp: "Mi 1", possibleConditions: ["MNH", "MH"] },
      { stamp: "Mi 2", conditionUnknown: true },
    ]);
  });

  it("says a settled lot is settled, and leaves the range out", () => {
    const lot = watchlistLot(
      { ...row, catalogValueHigh: null, recommendation: null, conditionToSettle: false, unsettledLines: [] },
      new Date("2026-10-04T12:00:00Z"),
      "/p"
    );
    assert.equal(lot.conditionToSettle, false);
    assert.equal(lot.catalogueValueHigh, undefined);
    assert.equal(lot.unsettledLines, undefined);
  });

  it("gives recommend_bid's line its possible grades and the top of its range", () => {
    const line = bidLine(
      {
        stampId: "st",
        stampName: null,
        catalogLabel: "Mi 1",
        quantity: 1,
        anchor: 10,
        anchorHigh: 25,
        source: "catalogue",
        unconvertible: false,
        market: null,
        ratio: { ratio: 1, bucketLabel: "x" },
        owned: 0,
      },
      { condition: "MNH or MH", possibleConditions: ["MNH", "MH"], certificate: null, format: null }
    );
    assert.equal(line.unitValue, "10.00");
    assert.equal(line.unitValueHigh, "25.00");
    assert.deepEqual(line.possibleConditions, ["MNH", "MH"]);
  });

  it("gives recommend_bid's answer a `high` only when there is a range", () => {
    const base = {
      currency: "PLN",
      band: { bidFloorPercent: 50, bidCeilingPercent: 150 },
      fees: {},
      unknownStampIds: [],
    };
    const levels = {
      fair: { allIn: "10.00", bid: "10.00" },
      floor: { allIn: "5.00", bid: "5.00" },
      walkAway: { allIn: "15.00", bid: "15.00" },
      marketLines: 0,
      catalogueLines: 1,
      unanchoredLines: 0,
      unconvertibleLines: 0,
    };
    const ranged = bidRecommendation(
      {
        ...base,
        recommendation: {
          ...levels,
          high: {
            fair: { allIn: "20.00", bid: "20.00" },
            floor: { allIn: "10.00", bid: "10.00" },
            walkAway: { allIn: "30.00", bid: null },
          },
        },
      },
      []
    );
    assert.deepEqual(ranged.high?.walkAway, { allIn: "30.00" });
    assert.equal(bidRecommendation({ ...base, recommendation: { ...levels, high: null } }, []).high, undefined);
  });
});
