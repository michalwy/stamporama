/**
 * Pure rules for a platform's listing-text length limits (#403) — no Prisma, so the contact form,
 * the offer screen and the bulk listing workspace all count and validate through one module.
 *
 * These are **hard technical limits**, the same kind of fact as the photo limits in
 * `offer-photo-config.ts`: what the platform's own form physically accepts. Colnect caps both of its
 * listing texts at 100 characters (#402), and a limit discovered in that form — after the text was
 * written and the offer marked Ready — is discovered too late.
 *
 * Two limits rather than one, because platforms cap the two texts independently; Colnect happening
 * to use the same number for both is not a reason to fuse them. Null means "no limit stated", which
 * stays the normal case. Like the photo limits they are **read live** and never seeded onto an offer
 * (#310): they describe the platform, so tightening one applies to every listing at once.
 *
 * Nothing here truncates. The text is the collector's; the app reports, it does not cut.
 */

/** Sanity rail, not platform knowledge — every real cap fits well inside it. */
export const MAX_LISTING_TEXT_LENGTH_LIMIT = 100000;

/** A platform's listing-text caps. Null means "no limit stated". */
export interface PlatformTextLimits {
  /** Cap on `Offer.description` (#266), or null. */
  maxDescriptionLength: number | null;
  /** Cap on `Offer.privateNote` (#267), or null. */
  maxPrivateNoteLength: number | null;
}

export type TextLimitParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

/** No platform states a limit — the shape a non-platform contact and an unconfigured one share. */
export const NO_TEXT_LIMITS: PlatformTextLimits = {
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
  maxDescriptionLength: string;
  maxPrivateNoteLength: string;
}): TextLimitParseResult<PlatformTextLimits> {
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
