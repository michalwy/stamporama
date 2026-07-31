// Pure display formatting for a catalog-number **range** (#400). No Prisma, no server imports, so
// it runs in `test:unit` and is shared by every surface that shows one.
//
// This module is about **display of an already-known range**, never about detecting one from what the
// collector typed — that is `catalog-number.ts`'s `resolveCatalogRange` (#149/#150), which stays the
// only reader of user input. Two shortening rules, both of them ordinary philatelic notation:
//
//   • **numeric** — a span whose endpoints have the same digit count writes the end **without the
//     digits it shares with the start**: `1298-1302` → `1298-302`, `1298-1299` → `1298-99`,
//     `240-256` → `240-56`. At least two digits always survive, so `1298-1299` never reads
//     `1298-9`, and a two-digit span (`40-42`) is already as short as it gets.
//   • **suffix** — a span over one base writes the base **once**: `128a-128c` → `128a-c`,
//     `12I-12III` → `12I-III`. The sequences are the ones an auto-generate range enumerates
//     (`parseSuffixOrdinal`: letters `a`–`z`, canonical Roman numerals), so `1294CKB-1296KB` cannot
//     fold on this axis at all.
//
// Where a range is **being edited or confirmed** — the issue form's First/Last inputs, the
// range-extension prompt (#333's recompute included) — the endpoints stay written out in full: those
// are the values about to be stored, and a shortened one would misdescribe what the collector is
// agreeing to. Shortening belongs where a range is an **identity** being read: a generated listing
// title, an offer set or auction lot name, an issue's catalog chip.

import { parseCatalogNumberParts, parseSuffixOrdinal } from "./catalog-number";

/** The default separator. Generated listing texts use the plain hyphen (a platform's form is typed
 *  into, so an en dash is a paste hazard); the on-screen issue chip passes `–`. */
export const CATALOG_RANGE_SEPARATOR = "-";

/**
 * The end of a numeric span with its shared leading digits dropped — `("1298", "1302")` → `"302"`,
 * `("1298", "1299")` → `"99"`, `("240", "256")` → `"56"`.
 *
 * Returns `to` unchanged when there is nothing to gain: differing digit counts (`98`–`102`, where the
 * shortened form would read as a smaller number), or a span so short that two digits is the whole of
 * it (`40`–`42`). Two digits is the floor because one reads as a typo rather than as a range end.
 */
export function shortenNumericRangeEnd(from: string, to: string): string {
  if (from.length !== to.length) return to;
  let shared = 0;
  while (shared < to.length && from[shared] === to[shared]) shared++;
  const keep = Math.max(2, to.length - shared);
  return keep >= to.length ? to : to.slice(-keep);
}

/**
 * A numeric span already split into its constant parts: `prefix` + `from`–`to` + `suffix`, with the
 * prefix and suffix written **once** around the shortened span (`BL31`–`BL33` → `BL31-33`,
 * `40A`–`42A` → `40-42A`). `from === to` renders the single number.
 */
export function formatNumericCatalogRange(
  prefix: string,
  from: string,
  to: string,
  suffix: string,
  separator: string = CATALOG_RANGE_SEPARATOR
): string {
  const span =
    from === to ? from : `${from}${separator}${shortenNumericRangeEnd(from, to)}`;
  return `${prefix}${span}${suffix}`;
}

/** Split a digit-less catalog number into the constant text in front of it, a canonical Roman
 * numeral, and whatever trails it — `"I"` → `("", "I", "")`, `"Mi·PL VIII"` → `("Mi·PL ", "VIII", "")`,
 * `"IA"` → `("", "I", "A")` — or null when it carries no numeral at all (`"Ark."`). A number that
 * *is* a numeral (#383) has no digit run for the base/suffix split to work on, so the numeral itself
 * is the sequence and the text in front is what keeps two catalogues apart.
 *
 * The trailing part is the second axis (#426): `IA`–`VIIIA` is the numeral incrementing under a
 * constant letter, exactly as `40A`–`42A` is the base incrementing under one. Since the numeral is
 * greedy and its own character class is uppercase-only, a trailing `X` or `V` is read as part of the
 * numeral rather than as a suffix — which is what it is. `parseSuffixOrdinal` rejects a non-canonical
 * spelling, so `"Mi·DM"` still reads as no numeral rather than as `D`. */
export function parseBareRomanNumber(
  text: string
): { prefix: string; numeral: string; value: number; suffix: string } | null {
  const match = text.match(/^(.*?)([MDCLXVI]+)([^MDCLXVI]*)$/);
  if (!match) return null;
  const ordinal = parseSuffixOrdinal(match[2]);
  if (!ordinal || ordinal.kind !== "roman") return null;
  return { prefix: match[1], numeral: match[2], value: ordinal.value, suffix: match[3] };
}

/**
 * One range of catalog numbers as it reads to a collector, from its two endpoints **as recorded**.
 * Applies whichever of the two rules the pair admits and falls back to writing both out in full:
 *
 * - `("1298", "1302")` → `1298-302`, `("BL31", "BL33")` → `BL31-33`, `("40A", "42A")` → `40-42A`
 * - `("128a", "128c")` → `128a-c`, `("12I", "12III")` → `12I-III`
 * - `("I", "III")` → `I-III` (a bare numeral, #383); `("IA", "VIIIA")` → `IA-VIIIA` and
 *   `("IA", "IC")` → `IA-C` (a numeral carrying a letter suffix, #426)
 * - `("1294CKB", "1296KB")` → `1294CKB-1296KB` (nothing constant to write once)
 *
 * `to` may be null or blank — an open range is just its start.
 */
export function formatCatalogRange(
  from: string,
  to: string | null | undefined,
  separator: string = CATALOG_RANGE_SEPARATOR
): string {
  const start = from.trim();
  const end = to?.trim() ?? "";
  if (!end || end === start) return start;

  const a = parseCatalogNumberParts(start);
  const b = parseCatalogNumberParts(end);

  if (a && b && a.prefix === b.prefix) {
    // Numeric axis: one numbering family, the digits varying.
    if (a.suffix === b.suffix) {
      return formatNumericCatalogRange(a.prefix, a.base, b.base, a.suffix, separator);
    }
    // Suffix axis: one base, the suffix varying within one sequence.
    if (a.base === b.base) {
      const fromOrdinal = parseSuffixOrdinal(a.suffix);
      const toOrdinal = parseSuffixOrdinal(b.suffix);
      if (fromOrdinal && toOrdinal && fromOrdinal.kind === toOrdinal.kind) {
        return `${a.prefix}${a.base}${a.suffix}${separator}${b.suffix}`;
      }
    }
  }

  // Roman numerals (#383, #426): no digit run to split on, so the numeral takes the base's place and
  // the constant text in front of it is what has to match. Both axes again, in the same order.
  if (!a && !b) {
    const romanA = parseBareRomanNumber(start);
    const romanB = parseBareRomanNumber(end);
    if (romanA && romanB && romanA.prefix === romanB.prefix) {
      // Numeral axis: one constant suffix, the numeral varying. Unlike the numeric axis's
      // `40-42A`, the suffix is written at **both** ends — a numeral and a letter suffix are both
      // letters, so `I-VIIIA` would read as a bare-numeral span with a stray letter hung off it.
      if (romanA.suffix === romanB.suffix) {
        return `${romanA.prefix}${romanA.numeral}${romanA.suffix}${separator}${romanB.numeral}${romanB.suffix}`;
      }
      // Suffix axis: one constant numeral, the suffix varying within one sequence — written once,
      // exactly as `128a-c` writes its base.
      if (romanA.numeral === romanB.numeral) {
        const fromOrdinal = parseSuffixOrdinal(romanA.suffix);
        const toOrdinal = parseSuffixOrdinal(romanB.suffix);
        if (fromOrdinal && toOrdinal && fromOrdinal.kind === toOrdinal.kind) {
          return `${romanA.prefix}${romanA.numeral}${romanA.suffix}${separator}${romanB.suffix}`;
        }
      }
    }
  }

  return `${start}${separator}${end}`;
}
