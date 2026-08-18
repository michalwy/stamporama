// The rules a Delcampe listing profile is written by (#608; ADR-0034) — pure, no Prisma and no
// `server-only`, because the settings editor is a client component and builds its fields from the
// very lists the domain layer validates against (the `allegro-listing-profile-vocabulary.ts` rule).
//
// What lives here is everything that can be decided without a database: the seeded defaults, the
// promotion columns Delcampe's upload file demands a letter for, the one rule that is not a stored
// value at all — the **bid step** — the second duration group an auction row is written from
// (#620), and the cleaning every write goes through.
//
// Nothing here formats a CSV. How a figure is written into the file (a decimal **comma** on the way
// up, a dot on the way back down) is the export's own business (#610); this module answers *what*
// the row says, never how it is spelled.

/** How long a **fixed-price** listing runs before it renews itself, in days, and how many times it
 *  may. Delcampe's shop-stock behaviour: a listing that simply stays up until it sells. An auction
 *  takes its own two figures from the profile's auction group instead (#620), which is seeded with
 *  nothing at all — see {@link delcampeAuctionGaps}. */
export const DELCAMPE_RENEW_DURATION_DEFAULT = 28;
export const DELCAMPE_RENEW_TOTAL_COUNT_DEFAULT = 99;

/** Sanity bounds, and stated as such: Delcampe's own ceilings are not published anywhere this app
 *  can read, and the upload is the authority on them. These only stop a typo becoming a file that is
 *  rejected after being built — a value Delcampe refuses is still Delcampe's answer to give. */
export const DELCAMPE_RENEW_DURATION_MAX = 365;
export const DELCAMPE_RENEW_TOTAL_COUNT_MAX = 999;

/** The seeded bid-step rule (#608): `0,01` was observed on cheap items and `0,10` on dearer ones.
 *  The threshold between them was never confirmed against Delcampe, which is exactly why it is a
 *  stored field seeded with a plausible figure rather than a constant compiled into the exporter. */
export const DELCAMPE_MIN_BID_STEP_THRESHOLD_DEFAULT = 1;
export const DELCAMPE_MIN_BID_STEP_BELOW_DEFAULT = 0.01;
export const DELCAMPE_MIN_BID_STEP_AT_OR_ABOVE_DEFAULT = 0.1;

/**
 * Delcampe's five paid promotion columns, in the file's own order.
 *
 * Named here — with the CSV column beside the label — because the upload file demands a `Y`/`N` for
 * every one of them, so an exporter that simply wrote `N` would be making a decision that costs
 * money and leaving no trace of who made it. All of them are off today.
 */
export const DELCAMPE_PROMOTION_OPTIONS = [
  { key: "optionStrongTitle", column: "option_strong_title", label: "Bold title" },
  { key: "optionBackgroundColor", column: "option_background_color", label: "Background colour" },
  { key: "optionBorderColor", column: "option_border_color", label: "Border colour" },
  { key: "optionListPromotion", column: "option_list_promotion", label: "Promoted in lists" },
  { key: "optionHomepagePromotion", column: "option_homepage_promotion", label: "Promoted on the home page" },
] as const satisfies readonly { key: string; column: string; label: string }[];

export type DelcampePromotionKey = (typeof DELCAMPE_PROMOTION_OPTIONS)[number]["key"];

/** The bid-step half of a profile on its own — what {@link delcampeMinimumBidStep} needs and all it
 *  needs, so the rule can be asked of a plain object and unit-tested without a profile. */
export interface DelcampeBidStepRule {
  threshold: number;
  below: number;
  atOrAbove: number;
}

/**
 * The `minimum_bid_step` one row is written with, for a listing priced at `price`.
 *
 * A **threshold rule** and not a constant, which is the whole reason the three figures are stored:
 * cheap items were observed at `0,01` and dearer ones at `0,10`. The boundary is inclusive at the
 * top — a listing priced exactly at the threshold takes the larger step — stated once here so the
 * export, the settings preview and any later reader cannot each pick their own reading of "more
 * expensive".
 */
export function delcampeMinimumBidStep(price: number, rule: DelcampeBidStepRule): number {
  return price < rule.threshold ? rule.below : rule.atOrAbove;
}

/** A profile's values, as the editor holds them and the domain layer stores them. Money and counts
 *  are plain numbers here: `Decimal` is Prisma's, and this module is read by the browser. */
export interface DelcampeListingProfileValues {
  name: string;
  shippingModel: string;
  renewDuration: number;
  renewTotalCount: number;
  hasRenewableOptions: boolean;
  optionStrongTitle: boolean;
  optionBackgroundColor: boolean;
  optionBorderColor: boolean;
  optionListPromotion: boolean;
  optionHomepagePromotion: boolean;
  minBidStepThreshold: number;
  minBidStepBelow: number;
  minBidStepAtOrAbove: number;
  /** The auction group (#620): what an `auction` row's `renew_duration` and `renew_total_count`
   *  say, in place of the two shop-stock figures above. Null is "not stated yet", which is what
   *  every profile starts as and what an auction export refuses on. */
  auctionDuration: number | null;
  auctionRenewTotalCount: number | null;
  /** `sale_end_day` and `sale_end_time`, written into the row **verbatim**. Unvalidatable for the
   *  shipping model's reason (ADR-0034 §2): the spelling Easy Uploader wants is published nowhere
   *  this app can read. Empty is allowed and states no end at all. */
  auctionEndDay: string;
  auctionEndTime: string;
}

/** What a new profile starts as — the observed live values, so the first profile a collector writes
 *  needs a name and a shipping model and nothing else.
 *
 *  The auction group is the exception and is seeded with **nothing**: every other figure here was
 *  observed on the collector's own live listings, and there are no auctions to observe. A default
 *  would be this app inventing how long somebody's auctions run, which is the one guess a settings
 *  field cannot make safe — an unstated duration is refused at export and read back as such, while a
 *  plausible one goes up unnoticed. */
export const DELCAMPE_PROFILE_DEFAULTS: Omit<DelcampeListingProfileValues, "name" | "shippingModel"> = {
  renewDuration: DELCAMPE_RENEW_DURATION_DEFAULT,
  renewTotalCount: DELCAMPE_RENEW_TOTAL_COUNT_DEFAULT,
  hasRenewableOptions: false,
  optionStrongTitle: false,
  optionBackgroundColor: false,
  optionBorderColor: false,
  optionListPromotion: false,
  optionHomepagePromotion: false,
  minBidStepThreshold: DELCAMPE_MIN_BID_STEP_THRESHOLD_DEFAULT,
  minBidStepBelow: DELCAMPE_MIN_BID_STEP_BELOW_DEFAULT,
  minBidStepAtOrAbove: DELCAMPE_MIN_BID_STEP_AT_OR_ABOVE_DEFAULT,
  auctionDuration: null,
  auctionRenewTotalCount: null,
  auctionEndDay: "",
  auctionEndTime: "",
};

function requireCount(value: number, max: number, field: string): number {
  if (!Number.isInteger(value) || value < 1 || value > max) {
    throw new Error(`${field} must be a whole number between 1 and ${max}.`);
  }
  return value;
}

/** A count that may simply not have been stated — the auction group's two figures, which are blank
 *  until the collector types them. `null` passes through; anything typed is held to the same bounds
 *  a stated count is. */
function optionalCount(value: number | null, max: number, field: string): number | null {
  if (value == null || Number.isNaN(value)) return null;
  return requireCount(value, max, field);
}

function requireAmount(value: number, field: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${field} must be an amount of 0 or more.`);
  }
  // Delcampe's file carries two decimals, and a third one stored here would be silently rounded on
  // the way out — a figure that reads one way in Settings and another in the upload.
  return Math.round(value * 100) / 100;
}

/**
 * The only validation a save does.
 *
 * The **shipping model is deliberately not validated** beyond being present: it is the name of a
 * model defined on Delcampe, the CSV carries that name and no id, and `GET /shippingModels` is
 * behind the API Pass this integration does not buy (ADR-0034 §2). There is nothing here to check it
 * against, and a check that only compared it to a list this app made up would be worse than none.
 */
export function cleanDelcampeListingProfileValues(
  input: DelcampeListingProfileValues
): DelcampeListingProfileValues {
  const name = input.name.trim();
  if (!name) throw new Error("A profile needs a name.");

  const shippingModel = input.shippingModel.trim();
  if (!shippingModel) {
    throw new Error(
      "A profile needs a shipping model — Delcampe's upload names one on every row, by its name."
    );
  }

  const minBidStepBelow = requireAmount(input.minBidStepBelow, "The lower bid step");
  const minBidStepAtOrAbove = requireAmount(input.minBidStepAtOrAbove, "The upper bid step");
  if (minBidStepBelow <= 0 || minBidStepAtOrAbove <= 0) {
    throw new Error("Both bid steps must be more than 0 — every row states one.");
  }

  return {
    name,
    shippingModel,
    renewDuration: requireCount(
      input.renewDuration,
      DELCAMPE_RENEW_DURATION_MAX,
      "The renewal duration"
    ),
    renewTotalCount: requireCount(
      input.renewTotalCount,
      DELCAMPE_RENEW_TOTAL_COUNT_MAX,
      "The renewal count"
    ),
    hasRenewableOptions: input.hasRenewableOptions,
    optionStrongTitle: input.optionStrongTitle,
    optionBackgroundColor: input.optionBackgroundColor,
    optionBorderColor: input.optionBorderColor,
    optionListPromotion: input.optionListPromotion,
    optionHomepagePromotion: input.optionHomepagePromotion,
    minBidStepThreshold: requireAmount(input.minBidStepThreshold, "The bid-step threshold"),
    minBidStepBelow,
    minBidStepAtOrAbove,
    // The auction group is optional as a *group of two*: a profile that never uploads an auction is
    // the ordinary case and must stay savable. What is checked is each figure that was stated, on
    // the same bounds the shop-stock ones take — a run of 0 days is a typo either way round.
    auctionDuration: optionalCount(
      input.auctionDuration,
      DELCAMPE_RENEW_DURATION_MAX,
      "The auction duration"
    ),
    auctionRenewTotalCount: optionalCount(
      input.auctionRenewTotalCount,
      DELCAMPE_RENEW_TOTAL_COUNT_MAX,
      "The auction renewal count"
    ),
    // Trimmed and otherwise taken as typed. There is nothing to check them against, and a check
    // against a format this app invented would refuse the correct answer as confidently as a wrong
    // one — the shipping model's rule, and the reason it is said out loud in the editor.
    auctionEndDay: input.auctionEndDay.trim(),
    auctionEndTime: input.auctionEndTime.trim(),
  };
}

/**
 * What an **auction** row still cannot be written from, phrased as the things themselves.
 *
 * One list rather than a check per surface: the export refuses with it, and the settings editor
 * reads back the same sentence — so "this profile is not ready for auctions" cannot be true in one
 * place and false in the other. Empty means an auction row can be written.
 *
 * The two end cells are deliberately **not** in it. A blank closing day is a row that states no end
 * and lets Delcampe take the duration's own, which is a listing rather than a fault; a blank
 * duration is a column the file has no value for at all.
 */
export function delcampeAuctionGaps(values: {
  auctionDuration: number | null;
  auctionRenewTotalCount: number | null;
}): string[] {
  const gaps: string[] = [];
  if (values.auctionDuration == null) gaps.push("how many days it runs");
  if (values.auctionRenewTotalCount == null) gaps.push("how many times it may renew");
  return gaps;
}

/** How many of the five paid promotions a profile buys — the summary line's figure, and the one
 *  thing about them worth stating at a glance, since all five off is the ordinary case. */
export function countDelcampePromotions(values: {
  optionStrongTitle: boolean;
  optionBackgroundColor: boolean;
  optionBorderColor: boolean;
  optionListPromotion: boolean;
  optionHomepagePromotion: boolean;
}): number {
  return DELCAMPE_PROMOTION_OPTIONS.filter((option) => values[option.key]).length;
}
