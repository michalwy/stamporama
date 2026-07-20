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

// ── Auto-generate range parsing (#70, #148, #149, #150) ──────────────────────
//
// A catalog number entered in the auto-generate First/Last fields is split into
// three parts: an optional leading non-digit prefix, a base number, and an
// optional trailing non-digit suffix — e.g. "BL120a" → prefix "BL", base "120",
// suffix "a". An auto-generate range varies exactly one dimension while the
// others stay constant:
//   • base   — "100"–"105", "BL120"–"BL123", "40A"–"50A" (suffix "A" constant)
//   • letter — "423a"–"423c" (base "423" constant, suffix a→c)
//   • roman  — "12I"–"12II"  (base "12" constant, suffix I→II)
// A First value on its own (no Last) always increments the base.

/** Structural parts of a catalog number: prefix + base digits + suffix. */
export interface CatalogNumberParts {
  prefix: string;
  base: string;
  suffix: string;
}

/**
 * Split a catalog number into a leading non-digit prefix, its base digits, and a
 * trailing non-digit suffix. Returns null when there's no digit run at all
 * ("", "BL"). The base is kept as its raw digit string so suffix-varying ranges
 * preserve any leading zeros.
 */
export function parseCatalogNumberParts(input: string): CatalogNumberParts | null {
  const match = input.trim().match(/^(\D*)(\d+)(\D*)$/);
  if (!match) return null;
  return { prefix: match[1], base: match[2], suffix: match[3] };
}

const ROMAN_TABLE: [number, string][] = [
  [1000, "M"], [900, "CM"], [500, "D"], [400, "CD"], [100, "C"], [90, "XC"],
  [50, "L"], [40, "XL"], [10, "X"], [9, "IX"], [5, "V"], [4, "IV"], [1, "I"],
];

function toRoman(value: number): string {
  let n = value;
  let out = "";
  for (const [num, sym] of ROMAN_TABLE) {
    while (n >= num) {
      out += sym;
      n -= num;
    }
  }
  return out;
}

/** Parse an uppercase Roman numeral, or null if it isn't a canonical one. */
function parseRoman(input: string): number | null {
  if (!/^[MDCLXVI]+$/.test(input)) return null;
  let n = 0;
  let prev = 0;
  for (let i = input.length - 1; i >= 0; i--) {
    const v = { I: 1, V: 5, X: 10, L: 50, C: 100, D: 500, M: 1000 }[input[i]]!;
    if (v < prev) n -= v;
    else {
      n += v;
      prev = v;
    }
  }
  // Reject non-canonical spellings like "IIII" or "VX" by round-tripping.
  return toRoman(n) === input ? n : null;
}

/** A single lowercase letter (a–z) as a 1-based index, or null. */
function parseLetter(input: string): number | null {
  if (!/^[a-z]$/.test(input)) return null;
  return input.charCodeAt(0) - 96;
}

/**
 * How a resolved range enumerates its values. `base` reapplies a constant prefix
 * and suffix around an incrementing number; `letter`/`roman` hold a constant
 * prefix+base and enumerate a suffix sequence.
 */
export type CatalogRangeScheme =
  | { kind: "base"; prefix: string; suffix: string; from: number }
  | { kind: "letter"; prefix: string; base: string; from: number }
  | { kind: "roman"; prefix: string; base: string; from: number };

export interface ResolvedCatalogRange {
  scheme: CatalogRangeScheme;
  /** Number of stamps the range spans, or null when only First was given. */
  span: number | null;
}

/**
 * Resolve a First/Last pair into a generation scheme and span, or an error
 * message when the pattern can't be interpreted. `last` is null when only the
 * First field was filled — that always increments the base number.
 */
export function resolveCatalogRange(
  firstRaw: string,
  lastRaw: string | null
): ResolvedCatalogRange | { error: string } {
  const first = parseCatalogNumberParts(firstRaw);
  if (!first) return { error: "First catalog number must contain a number." };
  const fromBase = parseInt(first.base, 10);

  if (lastRaw === null || !lastRaw.trim()) {
    return {
      scheme: { kind: "base", prefix: first.prefix, suffix: first.suffix, from: fromBase },
      span: null,
    };
  }

  const last = parseCatalogNumberParts(lastRaw);
  if (!last) return { error: "Last catalog number must contain a number." };
  if (first.prefix !== last.prefix) {
    return { error: "First and Last catalog numbers must share the same prefix." };
  }

  const toBase = parseInt(last.base, 10);
  const sameBase = fromBase === toBase;
  const sameSuffix = first.suffix === last.suffix;

  // Vary the base: same suffix, base changes (or both identical → single stamp).
  if (sameSuffix) {
    if (fromBase > toBase) return { error: "First catalog number must be ≤ Last." };
    return {
      scheme: { kind: "base", prefix: first.prefix, suffix: first.suffix, from: fromBase },
      span: toBase - fromBase + 1,
    };
  }

  // Vary the suffix: base must stay constant.
  if (!sameBase) {
    return { error: "First and Last must vary only the number or only the suffix, not both." };
  }

  const fromLetter = parseLetter(first.suffix);
  const toLetter = parseLetter(last.suffix);
  if (fromLetter !== null && toLetter !== null) {
    if (fromLetter > toLetter) return { error: "First suffix must be ≤ Last suffix." };
    return {
      scheme: { kind: "letter", prefix: first.prefix, base: first.base, from: fromLetter },
      span: toLetter - fromLetter + 1,
    };
  }

  const fromRoman = parseRoman(first.suffix);
  const toRomanValue = parseRoman(last.suffix);
  if (fromRoman !== null && toRomanValue !== null) {
    if (fromRoman > toRomanValue) return { error: "First suffix must be ≤ Last suffix." };
    return {
      scheme: { kind: "roman", prefix: first.prefix, base: first.base, from: fromRoman },
      span: toRomanValue - fromRoman + 1,
    };
  }

  return { error: "Unrecognized suffix sequence (use letters a–z or Roman numerals)." };
}

/** Enumerate `count` catalog numbers for a resolved scheme. */
export function generateCatalogNumbers(scheme: CatalogRangeScheme, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    const value = scheme.from + i;
    if (scheme.kind === "base") {
      out.push(`${scheme.prefix}${value}${scheme.suffix}`);
    } else if (scheme.kind === "letter") {
      out.push(`${scheme.prefix}${scheme.base}${String.fromCharCode(96 + value)}`);
    } else {
      out.push(`${scheme.prefix}${scheme.base}${toRoman(value)}`);
    }
  }
  return out;
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
