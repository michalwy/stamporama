/**
 * The tabs of Settings → Facebook's pane (#1849, amending #1801's grid): **one tab per case**, each
 * holding everything for that case and nothing else — kept apart from the component so the split can
 * be tested without rendering anything.
 *
 * Every followed setting (`FACEBOOK_GROUP_SETTINGS`) is on exactly one tab, which is what lets a
 * group's tab be marked when it holds a custom setting, and a link to a setting open the tab it is on.
 */

import { FACEBOOK_GROUP_SETTINGS, type FacebookGroupSetting } from "@/lib/facebook-group-rules";

/** The pane's tabs, in the order a post is thought through; the first is the default. */
export const FACEBOOK_SETTINGS_CASES = [
  { key: "general", label: "General" },
  { key: "auctions", label: "Auctions" },
  { key: "quick-buys", label: "Quick buys" },
  { key: "several-lots", label: "Several-lot posts" },
  { key: "buyer-messages", label: "Buyer messages" },
] as const;

export type FacebookSettingsCase = (typeof FACEBOOK_SETTINGS_CASES)[number]["key"];

/** The tab shown — `&case=auctions` — kept while moving between the defaults and the groups, so the
 *  collector compares one case across them; a link to a setting opens its tab. */
export const FACEBOOK_CASE_PARAM = "case";

/** Which tab each followed setting is on. A `Record`, so a new setting without a tab does not
 *  compile. */
const SETTING_CASE: Readonly<Record<FacebookGroupSetting, FacebookSettingsCase>> = {
  listingType: "general",
  currency: "general",
  mixedListingTypes: "general",
  standingNote: "general",
  startingPrice: "auctions",
  bidIncrement: "auctions",
  auctionDays: "auctions",
  closingTime: "auctions",
  postTemplate: "auctions",
  auctionCaptionTemplate: "auctions",
  refreshQuickBuysAfterDays: "quick-buys",
  quickBuyTemplate: "quick-buys",
  quickBuyCaptionTemplate: "quick-buys",
  multiLotLayout: "several-lots",
  captionPostTemplate: "several-lots",
  buyerMessageTemplate: "buyer-messages",
};

/** The tab a setting is on. */
export function facebookSettingCase(setting: FacebookGroupSetting): FacebookSettingsCase {
  return SETTING_CASE[setting];
}

/** The settings on one tab, in `FACEBOOK_GROUP_SETTINGS`' order. */
export function facebookCaseSettings(key: FacebookSettingsCase): FacebookGroupSetting[] {
  return FACEBOOK_GROUP_SETTINGS.filter((s) => SETTING_CASE[s] === key);
}

/** The tab an address names; the first for none or one that is not a tab. */
export function parseFacebookSettingsCase(raw: string | null): FacebookSettingsCase {
  return FACEBOOK_SETTINGS_CASES.find((c) => c.key === raw)?.key ?? FACEBOOK_SETTINGS_CASES[0].key;
}

/** The tabs holding any of a group's own settings — the ones its pane marks. */
export function facebookCustomCases(custom: readonly FacebookGroupSetting[]): Set<FacebookSettingsCase> {
  return new Set(custom.map(facebookSettingCase));
}
