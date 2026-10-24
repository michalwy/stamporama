// The internal copy number (#268) — a per-collection sequence starting at 1, assigned when a copy
// is created and never edited. It is what a collector writes on the physical piece or its label,
// so this module owns how it reads on screen and how it is recognised in a search box.
//
// It reads **plain** everywhere — `#123`, as an offer's, a sale's or a post's number does (#2096).
// It was padded with zeros to a per-collection width until then, the one internal number that was;
// a template that wants a padded number asks for it with `:N` (#2097, `template-amount.ts`).
//
// Pure (no React / Prisma): the list rows, the copy dialog and the search parsing all format and
// parse it identically. Allocation lives in `items.ts`, which needs the database.

/** The `#` the app's own surfaces prefix the number with, so a bare integer on a busy row reads as
 * an identifier rather than a count or a price. Templates do **not** get it: a template is literal
 * text, so a collector who wants a `#` types one. */
export const ITEM_NO_PREFIX = "#";

/** Render a copy number for the app's own surfaces: `123` → `#123`. */
export function formatItemNo(itemNo: number): string {
  return `${ITEM_NO_PREFIX}${itemNo}`;
}

/** Read a search box entry as an internal copy number, or null when it isn't one.
 *
 * Accepts what a collector would actually type after reading a label: the bare number (`123`), a
 * padded form written on an older label or by a padded template (`00123`), and either with the `#`
 * (`#00123`). Anything else — a stamp name, a catalog number like `Mi 200`, a location ref — is not
 * a copy number, and the caller keeps matching it as free text. A bare number is matched *in
 * addition to* the text search, never instead of it, because `200` is also a perfectly good catalog
 * number; one written with the `#` is the copy alone — {@link parseItemNoOnlySearch}.
 *
 * Leading zeros are simply insignificant, so a label written while numbers were padded (#2096)
 * still finds its copy.
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

/** Read a search box entry as **only** a copy number — the number written the way the app writes
 * it, `#123` — or null when it isn't one (#2136).
 *
 * The `#` is the collector saying *this is a copy's number*, so the search finds that one copy and
 * nothing else: no catalogue number, stamp name or location ref is matched beside it. A bare `123`
 * stays ambiguous and keeps matching both ({@link parseItemNoSearch}). Leading zeros are ignored
 * here as there, so `#00123` from a padded label is copy 123. */
export function parseItemNoOnlySearch(search: string): number | null {
  if (!search.trim().startsWith(ITEM_NO_PREFIX)) return null;
  return parseItemNoSearch(search);
}
