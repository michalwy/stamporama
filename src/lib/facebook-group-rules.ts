// The rules a Facebook group's settings are written by (#1543; ADR-0061) — pure, no Prisma and no
// `server-only`, because the settings editor is a client component and builds its fields from the
// very lists the domain layer validates against (the `delcampe-listing-profile-rules.ts` rule).
//
// A group's settings are its **customs**: how a post there reads, the standing note every post
// carries, and the figures a new auction there starts from. Nothing here renders a post — that is the
// kit's (#1544) — so what this module answers is what a group *says*, and the cleaning every write
// goes through.

import { roundAmount } from "./decimal-input";

/**
 * The placeholders a post template may carry, with the label and example the editor shows.
 *
 * Settled with the issue (#1543): the description, the catalogue numbers, the starting price, the
 * increment, the closing time and the lot number. They are the `{token}` spelling every other
 * template here uses (`offer-title-template.ts`), and `{catalog}` is that engine's own name for the
 * catalogue numbers, so the word means one thing across templates. Rendering them is #1544's; an
 * unknown token is kept as typed rather than refused, the title template's rule.
 */
export const FACEBOOK_POST_PLACEHOLDERS = [
  { token: "{description}", label: "Description", example: "Mercury, 1850, mint never hinged" },
  { token: "{catalog}", label: "Catalogue numbers", example: "Mi·AT 1" },
  { token: "{startingPrice}", label: "Starting price", example: "10.00 PLN" },
  { token: "{increment}", label: "Bid increment", example: "1.00 PLN" },
  { token: "{closesAt}", label: "Closing time", example: "Sun 5 Oct, 20:00" },
  { token: "{lot}", label: "Lot number", example: "3" },
] as const satisfies readonly { token: string; label: string; example: string }[];

/** How a group states its default starting price: a figure, or a share of catalogue value. */
export const FACEBOOK_STARTING_PRICE_MODES = ["amount", "catalogPercent"] as const;
export type FacebookStartingPriceMode = (typeof FACEBOOK_STARTING_PRICE_MODES)[number];

/** Sanity bounds, stated as such: Facebook sets none, and these only stop a typo. A week is the
 *  ordinary auction in a group; a quarter of a year is no longer an auction anybody watches. */
export const FACEBOOK_AUCTION_DAYS_MAX = 90;
/** A starting price as a share of catalogue value: above the catalogue is allowed — some stamps sell
 *  over it — but a thousand per cent is a slip of the keyboard. */
export const FACEBOOK_STARTING_PERCENT_MAX = 1000;

/** A group's values, as the editor holds them and the domain layer stores them. Money is a plain
 *  number here: `Decimal` is Prisma's, and this module is read by the browser. Null is "no default". */
export interface FacebookGroupValues {
  name: string;
  url: string;
  postTemplate: string;
  standingNote: string;
  startingPriceMode: FacebookStartingPriceMode | null;
  startingPriceValue: number | null;
  bidIncrement: number | null;
  auctionDays: number | null;
  /** `HH:MM`, 24-hour, or null. */
  closingTime: string | null;
  /** An ISO 4217 code, or null for the platform's own currency. */
  currency: string | null;
}

/** What a new group starts as: a name and a link to type, and no default for anything else — every
 *  figure here is a group's custom, and this app has none to guess. */
export const FACEBOOK_GROUP_DEFAULTS: Omit<FacebookGroupValues, "name" | "url"> = {
  postTemplate: "",
  standingNote: "",
  startingPriceMode: null,
  startingPriceValue: null,
  bidIncrement: null,
  auctionDays: null,
  closingTime: null,
  currency: null,
};

/** Whether `url` is an address a browser opens — http or https, with a host. Nothing more is asked:
 *  Facebook writes one group several ways, and the link is for opening, never for parsing. */
export function isFacebookGroupUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return (parsed.protocol === "https:" || parsed.protocol === "http:") && parsed.hostname !== "";
  } catch {
    return false;
  }
}

/** `HH:MM` on a 24-hour clock, the one spelling stored. A single-digit hour is padded (`9:30` →
 *  `09:30`) since it is the same time; anything else is refused. Null for an unparseable value. */
export function normalizeClosingTime(value: string): string | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return `${String(hour).padStart(2, "0")}:${match[2]}`;
}

function optionalAmount(value: number | null, field: string): number | null {
  if (value == null || Number.isNaN(value)) return null;
  if (!Number.isFinite(value) || value <= 0) throw new Error(`${field} must be more than 0.`);
  // Two decimals, rounded half up as the field itself rounds (#1231): a third stored here would read
  // one way in Settings and another on the post.
  return Number(roundAmount(value));
}

/**
 * The only validation a save does.
 *
 * Every default is optional — a group is useful the moment it has a name and a link — but what *is*
 * stated is held to its shape: a starting price needs both its mode and its figure, the closing time
 * is a time of day, and the currency is a three-letter code.
 */
export function cleanFacebookGroupValues(input: FacebookGroupValues): FacebookGroupValues {
  const name = input.name.trim();
  if (!name) throw new Error("A group needs a name.");

  const url = input.url.trim();
  if (!url) throw new Error("A group needs its link — the address of the group on Facebook.");
  if (!isFacebookGroupUrl(url)) {
    throw new Error("The link must be a web address, starting with https://.");
  }

  const mode = input.startingPriceMode;
  if (mode !== null && !FACEBOOK_STARTING_PRICE_MODES.includes(mode)) {
    throw new Error("Unknown kind of starting price.");
  }
  let startingPriceValue: number | null = null;
  if (mode !== null) {
    startingPriceValue = optionalAmount(input.startingPriceValue, "The starting price");
    if (startingPriceValue === null) {
      throw new Error(
        mode === "amount"
          ? "Say what the starting price is, or choose no default."
          : "Say what percentage of catalogue value the starting price is, or choose no default."
      );
    }
    if (mode === "catalogPercent" && startingPriceValue > FACEBOOK_STARTING_PERCENT_MAX) {
      throw new Error(
        `The starting price can be at most ${FACEBOOK_STARTING_PERCENT_MAX}% of catalogue value.`
      );
    }
  }

  let auctionDays: number | null = null;
  if (input.auctionDays != null && !Number.isNaN(input.auctionDays)) {
    if (
      !Number.isInteger(input.auctionDays) ||
      input.auctionDays < 1 ||
      input.auctionDays > FACEBOOK_AUCTION_DAYS_MAX
    ) {
      throw new Error(
        `The length of an auction must be a whole number of days between 1 and ${FACEBOOK_AUCTION_DAYS_MAX}.`
      );
    }
    auctionDays = input.auctionDays;
  }

  let closingTime: string | null = null;
  if (input.closingTime != null && input.closingTime.trim() !== "") {
    closingTime = normalizeClosingTime(input.closingTime);
    if (!closingTime) throw new Error("The closing time must be a time of day, such as 20:00.");
  }

  let currency: string | null = null;
  if (input.currency != null && input.currency.trim() !== "") {
    currency = input.currency.trim().toUpperCase();
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error("The currency must be a three-letter code, such as PLN.");
    }
  }

  return {
    name,
    url,
    // Kept as typed apart from the whitespace around them: the line breaks inside are the post's.
    postTemplate: input.postTemplate.trim(),
    standingNote: input.standingNote.trim(),
    startingPriceMode: mode,
    startingPriceValue,
    bidIncrement: optionalAmount(input.bidIncrement, "The bid increment"),
    auctionDays,
    closingTime,
    currency,
  };
}

/** The template tokens a text carries that are not placeholders a post knows — said beside the field
 *  so a misspelt `{startprice}` is seen while it is typed, not on the first post. */
export function unknownPostPlaceholders(template: string): string[] {
  const known = new Set<string>(FACEBOOK_POST_PLACEHOLDERS.map((p) => p.token));
  const found = template.match(/\{[A-Za-z]+\}/g) ?? [];
  return [...new Set(found.filter((token) => !known.has(token)))];
}
