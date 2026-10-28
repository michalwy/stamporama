// Which fields a list's search box matches (#2238) — the collector's own narrowing of a box that
// otherwise reads what was typed against everything it can mean. Ticked beside the box, remembered
// per collection for that list, and never empty: a search that matched nothing at all would be a
// broken box, not a narrowed one.
//
// Generic over a list's own field keys, so every search box that takes the control up (#2239–#2245)
// reads, writes and names its choice through the same rules. Pure (no React / Prisma): the client
// stores and sends the choice, the server's parser reads it back.

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
