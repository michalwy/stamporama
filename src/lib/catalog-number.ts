// Pure catalog-number helpers (no Prisma, no server imports) so they can run in
// `test:unit` and be shared between the stamp-search domain and the UI (#104).
//
// A stamp's catalog number is stored as a raw `number` (e.g. "200") against a
// vendor. Its human-facing identity, though, is the vendor abbreviation plus the
// area's per-vendor prefix plus the number — e.g. Michel Poland #200 shows as
// "Mi·PL 200". Collectors type that identity in many spacings: `Mi PL 200`,
// `Mi PL200`, `MiPL200`, or just `200`. Search must resolve all of these to the
// same stamp, so matching happens on a normalized key that ignores spacing and
// punctuation rather than on the raw stored string.

/**
 * Collapse a catalog token to a comparison key: lowercase, keep only `[a-z0-9]`.
 * `"Mi·PL 200"`, `"Mi PL200"`, and `"MiPL200"` all normalize to `"mipl200"`.
 */
export function normalizeCatalogKey(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Digits only — used to narrow a DB `number contains` query from a mixed token. */
export function catalogDigits(input: string): string {
  return input.replace(/\D/g, "");
}

/**
 * Human-facing catalog label: `"Mi·PL 200"` when the area sets a per-vendor
 * prefix, or `"Mi 200"` when it doesn't. Mirrors `formatIssueCatalogNumber`.
 */
export function formatCatalogNumber(
  vendorAbbreviation: string,
  areaPrefix: string | null | undefined,
  number: string
): string {
  const head = areaPrefix ? `${vendorAbbreviation}·${areaPrefix}` : vendorAbbreviation;
  return `${head} ${number}`;
}

/**
 * The normalized comparison key for one stamp catalog number: vendor abbreviation
 * + area prefix + number, e.g. `"mipl200"`. Empty parts are simply omitted, so a
 * prefix-less vendor yields `"mi200"`.
 */
export function catalogMatchKey(
  vendorAbbreviation: string,
  areaPrefix: string | null | undefined,
  number: string
): string {
  return normalizeCatalogKey(`${vendorAbbreviation}${areaPrefix ?? ""}${number}`);
}

/**
 * Does the (normalized) query appear in any of a stamp's catalog keys? A query
 * like `"200"` matches `"mipl200"` (bare number), `"mipl200"` matches it exactly,
 * and `"pl200"` matches the prefix+number tail — all via substring containment,
 * which keeps every documented spacing variant resolving to the same stamp.
 * An empty query never matches (so a name-only query doesn't hit every stamp).
 */
export function catalogKeyMatches(query: string, keys: readonly string[]): boolean {
  const q = normalizeCatalogKey(query);
  if (!q) return false;
  return keys.some((k) => k.includes(q));
}
