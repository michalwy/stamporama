import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FACEBOOK_AUCTION_DAYS_MAX,
  FACEBOOK_GROUP_DEFAULTS,
  FACEBOOK_POST_PLACEHOLDERS,
  cleanFacebookGroupValues,
  isFacebookGroupUrl,
  normalizeClosingTime,
  unknownPostPlaceholders,
  type FacebookGroupValues,
} from "../../src/lib/facebook-group-rules";

// A Facebook group's settings (#1543; ADR-0061): every default optional, and what is stated held to
// its shape. The database half — the platform marker, archive, the delete refused while offers name
// the group — is `tests/integration/facebook-groups.test.ts`.

function values(overrides: Partial<FacebookGroupValues> = {}): FacebookGroupValues {
  return {
    ...FACEBOOK_GROUP_DEFAULTS,
    name: "Znaczki — aukcje",
    url: "https://www.facebook.com/groups/123456",
    ...overrides,
  };
}

describe("cleanFacebookGroupValues (#1543)", () => {
  it("accepts a group with a name and a link and nothing else", () => {
    const clean = cleanFacebookGroupValues(values());
    assert.deepEqual(clean, { ...FACEBOOK_GROUP_DEFAULTS, name: "Znaczki — aukcje", url: "https://www.facebook.com/groups/123456" });
  });

  it("refuses a group without a name or without a link", () => {
    assert.throws(() => cleanFacebookGroupValues(values({ name: "  " })), /needs a name/);
    assert.throws(() => cleanFacebookGroupValues(values({ url: "" })), /needs its link/);
  });

  it("refuses a link that is not a web address", () => {
    assert.throws(() => cleanFacebookGroupValues(values({ url: "facebook.com/groups/1" })), /web address/);
    assert.throws(() => cleanFacebookGroupValues(values({ url: "javascript:alert(1)" })), /web address/);
  });

  it("keeps the template's and the note's own line breaks, trimming only around them", () => {
    const clean = cleanFacebookGroupValues(
      values({ postTemplate: "  {lot}\n{description}\n\nStart {startingPrice}  ", standingNote: "\nShipping 5 zł\n" })
    );
    assert.equal(clean.postTemplate, "{lot}\n{description}\n\nStart {startingPrice}");
    assert.equal(clean.standingNote, "Shipping 5 zł");
  });

  describe("the starting price", () => {
    it("takes an amount, rounded to two decimals", () => {
      const clean = cleanFacebookGroupValues(values({ startingPriceMode: "amount", startingPriceValue: 1.005 }));
      assert.equal(clean.startingPriceMode, "amount");
      assert.equal(clean.startingPriceValue, 1.01);
    });

    it("takes a percentage of catalogue value, above 100 included", () => {
      const clean = cleanFacebookGroupValues(values({ startingPriceMode: "catalogPercent", startingPriceValue: 120 }));
      assert.equal(clean.startingPriceValue, 120);
    });

    it("refuses a mode with no figure, and a percentage past the bound", () => {
      assert.throws(
        () => cleanFacebookGroupValues(values({ startingPriceMode: "amount", startingPriceValue: null })),
        /what the starting price is/
      );
      assert.throws(
        () => cleanFacebookGroupValues(values({ startingPriceMode: "catalogPercent", startingPriceValue: 1001 })),
        /at most 1000%/
      );
      assert.throws(
        () => cleanFacebookGroupValues(values({ startingPriceMode: "amount", startingPriceValue: 0 })),
        /more than 0/
      );
    });

    it("clears a figure left behind once the mode is no default", () => {
      const clean = cleanFacebookGroupValues(values({ startingPriceMode: null, startingPriceValue: 5 }));
      assert.equal(clean.startingPriceValue, null);
    });

    it("refuses a mode it does not know", () => {
      assert.throws(
        () =>
          cleanFacebookGroupValues(
            values({ startingPriceMode: "bogus" as unknown as "amount", startingPriceValue: 5 })
          ),
        /Unknown kind/
      );
    });
  });

  it("takes an increment above 0 and refuses one at 0", () => {
    assert.equal(cleanFacebookGroupValues(values({ bidIncrement: 0.5 })).bidIncrement, 0.5);
    assert.throws(() => cleanFacebookGroupValues(values({ bidIncrement: 0 })), /increment must be more than 0/);
  });

  it("holds the length of an auction to whole days in bounds", () => {
    assert.equal(cleanFacebookGroupValues(values({ auctionDays: 7 })).auctionDays, 7);
    assert.equal(cleanFacebookGroupValues(values({ auctionDays: Number.NaN })).auctionDays, null);
    for (const bad of [0, 1.5, FACEBOOK_AUCTION_DAYS_MAX + 1]) {
      assert.throws(() => cleanFacebookGroupValues(values({ auctionDays: bad })), /whole number of days/);
    }
  });

  it("stores the closing time as HH:MM and refuses anything else", () => {
    assert.equal(cleanFacebookGroupValues(values({ closingTime: "9:30" })).closingTime, "09:30");
    assert.equal(cleanFacebookGroupValues(values({ closingTime: " " })).closingTime, null);
    assert.throws(() => cleanFacebookGroupValues(values({ closingTime: "24:00" })), /time of day/);
    assert.throws(() => cleanFacebookGroupValues(values({ closingTime: "8pm" })), /time of day/);
  });

  it("upper-cases a currency code, refuses a non-code, and leaves null as the platform's", () => {
    assert.equal(cleanFacebookGroupValues(values({ currency: "eur" })).currency, "EUR");
    assert.equal(cleanFacebookGroupValues(values({ currency: "" })).currency, null);
    assert.throws(() => cleanFacebookGroupValues(values({ currency: "euro" })), /three-letter code/);
  });
});

describe("normalizeClosingTime", () => {
  it("pads the hour and keeps the minute", () => {
    assert.equal(normalizeClosingTime("0:05"), "00:05");
    assert.equal(normalizeClosingTime("23:59"), "23:59");
    assert.equal(normalizeClosingTime("20:60"), null);
    assert.equal(normalizeClosingTime("2000"), null);
  });
});

describe("isFacebookGroupUrl", () => {
  it("takes any http(s) address with a host — Facebook writes one group several ways", () => {
    assert.equal(isFacebookGroupUrl("https://m.facebook.com/groups/znaczki"), true);
    assert.equal(isFacebookGroupUrl("http://fb.com/groups/1"), true);
    assert.equal(isFacebookGroupUrl("ftp://facebook.com/groups/1"), false);
    assert.equal(isFacebookGroupUrl("not a url"), false);
  });
});

describe("post template placeholders", () => {
  it("are the six the issue settled, in the {token} spelling", () => {
    assert.deepEqual(
      FACEBOOK_POST_PLACEHOLDERS.map((p) => p.token),
      ["{description}", "{catalog}", "{startingPrice}", "{increment}", "{closesAt}", "{lot}"]
    );
  });

  it("names a token the post does not know, once, and nothing else", () => {
    assert.deepEqual(unknownPostPlaceholders("{lot} {startprice} {lot} {startprice} {catalog}"), ["{startprice}"]);
    assert.deepEqual(unknownPostPlaceholders("Lot {lot}: {description}"), []);
  });
});
