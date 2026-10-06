// The rules a Facebook group's settings are written by (#1543; ADR-0061) — pure, no Prisma and no
// `server-only`, because the settings editor is a client component and builds its fields from the
// very lists the domain layer validates against (the `delcampe-listing-profile-rules.ts` rule).
//
// A group's settings are its **customs**: how a post there reads, the standing note every post
// carries, and the figures a new auction there starts from. Each one **follows the Facebook
// platform's** unless the group marks it custom (#1661): the platform states what most groups want,
// once, and a group overrides only what differs. Nothing here renders a post — that is the kit's
// (#1544) — so what this module answers is what a group *says*, and the cleaning every write goes
// through.

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

/**
 * The settings a group either follows from the Facebook platform or holds as its own (#1661). The
 * keys are what `FacebookGroup.customSettings` stores; `startingPrice` is the mode and its figure
 * together, since one is meaningless without the other.
 */
export const FACEBOOK_GROUP_SETTINGS = [
  "postTemplate",
  "standingNote",
  "startingPrice",
  "bidIncrement",
  "auctionDays",
  "closingTime",
  "currency",
] as const;
export type FacebookGroupSetting = (typeof FACEBOOK_GROUP_SETTINGS)[number];

export function isFacebookGroupSetting(value: unknown): value is FacebookGroupSetting {
  return typeof value === "string" && (FACEBOOK_GROUP_SETTINGS as readonly string[]).includes(value);
}

/** The posting settings the platform states for every group (#1661), and a group's own share of
 *  them. Money is a plain number here: `Decimal` is Prisma's, and this module is read by the browser.
 *  Null is "no default". */
export interface FacebookPostingSettings {
  postTemplate: string;
  standingNote: string;
  startingPriceMode: FacebookStartingPriceMode | null;
  startingPriceValue: number | null;
  bidIncrement: number | null;
  auctionDays: number | null;
  /** `HH:MM`, 24-hour, or null. */
  closingTime: string | null;
}

/** The platform's settings before anybody has stated any — what a platform with no row reads as. */
export const FACEBOOK_BLANK_SETTINGS: FacebookPostingSettings = {
  postTemplate: "",
  standingNote: "",
  startingPriceMode: null,
  startingPriceValue: null,
  bidIncrement: null,
  auctionDays: null,
  closingTime: null,
};

/** A group's values, as the editor holds them and the domain layer stores them. A setting not named
 *  in `custom` follows the platform, and its value here is blank. */
export interface FacebookGroupValues extends FacebookPostingSettings {
  name: string;
  url: string;
  /** An ISO 4217 code while `currency` is custom; null otherwise (the platform's own, #196). */
  currency: string | null;
  /** Which settings are this group's own; every other one follows the platform. */
  custom: FacebookGroupSetting[];
}

/** What a new group starts as: a name and a link to type, and **every setting following the
 *  platform** (#1661) — the platform is where the collector says what most groups want. */
export const FACEBOOK_GROUP_DEFAULTS: Omit<FacebookGroupValues, "name" | "url"> = {
  ...FACEBOOK_BLANK_SETTINGS,
  currency: null,
  custom: [],
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

/** The starting price, held to its shape: a mode needs its figure, and a share of catalogue value
 *  has a ceiling. Null mode clears the figure. */
function cleanStartingPrice(
  mode: FacebookStartingPriceMode | null,
  value: number | null
): { startingPriceMode: FacebookStartingPriceMode | null; startingPriceValue: number | null } {
  if (mode !== null && !FACEBOOK_STARTING_PRICE_MODES.includes(mode)) {
    throw new Error("Unknown kind of starting price.");
  }
  if (mode === null) return { startingPriceMode: null, startingPriceValue: null };
  const figure = optionalAmount(value, "The starting price");
  if (figure === null) {
    throw new Error(
      mode === "amount"
        ? "Say what the starting price is, or choose no default."
        : "Say what percentage of catalogue value the starting price is, or choose no default."
    );
  }
  if (mode === "catalogPercent" && figure > FACEBOOK_STARTING_PERCENT_MAX) {
    throw new Error(
      `The starting price can be at most ${FACEBOOK_STARTING_PERCENT_MAX}% of catalogue value.`
    );
  }
  return { startingPriceMode: mode, startingPriceValue: figure };
}

function cleanAuctionDays(value: number | null): number | null {
  if (value == null || Number.isNaN(value)) return null;
  if (!Number.isInteger(value) || value < 1 || value > FACEBOOK_AUCTION_DAYS_MAX) {
    throw new Error(
      `The length of an auction must be a whole number of days between 1 and ${FACEBOOK_AUCTION_DAYS_MAX}.`
    );
  }
  return value;
}

function cleanClosingTime(value: string | null): string | null {
  if (value == null || value.trim() === "") return null;
  const time = normalizeClosingTime(value);
  if (!time) throw new Error("The closing time must be a time of day, such as 20:00.");
  return time;
}

/**
 * The platform's settings (#1661), cleaned for a save. Every one is optional — what *is* stated is
 * held to its shape, by the same rules a group's own setting is.
 */
export function cleanFacebookDefaults(input: FacebookPostingSettings): FacebookPostingSettings {
  return {
    // Kept as typed apart from the whitespace around them: the line breaks inside are the post's.
    postTemplate: input.postTemplate.trim(),
    standingNote: input.standingNote.trim(),
    ...cleanStartingPrice(input.startingPriceMode, input.startingPriceValue),
    bidIncrement: optionalAmount(input.bidIncrement, "The bid increment"),
    auctionDays: cleanAuctionDays(input.auctionDays),
    closingTime: cleanClosingTime(input.closingTime),
  };
}

/**
 * The only validation a group's save does.
 *
 * A group is useful the moment it has a name and a link. A setting it follows from the platform is
 * stored blank whatever was sent — following keeps no value of its own (#1661) — and one it holds
 * as its own is held to the platform's rules; a custom currency must name one, since *the
 * platform's* is what following it already says.
 */
export function cleanFacebookGroupValues(input: FacebookGroupValues): FacebookGroupValues {
  const name = input.name.trim();
  if (!name) throw new Error("A group needs a name.");

  const url = input.url.trim();
  if (!url) throw new Error("A group needs its link — the address of the group on Facebook.");
  if (!isFacebookGroupUrl(url)) {
    throw new Error("The link must be a web address, starting with https://.");
  }

  for (const key of input.custom) {
    if (!isFacebookGroupSetting(key)) throw new Error("Unknown group setting.");
  }
  // In the one order, once each: the column is compared, not read as a set.
  const custom = FACEBOOK_GROUP_SETTINGS.filter((key) => input.custom.includes(key));
  const own = (key: FacebookGroupSetting) => custom.includes(key);

  const settings = cleanFacebookDefaults({
    postTemplate: own("postTemplate") ? input.postTemplate : "",
    standingNote: own("standingNote") ? input.standingNote : "",
    startingPriceMode: own("startingPrice") ? input.startingPriceMode : null,
    startingPriceValue: own("startingPrice") ? input.startingPriceValue : null,
    bidIncrement: own("bidIncrement") ? input.bidIncrement : null,
    auctionDays: own("auctionDays") ? input.auctionDays : null,
    closingTime: own("closingTime") ? input.closingTime : null,
  });

  let currency: string | null = null;
  if (own("currency")) {
    currency = input.currency?.trim().toUpperCase() ?? "";
    if (currency === "") throw new Error("Choose the group's own currency, or follow Facebook's.");
    if (!/^[A-Z]{3}$/.test(currency)) {
      throw new Error("The currency must be a three-letter code, such as PLN.");
    }
  }

  return { name, url, ...settings, currency, custom };
}

/** A group's settings as it posts with them: its own where it holds one, the platform's otherwise. */
export interface FacebookEffectiveSettings extends FacebookPostingSettings {
  /** The group's own currency, or null for the platform's (#196) — the caller knows which that is. */
  currency: string | null;
}

/**
 * What a group's settings **are** (#1661): each custom one from the group, each other one from the
 * platform, read live — so a changed platform setting reaches every group that follows it. Asked
 * wherever a group's settings are read, never by a caller picking columns itself.
 */
export function effectiveFacebookGroupSettings(
  group: FacebookPostingSettings & { currency: string | null; custom: readonly string[] },
  platform: FacebookPostingSettings
): FacebookEffectiveSettings {
  const own = (key: FacebookGroupSetting) => group.custom.includes(key);
  const from = (key: FacebookGroupSetting) => (own(key) ? group : platform);
  return {
    postTemplate: from("postTemplate").postTemplate,
    standingNote: from("standingNote").standingNote,
    startingPriceMode: from("startingPrice").startingPriceMode,
    startingPriceValue: from("startingPrice").startingPriceValue,
    bidIncrement: from("bidIncrement").bidIncrement,
    auctionDays: from("auctionDays").auctionDays,
    closingTime: from("closingTime").closingTime,
    currency: own("currency") ? group.currency : null,
  };
}

/** The template tokens a text carries that are not placeholders a post knows — said beside the field
 *  so a misspelt `{startprice}` is seen while it is typed, not on the first post. */
export function unknownPostPlaceholders(template: string): string[] {
  const known = new Set<string>(FACEBOOK_POST_PLACEHOLDERS.map((p) => p.token));
  const found = template.match(/\{[A-Za-z]+\}/g) ?? [];
  return [...new Set(found.filter((token) => !known.has(token)))];
}
