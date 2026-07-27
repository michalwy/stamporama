// The internal copy number (#268) — a per-collection sequence starting at 1, assigned when a copy
// is created and never edited. It is what a collector writes on the physical piece or its label,
// so this module owns how it reads on screen and how it is recognised in a search box.
//
// How wide it renders is the collector's choice, stored per collection (`Collection.itemNoPad`):
// a shoebox collection wants `#12`, one filed in numbered stock cards wants `#000012`, and the
// padding is what makes a column of them line up. It is a display choice only — the stored number
// is the bare integer, so changing it rewrites nothing.
//
// Pure (no React / Prisma): the list rows, the copy dialog, the search parsing and the `{itemNo}`
// listing token all format and parse it identically. Allocation lives in `items.ts`, which needs
// the database.

/** Default width when a collection has not been configured otherwise. */
export const DEFAULT_ITEM_NO_PAD = 5;

/** The widths a collection may choose. `1` is "no padding" — a number is at least one digit — and
 * the upper bound is what a 32-bit `itemNo` can reach. */
export const MIN_ITEM_NO_PAD = 1;
export const MAX_ITEM_NO_PAD = 10;

/** The `#` the app's own surfaces prefix the number with, so a bare integer on a busy row reads as
 * an identifier rather than a count or a price. Listing templates do **not** get it: a template is
 * literal text, so a collector who wants a `#` types one. */
export const ITEM_NO_PREFIX = "#";

/** Clamp a padding width to the allowed range, or null when it isn't a usable number. Used both to
 * validate the collection setting and to read the `{itemNo:N}` argument. */
export function parseItemNoPad(value: unknown): number | null {
  const n = typeof value === "number" ? value : Number(String(value ?? "").trim());
  if (!Number.isInteger(n)) return null;
  if (n < MIN_ITEM_NO_PAD || n > MAX_ITEM_NO_PAD) return null;
  return n;
}

/** Render the digits of a copy number, zero-padded to `pad`. A number wider than `pad` renders
 * in full — padding sets a minimum width, it never truncates an identifier. */
export function formatItemNoDigits(itemNo: number, pad: number = DEFAULT_ITEM_NO_PAD): string {
  return String(itemNo).padStart(parseItemNoPad(pad) ?? DEFAULT_ITEM_NO_PAD, "0");
}

/** Render a copy number for the app's own surfaces: `1` → `#00001` at the default width. */
export function formatItemNo(itemNo: number, pad: number = DEFAULT_ITEM_NO_PAD): string {
  return `${ITEM_NO_PREFIX}${formatItemNoDigits(itemNo, pad)}`;
}

/** Read a search box entry as an internal copy number, or null when it isn't one.
 *
 * Accepts what a collector would actually type after reading a label: the bare number (`123`), the
 * padded form they see on screen (`00123`), and either with the `#` (`#00123`). Anything else —
 * a stamp name, a catalog number like `Mi 200`, a location ref — is not a copy number, and the
 * caller keeps matching it as free text. A numeric search is matched *in addition to* the text
 * search, never instead of it, because `200` is also a perfectly good catalog number.
 *
 * Independent of the configured width: leading zeros are simply insignificant, so a collection
 * that switches from `#00123` to `#123` keeps finding both spellings.
 *
 * Zero and negative values are rejected: the sequence starts at 1, so they can never match. */
export function parseItemNoSearch(search: string): number | null {
  const trimmed = search.trim();
  const digits = trimmed.startsWith(ITEM_NO_PREFIX) ? trimmed.slice(1).trim() : trimmed;
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  // Beyond a 32-bit integer the column cannot hold it, so it matches nothing.
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) return null;
  return value;
}
