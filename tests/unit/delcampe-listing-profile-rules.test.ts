import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  DELCAMPE_PROFILE_DEFAULTS,
  DELCAMPE_PROMOTION_OPTIONS,
  DELCAMPE_RENEW_DURATION_MAX,
  DELCAMPE_RENEW_TOTAL_COUNT_MAX,
  cleanDelcampeListingProfileValues,
  countDelcampePromotions,
  delcampeAuctionGaps,
  delcampeMinimumBidStep,
  type DelcampeListingProfileValues,
} from "../../src/lib/delcampe-listing-profile-rules";

// The pure half of a Delcampe listing profile (#608; ADR-0034): the bid-step threshold rule and the
// cleaning every write goes through.

const VALUES: DelcampeListingProfileValues = {
  ...DELCAMPE_PROFILE_DEFAULTS,
  name: "Standard letter",
  shippingModel: "Fee template",
};

describe("delcampeMinimumBidStep", () => {
  const rule = { threshold: 1, below: 0.01, atOrAbove: 0.1 };

  it("takes the lower step below the threshold", () => {
    assert.equal(delcampeMinimumBidStep(0.1, rule), 0.01);
    assert.equal(delcampeMinimumBidStep(0.99, rule), 0.01);
  });

  it("takes the upper step **at** the threshold, not only above it", () => {
    // The one reading the rule has to pin down: "more expensive" is otherwise decided again by every
    // caller, and the export and the settings preview would disagree on exactly one price.
    assert.equal(delcampeMinimumBidStep(1, rule), 0.1);
    assert.equal(delcampeMinimumBidStep(17.44, rule), 0.1);
  });

  it("answers for a free listing", () => {
    assert.equal(delcampeMinimumBidStep(0, rule), 0.01);
  });
});

describe("cleanDelcampeListingProfileValues", () => {
  it("trims the name and the shipping model", () => {
    const cleaned = cleanDelcampeListingProfileValues({
      ...VALUES,
      name: "  Heavy lot  ",
      shippingModel: "  Fee template  ",
    });
    assert.equal(cleaned.name, "Heavy lot");
    assert.equal(cleaned.shippingModel, "Fee template");
  });

  it("refuses a profile with no name and one with no shipping model", () => {
    assert.throws(() => cleanDelcampeListingProfileValues({ ...VALUES, name: "   " }), /needs a name/);
    assert.throws(
      () => cleanDelcampeListingProfileValues({ ...VALUES, shippingModel: "" }),
      /shipping model/
    );
  });

  it("takes any shipping model name — there is nothing to check it against", () => {
    // Deliberate: the CSV carries the name itself, no id is held in reserve, and Delcampe's own list
    // is behind the API Pass. A refused upload is Delcampe's answer, not a fault in the export.
    const cleaned = cleanDelcampeListingProfileValues({
      ...VALUES,
      shippingModel: "Whatever it is called now",
    });
    assert.equal(cleaned.shippingModel, "Whatever it is called now");
  });

  it("refuses renewal counters that are not whole numbers in range", () => {
    assert.throws(() => cleanDelcampeListingProfileValues({ ...VALUES, renewDuration: 0 }), /whole number/);
    assert.throws(() => cleanDelcampeListingProfileValues({ ...VALUES, renewDuration: 28.5 }), /whole number/);
    assert.throws(
      () => cleanDelcampeListingProfileValues({ ...VALUES, renewDuration: DELCAMPE_RENEW_DURATION_MAX + 1 }),
      /whole number/
    );
    assert.throws(() => cleanDelcampeListingProfileValues({ ...VALUES, renewTotalCount: -1 }), /whole number/);
  });

  it("refuses a bid step of zero, and a negative threshold", () => {
    assert.throws(() => cleanDelcampeListingProfileValues({ ...VALUES, minBidStepBelow: 0 }), /more than 0/);
    assert.throws(
      () => cleanDelcampeListingProfileValues({ ...VALUES, minBidStepAtOrAbove: 0 }),
      /more than 0/
    );
    assert.throws(
      () => cleanDelcampeListingProfileValues({ ...VALUES, minBidStepThreshold: -1 }),
      /0 or more/
    );
  });

  it("keeps a free threshold, which is how one step is used for every price", () => {
    const cleaned = cleanDelcampeListingProfileValues({ ...VALUES, minBidStepThreshold: 0 });
    assert.equal(cleaned.minBidStepThreshold, 0);
    assert.equal(
      delcampeMinimumBidStep(0, {
        threshold: cleaned.minBidStepThreshold,
        below: cleaned.minBidStepBelow,
        atOrAbove: cleaned.minBidStepAtOrAbove,
      }),
      cleaned.minBidStepAtOrAbove
    );
  });

  it("rounds a money field to the two decimals the file carries", () => {
    const cleaned = cleanDelcampeListingProfileValues({ ...VALUES, minBidStepThreshold: 1.239 });
    assert.equal(cleaned.minBidStepThreshold, 1.24);
  });
});

describe("the auction group (#620)", () => {
  it("starts as nothing at all — no duration is seeded on the collector's behalf", () => {
    assert.equal(DELCAMPE_PROFILE_DEFAULTS.auctionDuration, null);
    assert.equal(DELCAMPE_PROFILE_DEFAULTS.auctionRenewTotalCount, null);
    assert.equal(DELCAMPE_PROFILE_DEFAULTS.auctionEndDay, "");
    assert.equal(DELCAMPE_PROFILE_DEFAULTS.auctionEndTime, "");
  });

  it("saves a profile that never uploads an auction", () => {
    // The ordinary case: the group is optional as a group, and an unstated duration is the export's
    // refusal rather than this screen's.
    const cleaned = cleanDelcampeListingProfileValues(VALUES);
    assert.equal(cleaned.auctionDuration, null);
    assert.equal(cleaned.auctionRenewTotalCount, null);
  });

  it("holds a stated figure to the same bounds a shop-stock count takes", () => {
    assert.throws(
      () => cleanDelcampeListingProfileValues({ ...VALUES, auctionDuration: 0 }),
      /whole number/
    );
    assert.throws(
      () => cleanDelcampeListingProfileValues({ ...VALUES, auctionDuration: 7.5 }),
      /whole number/
    );
    assert.throws(
      () =>
        cleanDelcampeListingProfileValues({
          ...VALUES,
          auctionRenewTotalCount: DELCAMPE_RENEW_TOTAL_COUNT_MAX + 1,
        }),
      /whole number/
    );
    assert.equal(
      cleanDelcampeListingProfileValues({ ...VALUES, auctionDuration: 7 }).auctionDuration,
      7
    );
  });

  it("reads a half-typed count as unstated rather than as a zero", () => {
    // The editor holds counts as text; an empty field arrives as NaN.
    const cleaned = cleanDelcampeListingProfileValues({ ...VALUES, auctionDuration: Number.NaN });
    assert.equal(cleaned.auctionDuration, null);
  });

  it("trims the two end cells and otherwise takes them as typed", () => {
    // There is nothing to check them against — the shipping model's rule (ADR-0034 §2) applied to a
    // format Delcampe has never published.
    const cleaned = cleanDelcampeListingProfileValues({
      ...VALUES,
      auctionEndDay: "  7  ",
      auctionEndTime: " 8 PM ",
    });
    assert.equal(cleaned.auctionEndDay, "7");
    assert.equal(cleaned.auctionEndTime, "8 PM");
  });
});

describe("delcampeAuctionGaps", () => {
  it("names both figures on a profile that has never uploaded an auction", () => {
    assert.deepEqual(delcampeAuctionGaps(VALUES), [
      "how many days it runs",
      "how many times it may renew",
    ]);
  });

  it("is empty once both are stated", () => {
    assert.deepEqual(
      delcampeAuctionGaps({ ...VALUES, auctionDuration: 7, auctionRenewTotalCount: 1 }),
      []
    );
  });

  it("says nothing about a blank closing day — a row with no end is a listing, not a fault", () => {
    const noClosingTime: DelcampeListingProfileValues = {
      ...VALUES,
      auctionDuration: 7,
      auctionRenewTotalCount: 1,
      auctionEndDay: "",
      auctionEndTime: "",
    };
    assert.deepEqual(delcampeAuctionGaps(noClosingTime), []);
  });
});

describe("countDelcampePromotions", () => {
  it("is zero on an ordinary profile", () => {
    assert.equal(countDelcampePromotions(VALUES), 0);
  });

  it("counts each of the five", () => {
    const all = Object.fromEntries(
      DELCAMPE_PROMOTION_OPTIONS.map((option) => [option.key, true])
    ) as Record<(typeof DELCAMPE_PROMOTION_OPTIONS)[number]["key"], boolean>;
    assert.equal(countDelcampePromotions(all), 5);
    assert.equal(countDelcampePromotions({ ...VALUES, optionListPromotion: true }), 1);
  });
});
