import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  FACEBOOK_AUCTION_DAYS_MAX,
  FACEBOOK_BLANK_SETTINGS,
  FACEBOOK_GROUP_DEFAULTS,
  FACEBOOK_GROUP_SETTINGS,
  FACEBOOK_AUCTION_PLACEHOLDERS,
  FACEBOOK_QUICK_BUY_PLACEHOLDERS,
  cleanFacebookDefaults,
  cleanFacebookGroupValues,
  effectiveFacebookGroupSettings,
  isFacebookGroupUrl,
  normalizeClosingTime,
  retiredPostPlaceholders,
  standingNoteUnused,
  toFacebookListingType,
  unknownPostPlaceholders,
  usesRetiredPostPlaceholder,
  type FacebookGroupValues,
} from "../../src/lib/facebook-group-rules";

// A Facebook group's settings (#1543; ADR-0061): every default optional, and what is stated held to
// its shape — and, since #1661, each setting either the group's own or following the platform's. The
// database half — the platform marker, archive, the delete refused while offers name
// the group — is `tests/integration/facebook-groups.test.ts`.

// Every setting the group's own, so what is sent is what is cleaned — the shape rules below are the
// rules a custom setting is held to. What following the platform does is its own block.
function values(overrides: Partial<FacebookGroupValues> = {}): FacebookGroupValues {
  return {
    ...FACEBOOK_GROUP_DEFAULTS,
    name: "Znaczki — aukcje",
    url: "https://www.facebook.com/groups/123456",
    custom: [...FACEBOOK_GROUP_SETTINGS],
    currency: "PLN",
    ...overrides,
  };
}

describe("cleanFacebookGroupValues (#1543)", () => {
  it("accepts a group with a name and a link and nothing else, following the platform throughout", () => {
    const clean = cleanFacebookGroupValues({
      ...FACEBOOK_GROUP_DEFAULTS,
      name: " Znaczki — aukcje ",
      url: "https://www.facebook.com/groups/123456",
    });
    assert.deepEqual(clean, {
      ...FACEBOOK_GROUP_DEFAULTS,
      name: "Znaczki — aukcje",
      url: "https://www.facebook.com/groups/123456",
    });
    assert.deepEqual(clean.custom, []);
  });

  it("refuses a group without a name or without a link", () => {
    assert.throws(() => cleanFacebookGroupValues(values({ name: "  " })), /needs a name/);
    assert.throws(() => cleanFacebookGroupValues(values({ url: "" })), /needs its link/);
  });

  it("refuses a link that is not a web address", () => {
    assert.throws(() => cleanFacebookGroupValues(values({ url: "facebook.com/groups/1" })), /web address/);
    assert.throws(() => cleanFacebookGroupValues(values({ url: "javascript:alert(1)" })), /web address/);
  });

  it("takes a quick buy as the listing type, its template and post mixing, and refuses another type (#1671)", () => {
    const clean = cleanFacebookGroupValues(
      values({ listingType: "fixed", quickBuyTemplate: " {title} — {price} ", mixedListingTypes: true })
    );
    assert.equal(clean.listingType, "fixed");
    assert.equal(clean.quickBuyTemplate, "{title} — {price}");
    assert.equal(clean.mixedListingTypes, true);
    assert.throws(
      () => cleanFacebookGroupValues(values({ listingType: "barter" as unknown as "fixed" })),
      /Unknown listing type/
    );
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

  it("upper-cases a custom currency code, and refuses a non-code or none", () => {
    assert.equal(cleanFacebookGroupValues(values({ currency: "eur" })).currency, "EUR");
    assert.throws(() => cleanFacebookGroupValues(values({ currency: "" })), /own currency/);
    assert.throws(() => cleanFacebookGroupValues(values({ currency: null })), /own currency/);
    assert.throws(() => cleanFacebookGroupValues(values({ currency: "euro" })), /three-letter code/);
  });
});

describe("a group following the platform (#1661)", () => {
  it("stores a followed setting blank whatever was sent, and keeps a custom one", () => {
    const clean = cleanFacebookGroupValues(
      values({
        custom: ["standingNote", "bidIncrement"],
        listingType: "fixed",
        mixedListingTypes: true,
        postTemplate: "{description}",
        quickBuyTemplate: "{title} {price}",
        standingNote: "Shipping 5 zł",
        startingPriceMode: "amount",
        startingPriceValue: 5,
        bidIncrement: 1,
        auctionDays: 7,
        closingTime: "20:00",
        currency: "EUR",
      })
    );
    assert.deepEqual(clean, {
      name: "Znaczki — aukcje",
      url: "https://www.facebook.com/groups/123456",
      ...FACEBOOK_BLANK_SETTINGS,
      standingNote: "Shipping 5 zł",
      bidIncrement: 1,
      currency: null,
      custom: ["standingNote", "bidIncrement"],
    });
  });

  it("does not check the shape of a setting it follows — the field was never shown", () => {
    const clean = cleanFacebookGroupValues(
      values({ custom: [], closingTime: "8pm", auctionDays: 0, currency: "euro" })
    );
    assert.equal(clean.closingTime, null);
    assert.equal(clean.auctionDays, null);
    assert.equal(clean.currency, null);
  });

  it("keeps each custom key once, in the one order, and refuses one it does not know", () => {
    assert.deepEqual(
      cleanFacebookGroupValues(values({ custom: ["currency", "postTemplate", "currency"] })).custom,
      ["postTemplate", "currency"]
    );
    assert.throws(
      () => cleanFacebookGroupValues(values({ custom: ["name" as unknown as "postTemplate"] })),
      /Unknown group setting/
    );
  });
});

describe("cleanFacebookDefaults (#1661)", () => {
  it("holds the platform's settings to a group's rules", () => {
    assert.deepEqual(cleanFacebookDefaults(FACEBOOK_BLANK_SETTINGS), FACEBOOK_BLANK_SETTINGS);
    assert.deepEqual(
      cleanFacebookDefaults({
        listingType: "fixed",
        mixedListingTypes: true,
        postTemplate: "  {description}\n{closesAt} ",
        quickBuyTemplate: " {title}\n{price} ",
        standingNote: "",
        startingPriceMode: "catalogPercent",
        startingPriceValue: 30,
        bidIncrement: 0.5,
        auctionDays: 7,
        closingTime: "9:00",
      }),
      {
        listingType: "fixed",
        mixedListingTypes: true,
        postTemplate: "{description}\n{closesAt}",
        quickBuyTemplate: "{title}\n{price}",
        standingNote: "",
        startingPriceMode: "catalogPercent",
        startingPriceValue: 30,
        bidIncrement: 0.5,
        auctionDays: 7,
        closingTime: "09:00",
      }
    );
    assert.throws(
      () => cleanFacebookDefaults({ ...FACEBOOK_BLANK_SETTINGS, startingPriceMode: "amount" }),
      /what the starting price is/
    );
    assert.throws(
      () => cleanFacebookDefaults({ ...FACEBOOK_BLANK_SETTINGS, closingTime: "25:00" }),
      /time of day/
    );
  });
});

describe("effectiveFacebookGroupSettings (#1661)", () => {
  const platform = {
    listingType: "fixed" as const,
    mixedListingTypes: true,
    postTemplate: "Platform {description}",
    quickBuyTemplate: "Platform {price}",
    standingNote: "Platform terms",
    startingPriceMode: "amount" as const,
    startingPriceValue: 5,
    bidIncrement: 1,
    auctionDays: 7,
    closingTime: "20:00",
  };

  it("reads every setting from the platform for a group that follows it throughout", () => {
    assert.deepEqual(
      effectiveFacebookGroupSettings({ ...FACEBOOK_BLANK_SETTINGS, currency: null, custom: [] }, platform),
      { ...platform, currency: null }
    );
  });

  it("reads a custom setting from the group — a custom *none* included", () => {
    const group = {
      ...FACEBOOK_BLANK_SETTINGS,
      standingNote: "Group terms",
      currency: "EUR",
      custom: ["standingNote", "startingPrice", "closingTime", "currency", "listingType", "mixedListingTypes"],
    };
    assert.deepEqual(effectiveFacebookGroupSettings(group, platform), {
      listingType: "auction",
      mixedListingTypes: false,
      postTemplate: "Platform {description}",
      quickBuyTemplate: "Platform {price}",
      standingNote: "Group terms",
      startingPriceMode: null,
      startingPriceValue: null,
      bidIncrement: 1,
      auctionDays: 7,
      closingTime: null,
      currency: "EUR",
    });
  });

  it("leaves the currency null — the platform's — on a group that follows it, whatever is stored", () => {
    assert.equal(
      effectiveFacebookGroupSettings({ ...FACEBOOK_BLANK_SETTINGS, currency: "EUR", custom: [] }, platform)
        .currency,
      null
    );
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
  it("are an auction's settled ones with {title} and {terms}, and no longer {catalog} (#1543, #1671, #1689)", () => {
    assert.deepEqual(
      FACEBOOK_AUCTION_PLACEHOLDERS.map((p) => p.token),
      ["{title}", "{description}", "{startingPrice}", "{increment}", "{closesAt}", "{lot}", "{terms}"]
    );
  });

  it("are a quick buy's own: its price where an auction states its bidding (#1671), and {terms} (#1689)", () => {
    assert.deepEqual(
      FACEBOOK_QUICK_BUY_PLACEHOLDERS.map((p) => p.token),
      ["{title}", "{description}", "{price}", "{lot}", "{terms}"]
    );
  });

  it("names a token the post does not know, once, and nothing else — a retired one is not unknown", () => {
    assert.deepEqual(unknownPostPlaceholders("{lot} {startprice} {lot} {startprice} {catalog}", "auction"), ["{startprice}"]);
    assert.deepEqual(unknownPostPlaceholders("Lot {lot}: {title} {description}", "auction"), []);
  });

  it("names the other type's tokens as unknown in a template (#1671)", () => {
    assert.deepEqual(unknownPostPlaceholders("{title} {price} {closesAt}", "fixed"), ["{closesAt}"]);
    assert.deepEqual(unknownPostPlaceholders("{title} {price} {closesAt}", "auction"), ["{price}"]);
  });

  it("flags a template still carrying {catalog} (#1671)", () => {
    assert.deepEqual(retiredPostPlaceholders("{catalog} {title} {catalog}"), ["{catalog}"]);
    assert.deepEqual(retiredPostPlaceholders("{title}"), []);
    assert.equal(usesRetiredPostPlaceholder({ postTemplate: "{title}", quickBuyTemplate: "{catalog}" }), true);
    assert.equal(usesRetiredPostPlaceholder({ postTemplate: "{title}", quickBuyTemplate: "" }), false);
  });
});

describe("the note on shipping, payment and terms (#1689)", () => {
  it("is flagged when it is set and neither template has {terms}", () => {
    const note = "Shipping 7 PLN";
    assert.equal(standingNoteUnused({ postTemplate: "{title}", quickBuyTemplate: "{price}", standingNote: note }), true);
    assert.equal(standingNoteUnused({ postTemplate: "{title}", quickBuyTemplate: "{price} {terms}", standingNote: note }), false);
    // A blank template places nothing either: the note is only where `{terms}` puts it.
    assert.equal(standingNoteUnused({ postTemplate: "{title}", quickBuyTemplate: "", standingNote: note }), true);
  });

  it("is not flagged when there is no note to place", () => {
    assert.equal(standingNoteUnused({ postTemplate: "{title}", quickBuyTemplate: "{price}", standingNote: "  " }), false);
  });

  it("is not an unknown token in either template", () => {
    assert.deepEqual(unknownPostPlaceholders("{title} {terms}", "auction"), []);
    assert.deepEqual(unknownPostPlaceholders("{title} {terms}", "fixed"), []);
  });
});

describe("toFacebookListingType (#1671)", () => {
  it("reads a quick buy as itself and anything else as the auction every older offer was", () => {
    assert.equal(toFacebookListingType("fixed"), "fixed");
    assert.equal(toFacebookListingType("auction"), "auction");
    assert.equal(toFacebookListingType(null), "auction");
  });
});
