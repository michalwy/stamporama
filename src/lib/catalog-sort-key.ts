// Pure helpers for the denormalized catalog sort key (#181; ADR-0014). Kept free of Prisma /
// server-only imports so they can be unit-tested and shared. The stored `primaryCatalogSortKey`
// column on `issue`/`stamp` is computed from these; the SQL backfill migration mirrors this exact
// formula and must stay in sync (see prisma/migrations/*_backfill_catalog_sort_key).

/** The leading-digits value of a catalog number as an integer, or null when it does not start
 * with a digit. `"200a"` → 200, `"12"` → 12, `"B12"` → null (matches the SQL `substring(... from
 * '^[0-9]+')` used by the backfill, and the old parseInt behaviour). */
export function parseCatalogSortInt(value: string | null | undefined): number | null {
  if (!value) return null;
  const match = /^\s*(\d+)/.exec(value);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return Number.isSafeInteger(n) ? n : null;
}

/** The catalog sort key for a row: the parsed number of its effective primary-catalog vendor when
 * present, else the lowest numeric across all its numbers, else null (the row sorts last). Order-
 * independent and deterministic. `nums` carries each number's vendor id and its string value
 * (`firstNumber` for issues, `number` for stamps). */
export function computeCatalogSortKey(
  nums: { catalogVendorId: string; value: string }[],
  primaryVendorId: string | null
): number | null {
  if (primaryVendorId) {
    const primary = nums.find((n) => n.catalogVendorId === primaryVendorId);
    if (primary) {
      const v = parseCatalogSortInt(primary.value);
      if (v !== null) return v;
    }
  }
  let min: number | null = null;
  for (const n of nums) {
    const v = parseCatalogSortInt(n.value);
    if (v !== null && (min === null || v < min)) min = v;
  }
  return min;
}
