import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { FACEBOOK_GROUP_SETTINGS } from "../../src/lib/facebook-group-rules";
import {
  FACEBOOK_SETTINGS_CASES,
  facebookCaseSettings,
  facebookCustomCases,
  facebookSettingCase,
  parseFacebookSettingsCase,
} from "../../src/app/c/[collectionSlug]/settings/facebook-settings-cases";
import { settingsSearch } from "../../src/app/c/[collectionSlug]/settings/settings-nav";

/**
 * Settings → Facebook in tabs by case (#1849): five tabs, each holding exactly the settings the
 * collector listed and nothing else, a group's tab marked when it holds one of its own settings, and
 * the tab shown kept in the address while moving between the defaults and the groups.
 */

describe("Facebook settings tabs (#1849)", () => {
  it("are the five cases, General first", () => {
    assert.deepEqual(
      FACEBOOK_SETTINGS_CASES.map((c) => c.label),
      ["General", "Auctions", "Quick buys", "Several-lot posts", "Buyer messages"]
    );
  });

  // The split decided with the collector on 2026-10-12, setting by setting.
  it("hold exactly the settings listed for each case", () => {
    const sorted = (keys: string[]) => [...keys].sort();
    assert.deepEqual(
      sorted(facebookCaseSettings("general")),
      sorted(["listingType", "currency", "mixedListingTypes", "standingNote"])
    );
    assert.deepEqual(
      sorted(facebookCaseSettings("auctions")),
      sorted([
        "startingPrice",
        "bidIncrement",
        "auctionDays",
        "closingTime",
        "postTemplate",
        "auctionCaptionTemplate",
      ])
    );
    assert.deepEqual(
      sorted(facebookCaseSettings("quick-buys")),
      sorted(["refreshQuickBuysAfterDays", "quickBuyTemplate", "quickBuyCaptionTemplate"])
    );
    assert.deepEqual(
      sorted(facebookCaseSettings("several-lots")),
      sorted(["multiLotLayout", "captionPostTemplate"])
    );
    assert.deepEqual(facebookCaseSettings("buyer-messages"), ["buyerMessageTemplate"]);
  });

  it("put every followed setting on one tab, once", () => {
    const all = FACEBOOK_SETTINGS_CASES.flatMap((c) => facebookCaseSettings(c.key));
    assert.equal(all.length, FACEBOOK_GROUP_SETTINGS.length);
    assert.deepEqual(new Set(all), new Set(FACEBOOK_GROUP_SETTINGS));
    for (const s of FACEBOOK_GROUP_SETTINGS) {
      assert.ok(facebookCaseSettings(facebookSettingCase(s)).includes(s), s);
    }
  });

  it("mark the tabs holding a group's own settings, and only those", () => {
    assert.deepEqual(facebookCustomCases([]), new Set());
    assert.deepEqual(
      facebookCustomCases(["auctionCaptionTemplate", "closingTime", "buyerMessageTemplate"]),
      new Set(["auctions", "buyer-messages"])
    );
  });

  it("read the tab from the address, General for none or an unknown one", () => {
    assert.equal(parseFacebookSettingsCase(null), "general");
    assert.equal(parseFacebookSettingsCase("nonsense"), "general");
    assert.equal(parseFacebookSettingsCase("quick-buys"), "quick-buys");
  });

  // The tab is a view of the Facebook page: it follows the row, not the collector onto another page.
  it("are dropped from the address on leaving the page", () => {
    const view = new URLSearchParams("tab=facebook&row=facebook%3Adefaults&case=auctions");
    assert.equal(settingsSearch(view, "delcampe", null), "?tab=delcampe");
  });
});
