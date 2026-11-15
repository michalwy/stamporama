// Which fields a list's search box matches (#2238) — the collector's own narrowing of a box that
// otherwise reads what was typed against everything it can mean. Ticked beside the box, remembered
// per collection for that list, and never empty: a search that matched nothing at all would be a
// broken box, not a narrowed one.
//
// Generic over a list's own field keys, so every search box that takes the control up (#2239–#2245)
// reads, writes and names its choice through the same rules. Pure (no React / Prisma): the client
// stores and sends the choice, the server's parser reads it back.

import { readSearchParam } from "./text-input";

/** One field a search box can match, named as the collector knows it. */
export interface SearchField<K extends string = string> {
  key: K;
  label: string;
}

/** The query-string parameter a list's routes read the choice from — sent only when it narrows. */
export const SEARCH_FIELDS_PARAM = "searchFields";

/**
 * The fields a stored or sent value narrows the search to, in the list's own order — or
 * `undefined` for **every** field. Unknown keys are dropped, so a value written before a field was
 * renamed narrows to what it still names; nothing recognised, and every field ticked, both read as
 * no narrowing at all, so the default has exactly one spelling.
 */
export function parseSearchFields<K extends string>(
  raw: string | null | undefined,
  keys: readonly K[]
): K[] | undefined {
  if (!raw) return undefined;
  const named = new Set(raw.split(",").map((s) => s.trim()));
  const ticked = keys.filter((k) => named.has(k));
  return ticked.length === 0 || ticked.length === keys.length ? undefined : ticked;
}

/** How a choice is written — `""` when every field is ticked, so the default is stored as nothing. */
export function writeSearchFields<K extends string>(ticked: readonly K[], keys: readonly K[]): string {
  return parseSearchFields(ticked.join(","), keys)?.join(",") ?? "";
}

/** A tick or an untick — except the last ticked field, which stays ticked. */
export function toggleSearchField<K extends string>(
  ticked: readonly K[],
  key: K,
  keys: readonly K[]
): K[] {
  const set = new Set(ticked);
  if (set.has(key)) {
    if (set.size === 1) return [...ticked];
    set.delete(key);
  } else {
    set.add(key);
  }
  return keys.filter((k) => set.has(k));
}

/** What the control reads: `All fields`, the one field ticked, or how many are (`2 fields`), so a
 * search that finds nothing because of it can be read at a glance. */
export function searchFieldsLabel<K extends string>(
  ticked: readonly K[],
  fields: readonly SearchField<K>[]
): string {
  if (ticked.length >= fields.length) return "All fields";
  if (ticked.length === 1) return fields.find((f) => f.key === ticked[0])?.label ?? "All fields";
  return `${ticked.length} fields`;
}

// ── Exact search: text in double quotes (#2545) ──────────────────────────────────────────────────
//
// A list's search box matches any field that *contains* what was typed, so `A111` also finds A1110.
// Typed in double quotes, the text is matched **as a whole value** instead — `"A111"` finds A111 and
// nothing else — in every field the box searches, letter case still not mattering. A catalogue
// number equals the number, so `"200"` finds 200 and not 200a or 1200; a vendor prefix inside the
// quotes (`"Mi 200"`) still names the catalogue.
//
// The quotes must take the whole text. A search only partly in quotes, or with an opening quote and
// no closing one, is plain text, quotes included, exactly as before. Read only by the list routes
// that read {@link SEARCH_FIELDS_PARAM} — the pickers, quick-jump and the agent API read the text as
// it was typed.

/** A search box's text, read for quotes: the text to match, and whether it is matched exactly. */
export interface QuotedSearch {
  text: string;
  exact: boolean;
}

/** `"A111"` → `{ text: "A111", exact: true }`; anything else is itself, matched as before. The text
 * inside the quotes is trimmed, and quotes around nothing are not a search for nothing. */
export function readQuotedSearch(raw: string): QuotedSearch {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    const inner = trimmed.slice(1, -1);
    const text = inner.trim();
    if (text && !inner.includes('"')) return { text, exact: true };
  }
  return { text: raw, exact: false };
}

/** A list route's search: the text, unquoted, and `searchExact` when it was in quotes. Spread into a
 * list's filters in place of `search: readSearchParam(sp)`. */
export function readListSearchParams(
  sp: URLSearchParams
): { search?: string; searchExact?: true } {
  const search = readSearchParam(sp);
  if (!search) return {};
  const { text, exact } = readQuotedSearch(search);
  return exact ? { search: text, searchExact: true } : { search };
}

/** How a text field meets the search — equal to it when exact, containing it otherwise; letter case
 * never matters. Shaped as a Prisma string filter without importing Prisma. */
export function searchTextFilter(
  text: string,
  exact: boolean | undefined
): { equals: string; mode: "insensitive" } | { contains: string; mode: "insensitive" } {
  return exact ? { equals: text, mode: "insensitive" } : { contains: text, mode: "insensitive" };
}

/** The same question asked of a value already in hand — the in-memory twin of {@link searchTextFilter}. */
export function searchTextMatches(value: string | null | undefined, text: string, exact: boolean | undefined): boolean {
  const v = (value ?? "").toLowerCase();
  const q = text.trim().toLowerCase();
  return exact ? v === q : v.includes(q);
}

/** What a search box with ticked fields says on hover — the one line of help quotes get. */
export const EXACT_SEARCH_HINT = 'Type the text in "double quotes" to find exactly that value — "A111" finds A111, not A1110.';
