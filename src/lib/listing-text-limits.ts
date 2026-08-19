/**
 * Pure rules for a platform's listing-text length limits (#403) — no Prisma, so the contact form,
 * the offer screen and the bulk listing workspace all count and validate through one module.
 *
 * These are **hard technical limits**, the same kind of fact as the photo limits in
 * `offer-photo-config.ts`: what the platform's own form physically accepts. Colnect caps both of its
 * listing texts at 100 characters (#402), and a limit discovered in that form — after the text was
 * written and the offer marked Ready — is discovered too late.
 *
 * One limit per text rather than one for all of them, because platforms cap them independently:
 * Colnect happening to use the same number for its two is not a reason to fuse them, and Delcampe
 * caps the title while stating nothing about the rest (#610). Null means "no limit stated", which
 * stays the normal case. Like the photo limits they are **read live** and never seeded onto an offer
 * (#310): they describe the platform, so tightening one applies to every listing at once.
 *
 * Nothing here truncates. The text is the collector's; the app reports, it does not cut.
 */

/** Sanity rail, not platform knowledge — every real cap fits well inside it. */
export const MAX_LISTING_TEXT_LENGTH_LIMIT = 100000;

/** A platform's listing-text caps. Null means "no limit stated". */
export interface PlatformTextLimits {
  /** Cap on `Offer.name` (#209), or null. Third of the three and last to arrive (#610): a title is
   * short enough that no platform's form had refused one until Delcampe, whose listings are created
   * from an uploaded file — where "too long" is discovered after the file was built. */
  maxTitleLength: number | null;
  /** Cap on `Offer.description` (#266), or null. */
  maxDescriptionLength: number | null;
  /** Cap on `Offer.privateNote` (#267), or null. */
  maxPrivateNoteLength: number | null;
}

export type TextLimitParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** No platform states a limit — the shape a non-platform contact and an unconfigured one share. */
export const NO_TEXT_LIMITS: PlatformTextLimits = {
  maxTitleLength: null,
  maxDescriptionLength: null,
  maxPrivateNoteLength: null,
};

/** Parses an optional bounded whole number: blank is a valid "no limit". Mirrors the photo limits'
 * own parser rather than importing it, so neither module's bounds can drift into the other. */
function parseOptionalLength(raw: string, label: string): TextLimitParseResult<number | null> {
  const trimmed = raw.trim();
  if (!trimmed) return { ok: true, value: null };
  if (!/^-?\d+$/.test(trimmed)) return { ok: false, message: `${label} must be a whole number.` };
  const value = Number(trimmed);
  if (value < 1 || value > MAX_LISTING_TEXT_LENGTH_LIMIT) {
    return {
      ok: false,
      message: `${label} must be between 1 and ${MAX_LISTING_TEXT_LENGTH_LIMIT}.`,
    };
  }
  return { ok: true, value };
}

/** Validates the raw strings the contact form submits for a platform's text limits. */
export function parsePlatformTextLimits(raw: {
  maxTitleLength: string;
  maxDescriptionLength: string;
  maxPrivateNoteLength: string;
}): TextLimitParseResult<PlatformTextLimits> {
  const maxTitleLength = parseOptionalLength(raw.maxTitleLength, "Max title length");
  if (!maxTitleLength.ok) return maxTitleLength;

  const maxDescriptionLength = parseOptionalLength(
    raw.maxDescriptionLength,
    "Max description length"
  );
  if (!maxDescriptionLength.ok) return maxDescriptionLength;

  const maxPrivateNoteLength = parseOptionalLength(
    raw.maxPrivateNoteLength,
    "Max private note length"
  );
  if (!maxPrivateNoteLength.ok) return maxPrivateNoteLength;

  return {
    ok: true,
    value: {
      maxTitleLength: maxTitleLength.value,
      maxDescriptionLength: maxDescriptionLength.value,
      maxPrivateNoteLength: maxPrivateNoteLength.value,
    },
  };
}

/**
 * How long a text is measured in the **unit the platform's own form counts in**: UTF-16 code units,
 * which is what an HTML `maxlength` attribute enforces. Deliberately not code points or grapheme
 * clusters — the number has to agree with the field the text is about to be pasted into, and being
 * clever here would make the counter say 99 where the platform says 100.
 */
export function listingTextLength(text: string | null | undefined): number {
  return (text ?? "").length;
}

/** What a counter renders: the text's length against the platform's cap, and by how much it is
 * over (0 while it fits). */
export interface TextLengthState {
  length: number;
  limit: number;
  /** `length - limit`, floored at 0 — non-zero is exactly the warning condition. */
  over: number;
}

/**
 * The counter state for one text, or **null when the platform states no limit** — the single test
 * every surface makes before rendering a counter, so an unconfigured platform costs no UI at all.
 */
export function textLengthState(
  text: string | null | undefined,
  limit: number | null | undefined
): TextLengthState | null {
  if (limit == null) return null;
  const length = listingTextLength(text);
  return { length, limit, over: Math.max(0, length - limit) };
}

// ── The gate (#636) ───────────────────────────────────────────────────────────────────────────

/** Which text ran over. One code per text, so a surface keying a list on it states all three. */
export type ListingTextLimitCode =
  | "title-too-long"
  | "description-too-long"
  | "private-note-too-long";

/**
 * One text over its platform's cap, in the shape every listing gate reports in
 * (`ListingBlocker`, `PhotoReadinessBlocker`) — so the ready gate's hover hint, the workspace card
 * and the server's own refusal render one list rather than three.
 *
 * No `subjects` and no `stampIds`: what is at fault is a text on this offer, not a copy in it.
 */
export interface ListingTextLimitBlocker {
  code: ListingTextLimitCode;
  title: string;
  message: string;
  subjects: string[];
  stampIds: string[];
}

/** The three texts an offer states, as they are stored (#209/#266/#267). */
export interface ListingTexts {
  name: string | null;
  description: string | null;
  privateNote: string | null;
}

const TEXTS = [
  { code: "title-too-long", field: "name", limit: "maxTitleLength", what: "listing title" },
  {
    code: "description-too-long",
    field: "description",
    limit: "maxDescriptionLength",
    what: "description",
  },
  {
    code: "private-note-too-long",
    field: "privateNote",
    limit: "maxPrivateNoteLength",
    what: "private note",
  },
] as const satisfies readonly {
  code: ListingTextLimitCode;
  field: keyof ListingTexts;
  limit: keyof PlatformTextLimits;
  what: string;
}[];

/**
 * Which of this offer's texts the platform will refuse on length — empty when none will, which stays
 * the normal case (most platforms state no cap at all).
 *
 * **This is a gate, not a counter** (#636). #403 deliberately left the caps as a *report*: a
 * Colnect or Allegro form refuses one over-long text in front of the collector, so learning about it
 * there costs one paste. Delcampe changed the arithmetic — its listings are created from a CSV
 * (#610), and Easy Uploader refuses the **whole file**, after a batch of forty was assembled, marked
 * ready and exported. A limit discovered then is discovered too late, which is the sentence this
 * module has carried in its own header since #403.
 *
 * **Nothing is truncated**, here or anywhere: the text is the collector's, and an app that cut it to
 * fit would publish a listing nobody proofread. Both numbers are stated and the text is named, since
 * a count with no target is not actionable in a batch of forty.
 */
export function evaluateListingTextLimits(
  texts: ListingTexts,
  limits: PlatformTextLimits
): ListingTextLimitBlocker[] {
  const blockers: ListingTextLimitBlocker[] = [];
  for (const entry of TEXTS) {
    const limit = limits[entry.limit];
    if (limit == null) continue;
    const length = listingTextLength(texts[entry.field]);
    if (length <= limit) continue;
    const over = length - limit;
    blockers.push({
      code: entry.code,
      title: `The ${entry.what} is ${over} ${over === 1 ? "character" : "characters"} over this platform's ${limit}`,
      message: `The ${entry.what} is ${length} characters, ${over} over this platform's ${limit}. Shorten it on the offer's own screen — nothing is shortened for you.`,
      subjects: [],
      stampIds: [],
    });
  }
  return blockers;
}
