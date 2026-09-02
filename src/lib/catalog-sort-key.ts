// Pure helpers for the denormalized catalog sort key (#181; ADR-0014). Kept free of Prisma /
// server-only imports so they can be unit-tested and shared. The stored `primaryCatalogSortKey`
// column on `issue`/`stamp` is computed from these; the SQL backfill migration mirrors this exact
// formula and must stay in sync (see prisma/migrations/*_catalog_sort_key_prefix_aware).

/** Digits per number in the encoded key — wide enough that no catalog number ever needs more, so
 *  every key of a family has the same length and compares character by character as a number. */
const NUMBER_WIDTH = 10;

/** The three parts of a catalog number on the axis it sorts along: the letters that **lead** it
 * (its numbering family — Michel `Bl`, `P`, `D`), the first digit run, and the letters written
 * straight after that run (its variant suffix). Null when the value carries no digits at all. */
function splitCatalogNumber(
  value: string | null | undefined
): { prefix: string; digits: string; suffix: string } | null {
  if (!value) return null;
  const m = /^\s*([A-Za-z]*)\s*(\d+)([A-Za-z]*)/.exec(value);
  if (!m) return null;
  return { prefix: m[1].toLowerCase(), digits: m[2], suffix: m[3].toLowerCase() };
}

/**
 * The sort key of one catalog number: `<prefix><zero-padded number><suffix>`, lowercase.
 * `"200"` → `"0000000200"`, `"200a"` → `"0000000200a"`, `"P15"` → `"p0000000015"`, `"Bl 3"` →
 * `"bl0000000003"`. Null when the number holds no digits (a bare Roman numeral), which sorts last.
 *
 * A string rather than the integer this used to be, because a catalog number is not one sequence:
 * Michel numbers its Porto, block and Dienst issues in **families** of their own,
 * and parsing leading digits alone sent every one of them to the number-less bucket at the end of
 * the list, ordered by name — `P15` before `P1—14`. Padding makes a family's numbers compare
 * numerically as text, and ASCII puts digits before letters, so the basic numbering sorts first and
 * each prefix forms its own block after it, alphabetically. The suffix rides along for free, so
 * `200` precedes `200a` instead of tying and falling through to the name.
 *
 * The stored column is `COLLATE "C"` so Postgres orders these keys byte by byte — the same order
 * JS `<` gives — since the same key is compared in the database and in memory.
 */
export function catalogSortKeyOf(value: string | null | undefined): string | null {
  const parts = splitCatalogNumber(value);
  if (!parts) return null;
  return `${parts.prefix}${parts.digits.padStart(NUMBER_WIDTH, "0")}${parts.suffix}`;
}

/** The catalog sort key for a row: the key of its effective primary-catalog vendor's number when
 * present, else the lowest key across all its numbers, else null (the row sorts last). Order-
 * independent and deterministic. `nums` carries each number's vendor id and its string value
 * (`firstNumber` for issues, `number` for stamps). */
export function computeCatalogSortKey(
  nums: { catalogVendorId: string; value: string }[],
  primaryVendorId: string | null
): string | null {
  if (primaryVendorId) {
    const primary = nums.find((n) => n.catalogVendorId === primaryVendorId);
    if (primary) {
      const v = catalogSortKeyOf(primary.value);
      if (v !== null) return v;
    }
  }
  let min: string | null = null;
  for (const n of nums) {
    const v = catalogSortKeyOf(n.value);
    if (v !== null && (min === null || v < min)) min = v;
  }
  return min;
}

/** Compare two stored keys: ascending, number-less rows last. The one rule every in-memory
 * ordering that falls back to catalog order shares, matching `ORDER BY … ASC NULLS LAST`. */
export function compareCatalogSortKeys(a: string | null, b: string | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a < b ? -1 : 1;
}
