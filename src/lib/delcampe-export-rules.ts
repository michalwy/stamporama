// The Easy Uploader file itself (#610) — pure, no Prisma and no `server-only`, so the row a batch
// will be uploaded as can be asserted in a unit test and, one day, previewed on a screen.
//
// This is the **writer's** half of a contract whose two directions are not symmetric (ADR-0034 §5):
// the upload file spells a decimal with a **comma** (`"0,10"`), while Delcampe's own active-items
// export returns it with a dot (`17.44`, #611). Neither module knows about the other's spelling, and
// this one owns nothing but the upload.
//
// What is deliberately **not** here:
//
//   * **The ongoing-sales ceiling.** Delcampe caps how many sales a seller may have running, by
//     subscription package, and #610 first proposed refusing an export that would exceed it. It is
//     not checked and not stored: this app cannot see the live count — listings are created from
//     files uploaded by hand, ended by buyers, and relisted by Delcampe itself — so anything it
//     counted would be its own offers, not the seller's sales, and a refusal built on that number
//     would block a legitimate batch as confidently as it let an over-full one through. Keeping the
//     batch inside the package is the collector's, and it is stated as theirs in the user guide.
//   * **Where an auction's figures come from.** `selling_type` is the offer's own listing type
//     (#449) and an auction's `price` is its **starting** price, never the standing bid — #477's
//     rule, and the reason the two are separate columns on the offer at all: a current price is an
//     observation of the bidding, and writing it into a new listing would state an offer nobody
//     made. The duration and the two end cells are the profile's auction group (#620; ADR-0034 §7),
//     which this module reads and does not second-guess.
//   * **Where the pictures come from.** The names in `images` are the photo plan's own (#314/#326),
//     handed in by the caller — this module never invents a file name.

import {
  DELCAMPE_PROMOTION_OPTIONS,
  type DelcampeListingProfileValues,
  delcampeMinimumBidStep,
} from "./delcampe-listing-profile-rules";
import { isAuctionListing, type OfferListingType } from "./offer-rules";

/**
 * The upload file's columns, in Delcampe's own order (#608).
 *
 * The order is part of the contract as much as the names are, so it is stated once and the header
 * row and every data row are both built from this list — a row that reordered itself would be a file
 * whose header lies about its own columns.
 */
export const DELCAMPE_UPLOAD_COLUMNS = [
  "category_id",
  "title",
  "personal_reference",
  "description",
  "selling_type",
  "price",
  "minimum_bid_step",
  "initial_quantity",
  "images",
  "renew_duration",
  "renew_total_count",
  "sale_end_time",
  "sale_end_day",
  "shipping_model",
  "weight",
  "option_strong_title",
  "option_background_color",
  "option_border_color",
  "option_list_promotion",
  "option_homepage_promotion",
  "has_renewable_options",
] as const;

export type DelcampeUploadColumn = (typeof DELCAMPE_UPLOAD_COLUMNS)[number];

/** One row, every column present. A `Record` rather than an array so a row can be read by column
 *  name in a test and in the assembler, while {@link toDelcampeCsv} is the only thing that knows
 *  what order they go out in. */
export type DelcampeUploadRow = Record<DelcampeUploadColumn, string>;

/** The two values `selling_type` takes, translated from what the offer already says about itself
 *  (#449) rather than chosen here — no listing carries a Delcampe-only flag saying how it is sold. */
export const DELCAMPE_FIXED_PRICE_SELLING_TYPE = "fixed_price";
export const DELCAMPE_AUCTION_SELLING_TYPE = "auction";

/** `selling_type` for one offer. */
export function delcampeSellingType(listingType: OfferListingType): string {
  return isAuctionListing(listingType)
    ? DELCAMPE_AUCTION_SELLING_TYPE
    : DELCAMPE_FIXED_PRICE_SELLING_TYPE;
}

/**
 * The figure the `price` column states: an auction's **starting** price, a quick buy's asking price.
 *
 * #477's rule, transferred verbatim from Allegro's `sellingMode` to a marketplace where the two
 * readings share one column on the offer (#449). An auction's `price` here is what the bidding has
 * reached — an *observation* — and a new listing written from it would state an opening figure
 * nobody offered, over and over as the bidding moved. What the seller states is `startingPrice`, and
 * that is the only thing a row may carry.
 *
 * Null on an auction that has no starting price, which is a refusal rather than a fallback: the
 * asking-price column is exactly the wrong number to reach for here.
 */
export function delcampeListedPrice(input: {
  listingType: OfferListingType;
  price: number;
  startingPrice: number | null;
}): number | null {
  return isAuctionListing(input.listingType) ? input.startingPrice : input.price;
}

/** The file the bundle carries, and the name it goes in under. */
export const DELCAMPE_UPLOAD_CSV_NAME = "delcampe-upload.csv";

/**
 * A figure as the **upload** file spells it: two decimals, comma separator (`0.1` → `"0,10"`).
 *
 * Always two, never a bare `"0,1"`: the file states money, and a price that reads as one digit of
 * cents is the kind of thing a spreadsheet in the middle would happily reinterpret. The rounding is
 * the same half-up the profile editor stores by, so a bid step of `0,10` in Settings is `0,10` here.
 */
export function delcampeDecimal(value: number): string {
  const rounded = Math.round((value + Number.EPSILON) * 100) / 100;
  return rounded.toFixed(2).replace(".", ",");
}

/** `Y` / `N`, the letters the file's flag columns take. */
export function delcampeFlag(value: boolean): string {
  return value ? "Y" : "N";
}

/**
 * One field as CSV.
 *
 * Quoted whenever it holds a separator, a quote, a line break or an edge space — which, given the
 * decimal comma above, is every money column in the file. Inner quotes are doubled, RFC 4180's own
 * rule and the one Delcampe's example file follows.
 */
function csvField(value: string): string {
  const needsQuotes = /[",\r\n]/.test(value) || value !== value.trim();
  return needsQuotes ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * The whole file: a header row naming the columns, then one row per listing, CRLF-separated.
 *
 * CRLF and a header because that is what Delcampe's own example is, and a file read by somebody
 * else's importer is the one place to be conventional rather than clever. No byte-order mark: the
 * text is UTF-8, and a BOM is a spreadsheet's convenience that a strict parser reads as part of the
 * first column's name.
 */
export function toDelcampeCsv(rows: readonly DelcampeUploadRow[]): string {
  const lines = [
    DELCAMPE_UPLOAD_COLUMNS.join(","),
    ...rows.map((row) => DELCAMPE_UPLOAD_COLUMNS.map((column) => csvField(row[column])).join(",")),
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/** Everything one row is written from: the offer's own facts, the profile #608 resolved for it, and
 *  the picture names the photo plan produced. Assembled by the domain layer, which is where each of
 *  the three comes from — this module only writes them down. */
export interface DelcampeUploadRowInput {
  /** `Offer.name` (#209) — the listing's own title, never the derived label: the label is a screen
   *  fallback and was not written for a marketplace. */
  title: string;
  /** The offer's short URL (#415/#416), which is what `personal_reference` carries so #611's
   *  reconciliation can match a listing back to an offer exactly. */
  personalReference: string;
  /** `Offer.description` (#266) as stored, empty where there is none — Delcampe accepts a listing
   *  without one, which is what the collector's live listings are. */
  description: string;
  categoryId: string;
  /** How this listing is sold (#449) — `fixed` or `auction`, which is what `selling_type` says and
   *  which of the profile's two duration groups the row is written from. */
  listingType: OfferListingType;
  /** The figure the `price` column states, in the platform's currency (#196): the asking price of a
   *  quick buy, the **starting** price of an auction (see {@link delcampeListedPrice}). The file
   *  carries no currency column — it is an account-level setting on Delcampe. */
  price: number;
  /** How many of this listing there are — the offer's set count. */
  quantity: number;
  /** The upload set's file names in plan order (#313/#326), pipe-separated into `images`. */
  imageNames: readonly string[];
  profile: DelcampeListingProfileValues;
}

/**
 * One Easy Uploader row.
 *
 * Every column is answered here and none is left to a default somewhere downstream — including the
 * five chargeable `option_*` flags, which come from the profile rather than being written `N`
 * (ADR-0034 §4: a column that costs money and is filled in by code is a decision nobody could find
 * later).
 *
 * The **duration group depends on the selling type** (#620). A quick buy renews itself out of shop
 * stock — 28 × 99 — and has no end to state, so `sale_end_time` and `sale_end_day` go out empty. An
 * auction takes the profile's own auction figures and whatever closing day and hour it holds,
 * written **verbatim**: what spelling Easy Uploader wants for those two cells has never been
 * confirmed, so the collector's own text is the answer and this module does not reformat it.
 *
 * The price it is handed is already the right one for the type — the *starting* price on an auction
 * — and `minimum_bid_step` is computed against that same figure rather than against whatever the
 * bidding has reached, so the step the row states is the step for the listing it opens.
 */
export function delcampeUploadRow(input: DelcampeUploadRowInput): DelcampeUploadRow {
  const { profile } = input;
  const auction = isAuctionListing(input.listingType);
  return {
    category_id: input.categoryId,
    title: input.title,
    personal_reference: input.personalReference,
    description: input.description,
    selling_type: delcampeSellingType(input.listingType),
    price: delcampeDecimal(input.price),
    minimum_bid_step: delcampeDecimal(delcampeMinimumBidStep(input.price, {
      threshold: profile.minBidStepThreshold,
      below: profile.minBidStepBelow,
      atOrAbove: profile.minBidStepAtOrAbove,
    })),
    initial_quantity: String(input.quantity),
    images: input.imageNames.join("|"),
    // The auction group is not defaulted to the shop-stock one where it is missing: an auction whose
    // profile does not describe an auction is refused before it gets here (see
    // {@link delcampeRowRefusals}), and a row that quietly renewed 99 times is precisely the listing
    // a deadline was supposed to end.
    renew_duration: auction
      ? String(profile.auctionDuration ?? "")
      : String(profile.renewDuration),
    renew_total_count: auction
      ? String(profile.auctionRenewTotalCount ?? "")
      : String(profile.renewTotalCount),
    sale_end_time: auction ? profile.auctionEndTime : "",
    sale_end_day: auction ? profile.auctionEndDay : "",
    shipping_model: profile.shippingModel,
    weight: "",
    ...Object.fromEntries(
      DELCAMPE_PROMOTION_OPTIONS.map((option) => [option.column, delcampeFlag(profile[option.key])])
    ),
    has_renewable_options: delcampeFlag(profile.hasRenewableOptions),
  } as DelcampeUploadRow;
}

/** What one offer is missing before it can be a row. The offer's own facts only — everything that is
 *  true of the *batch* (an unconfigured instance address, a platform that is not Delcampe) is the
 *  caller's to refuse, since it is one sentence about the export rather than one per listing. */
export interface DelcampeRowCandidate {
  title: string | null;
  description: string | null;
  categoryId: string | null;
  /** `Offer.listingType` (#449) — `fixed` or `auction`, which decides which figure the row states
   *  and which of the profile's two duration groups has to be filled in. */
  listingType: OfferListingType;
  /** The offer's asking price, or on an auction the bidding as last observed — never what an auction
   *  row carries. */
  price: number;
  /** What an auction opened at (#449), null on a quick buy and on an auction still being assembled.
   *  This is the figure an auction row states, so its absence is a refusal rather than a reason to
   *  fall back on the column beside it. */
  startingPrice: number | null;
  imageCount: number;
  hasProfile: boolean;
  /** What the resolved profile still does not say about auctions, from `delcampeAuctionGaps` —
   *  empty on a quick buy, which asks nothing of that group. Handed in rather than derived here so
   *  this module keeps knowing a profile only through the values it was given. */
  auctionProfileGaps: readonly string[];
  personalReference: string | null;
}

/** The platform's own caps (#403/#610), null where it states none. */
export interface DelcampeRowLimits {
  maxTitleLength: number | null;
  maxDescriptionLength: number | null;
}

/**
 * Why this offer cannot be written as a row — empty when it can.
 *
 * **Refusals, never repairs.** An over-long title is reported and not cut, which is #405's rule for
 * Colnect's texts and #477's for Allegro's titles arriving at the marketplace where it matters most:
 * the file is uploaded once, in a batch, and a title silently shortened to fit is a listing nobody
 * proofread. The same goes for everything else here — a missing category is not guessed at, and an
 * auction with nothing to open the bidding at is refused rather than opened at whatever the offer's
 * other price column happens to hold.
 *
 * The sentences are written to be read in a list on the workspace, one offer per line, so each says
 * what is wrong and where it is fixed rather than naming a column of a file the collector has never
 * seen.
 */
export function delcampeRowRefusals(
  candidate: DelcampeRowCandidate,
  limits: DelcampeRowLimits
): string[] {
  const refusals: string[] = [];

  const title = candidate.title?.trim() ?? "";
  if (!title) {
    refusals.push("no listing title — the derived label is not what a marketplace shows");
  } else if (limits.maxTitleLength != null && title.length > limits.maxTitleLength) {
    refusals.push(
      `the title is ${title.length} characters, ${title.length - limits.maxTitleLength} over this platform's ${limits.maxTitleLength}`
    );
  }

  const description = candidate.description ?? "";
  if (limits.maxDescriptionLength != null && description.length > limits.maxDescriptionLength) {
    refusals.push(
      `the description is ${description.length} characters, ${description.length - limits.maxDescriptionLength} over this platform's ${limits.maxDescriptionLength}`
    );
  }

  if (!candidate.categoryId?.trim()) {
    refusals.push("no Delcampe category — pick one on the offer's On Delcampe card");
  }
  if (!candidate.hasProfile) {
    refusals.push("no listing profile — set a default in Settings → Delcampe, or name one here");
  }
  // An auction states three things a quick buy does not: what the bidding opens at, how long it runs
  // and how many times it may come back. None of them is guessed — a starting price taken from the
  // standing bid would list an offer nobody made (#477), and a duration borrowed from the shop-stock
  // group would put a deadline on a listing that then renews itself 99 times.
  if (isAuctionListing(candidate.listingType)) {
    if (!(candidate.startingPrice != null && candidate.startingPrice > 0)) {
      refusals.push(
        "no starting price — an auction row states what the bidding opens at, not where it stands"
      );
    }
    if (candidate.hasProfile && candidate.auctionProfileGaps.length > 0) {
      refusals.push(
        `its listing profile does not say ${candidate.auctionProfileGaps.join(" or ")} — fill the auction settings in under Settings → Delcampe`
      );
    }
  } else if (!(candidate.price > 0)) {
    refusals.push("no price");
  }
  if (candidate.imageCount === 0) {
    refusals.push("no photos to upload — generate them first");
  }
  if (!candidate.personalReference) {
    refusals.push("no offer address for personal_reference");
  }

  return refusals;
}

/**
 * The upload set's file names for one offer, made unique across a **flat** bundle.
 *
 * The archive is flat because the CSV names its pictures by file name and nothing else: a folder per
 * offer, as the batch photo ZIP has (#323), would leave the `images` column naming files Easy
 * Uploader could not find. Flat means two offers whose titles produce the same slug would otherwise
 * collide, so the second one's whole set takes a suffix — its set, not just the colliding names, so
 * one listing's pictures stay a run of one stem.
 *
 * @param names the plan's own names, `<slug>-01.jpg`…
 * @param slug  the offer's file slug, the stem every one of those names starts with
 * @param suffix what to insert after the slug on a collision
 */
export function disambiguateBundleNames(
  names: readonly string[],
  slug: string,
  suffix: string
): string[] {
  return names.map((name) =>
    name.startsWith(`${slug}-`) ? `${slug}-${suffix}${name.slice(slug.length)}` : `${suffix}-${name}`
  );
}
