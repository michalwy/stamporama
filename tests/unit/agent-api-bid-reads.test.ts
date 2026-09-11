import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { bidLine, bidRecommendation } from "../../src/lib/agent-api/bid-reads";
import { lotLineValueOf } from "../../src/lib/auction-lot";

// The bid-recommendation projections (#1168) and the one catalogue rule under them.
//
// **The subject is that three unanswerable cases stay three answers**, because an agent that
// collapses them into a number recommends bidding on something unpriceable. They are: no anchor at
// all, an anchor with no rate into the currency asked for, and a level the fees alone consume — and
// there is a fourth state that looks like one of them and is not, a lot where nothing anchored at
// all, whose levels are **absent** rather than nought (ADR-0029 §1).
//
// `lotLineValueOf` is here rather than in `auction-lot.test.ts` because it is the same subject one
// layer down: it is the single statement of *unpriced* against *unconvertible* against *a figure*,
// and it is shared by the lots screen and by the lot-free path precisely so the two cannot come to
// disagree about which of the three a line is.

const NO_FEES = { premiumPercent: undefined, premiumFixed: undefined };
const BAND = { bidFloorPercent: 75, bidCeilingPercent: 125 };

function anchorOf(overrides: Partial<Parameters<typeof bidLine>[0]> = {}) {
  return {
    stampId: "s1",
    stampName: "Kościuszko",
    catalogLabel: "Mi·PL 12",
    quantity: 1,
    anchor: 20,
    source: "catalogue" as const,
    unconvertible: false,
    market: null,
    ratio: { ratio: 0.5, bucketLabel: "Poland, MNH, 1948–1952" },
    owned: 0,
    ...overrides,
  };
}

const NAMING = { condition: "Mint Never Hinged", certificate: null, format: null };

function recommendationOf(
  recommendation: Partial<Parameters<typeof bidRecommendation>[0]["recommendation"]> = {},
  rest: Partial<Omit<Parameters<typeof bidRecommendation>[0], "recommendation">> = {}
) {
  return bidRecommendation(
    {
      currency: "EUR",
      band: BAND,
      fees: NO_FEES,
      recommendation: {
        fair: { allIn: "40.00", bid: "40.00" },
        floor: { allIn: "30.00", bid: "30.00" },
        walkAway: { allIn: "50.00", bid: "50.00" },
        marketLines: 0,
        catalogueLines: 1,
        unanchoredLines: 0,
        unconvertibleLines: 0,
        ...recommendation,
      },
      unknownStampIds: [],
      ...rest,
    },
    []
  );
}

describe("lotLineValueOf — one statement of the three catalogue outcomes (#1168)", () => {
  it("gives a figure when there is a price and a rate", () => {
    const value = lotLineValueOf(2, { unpriced: false, baseAmount: 10, uncertain: false }, 4);
    assert.deepEqual(value, {
      quantity: 2,
      unitValue: 40,
      unpriced: false,
      unconvertible: false,
      uncertain: false,
    });
  });

  it("is unpriced when nothing valued the line, whatever the rate", () => {
    const noValuation = lotLineValueOf(1, undefined, 1);
    assert.equal(noValuation.unpriced, true);
    assert.equal(noValuation.unconvertible, false);
    assert.equal(noValuation.unitValue, null);

    const unpriced = lotLineValueOf(1, { unpriced: true, baseAmount: null, uncertain: false }, 1);
    assert.equal(unpriced.unpriced, true);
    assert.equal(unpriced.unconvertible, false);
  });

  it("is unpriced rather than unconvertible when a valuation carries no base amount", () => {
    // The two flags are read in this order deliberately: nothing was priced, so there is nothing a
    // rate could have converted, and reporting *unconvertible* would say a figure exists.
    const value = lotLineValueOf(1, { unpriced: false, baseAmount: null, uncertain: false }, null);
    assert.equal(value.unpriced, true);
    assert.equal(value.unconvertible, false);
  });

  it("is unconvertible — never unpriced — when there is a figure and no rate", () => {
    const value = lotLineValueOf(1, { unpriced: false, baseAmount: 10, uncertain: true }, null);
    assert.equal(value.unpriced, false);
    assert.equal(value.unconvertible, true);
    assert.equal(value.unitValue, null);
    // The estimate flag survives either way: it describes where the figure came from, not whether
    // it could be counted.
    assert.equal(value.uncertain, true);
  });

  it("keeps a zero figure as a figure, and does not read it as unpriced", () => {
    const value = lotLineValueOf(1, { unpriced: false, baseAmount: 0, uncertain: false }, 2);
    assert.equal(value.unpriced, false);
    assert.equal(value.unitValue, 0);
  });
});

describe("bidLine — what an agent is told about one line (#1168)", () => {
  it("states the route and the figure for an anchored line", () => {
    const line = bidLine(anchorOf(), NAMING);
    assert.equal(line.anchoredOn, "catalogue");
    assert.equal(line.unitValue, "20.00");
    assert.equal(line.unconvertible, undefined);
    assert.equal(line.ratioBucket, "Poland, MNH, 1948–1952");
    assert.equal(line.ratioPercent, 50);
  });

  it("names no route at all for a line nothing anchored", () => {
    const line = bidLine(anchorOf({ anchor: null, source: null, ratio: null }), NAMING);
    assert.equal(line.anchoredOn, undefined);
    assert.equal(line.unitValue, undefined);
    assert.equal(line.unconvertible, undefined);
    assert.equal(line.ratioBucket, undefined);
  });

  it("marks an unconvertible line as such and gives it no figure", () => {
    // **It still names the route** — the value exists and the ratio says what it would have been
    // multiplied by; what is missing is a way to state it in this currency.
    const line = bidLine(anchorOf({ anchor: null, unconvertible: true }), NAMING);
    assert.equal(line.unconvertible, true);
    assert.equal(line.unitValue, undefined);
    assert.equal(line.anchoredOn, undefined);
    assert.equal(line.ratioBucket, "Poland, MNH, 1948–1952");
  });

  it("carries a market anchor's sample size and no ratio", () => {
    const line = bidLine(
      anchorOf({ source: "market", market: { n: 4 }, ratio: null, anchor: 25 }),
      NAMING
    );
    assert.equal(line.anchoredOn, "market");
    assert.equal(line.marketSampleSize, 4);
    assert.equal(line.ratioBucket, undefined);
    assert.equal(line.ratioPercent, undefined);
  });

  it("drops a null certificate and a null format rather than spelling them", () => {
    // #710's rule and not #712's: on a described line the null *is* the whole answer — no
    // certificate, a single — so its absence says exactly what a spelling would.
    const line = bidLine(anchorOf(), NAMING);
    assert.equal(line.certificate, undefined);
    assert.equal(line.format, undefined);
    assert.equal("certificate" in line, false);
    assert.equal("format" in line, false);
  });

  it("keeps an ownership count of zero, because nought held is an answer", () => {
    const line = bidLine(anchorOf({ owned: 0 }), NAMING);
    assert.equal(line.owned, 0);
    assert.equal("owned" in line, true);
  });
});

describe("bidRecommendation — the three unanswerable cases stay three (#1168)", () => {
  it("keeps a level whose fees consume it, with no bid rather than a bid of nought", () => {
    const result = recommendationOf({ fair: { allIn: "40.00", bid: null } });
    assert.equal(result.fair?.allIn, "40.00");
    assert.equal(result.fair?.bid, undefined);
    assert.equal("bid" in result.fair!, false);
  });

  it("leaves every level absent when nothing anchored, rather than reporting nought", () => {
    const result = recommendationOf({
      fair: null,
      floor: null,
      walkAway: null,
      catalogueLines: 0,
      unanchoredLines: 3,
    });
    assert.equal(result.fair, undefined);
    assert.equal(result.floor, undefined);
    assert.equal(result.walkAway, undefined);
    // The counts survive — they are what says why there is no figure.
    assert.equal(result.unanchoredLines, 3);
  });

  it("keeps the two partial-coverage counts at zero rather than dropping them", () => {
    const result = recommendationOf();
    assert.equal(result.unanchoredLines, 0);
    assert.equal(result.unconvertibleLines, 0);
    // A missing count would read as *nothing to say*, where a zero says *nothing was missed*.
    assert.equal("unanchoredLines" in result, true);
    assert.equal("unconvertibleLines" in result, true);
  });

  it("tells the two partial-coverage counts apart", () => {
    const result = recommendationOf({ unanchoredLines: 1, unconvertibleLines: 2 });
    assert.equal(result.unanchoredLines, 1);
    assert.equal(result.unconvertibleLines, 2);
  });

  it("echoes the fees it used, and says nothing when it used none", () => {
    const none = recommendationOf();
    assert.equal(none.premiumPercent, undefined);
    assert.equal(none.premiumFixed, undefined);

    const withFees = bidRecommendation(
      {
        currency: "EUR",
        band: BAND,
        fees: { premiumPercent: "20", premiumFixed: "1.5" },
        recommendation: {
          fair: { allIn: "40.00", bid: "32.08" },
          floor: null,
          walkAway: null,
          marketLines: 1,
          catalogueLines: 0,
          unanchoredLines: 0,
          unconvertibleLines: 0,
        },
        unknownStampIds: [],
      },
      []
    );
    assert.equal(withFees.premiumPercent, 20);
    assert.equal(withFees.premiumFixed, "1.50");
  });

  it("keeps a stated premium of zero, which is a house that charges none", () => {
    const result = bidRecommendation(
      {
        currency: "EUR",
        band: BAND,
        fees: { premiumPercent: "0", premiumFixed: null },
        recommendation: {
          fair: { allIn: "40.00", bid: "40.00" },
          floor: null,
          walkAway: null,
          marketLines: 1,
          catalogueLines: 0,
          unanchoredLines: 0,
          unconvertibleLines: 0,
        },
        unknownStampIds: [],
      },
      []
    );
    // `compact` keeps `0`, which matters here: *stated as none* and *not stated* are different
    // claims, and only the second means the bid may be an overstatement.
    assert.equal(result.premiumPercent, 0);
    assert.equal("premiumPercent" in result, true);
  });

  it("states the band it used rather than leaving two figures to be reverse-engineered", () => {
    const result = recommendationOf();
    assert.equal(result.floorPercent, 75);
    assert.equal(result.walkAwayPercent, 125);
  });

  it("names unknown stamps when there are any and says nothing when there are none", () => {
    assert.equal(recommendationOf().unknownStampIds, undefined);
    assert.deepEqual(recommendationOf({}, { unknownStampIds: ["x"] }).unknownStampIds, ["x"]);
  });
});
