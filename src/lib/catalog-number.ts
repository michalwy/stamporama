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

/**
 * The digit runs of a catalog token, in order and as they appear: `"PL 3690"` → `["3690"]`,
 * `"PL BL30 B4"` → `["30", "4"]`, `"IIIA"` → `[]`.
 *
 * This is what a `contains` recall net is built from. All the digits *at once* is what it used to
 * be, and a number carrying two runs concatenated to something (`"304"`) that appears nowhere in the
 * stored value (`"BL30 B4"`), so the stamp was never recalled and the number read as unmatchable
 * (#435). Each run, by contrast, survives every spacing and punctuation difference between the two
 * sides — exactly what the normalized key already folds away.
 */
export function catalogDigitRuns(input: string): string[] {
  return input.match(/\d+/g) ?? [];
}

/**
 * The same runs, each carrying the **letters written straight after it**: `"7cII"` → `["7cII"]`,
 * `"Mi PL200a"` → `["200a"]`, `"PL BL30 B4"` → `["30", "4"]`, `"200 MNH"` → `["200"]`.
 *
 * What a recall net is built from, where {@link catalogDigitRuns} is what a *label* is measured by.
 * A variant's number is its base plus a suffix (`7c`, `7cI`, `7cII` are three stamps), and a net
 * woven on the digits alone catches every number sharing the run — in a real collection, thousands
 * of them for a low number like `7`. The candidates are capped, so the one stamp actually asked for
 * drowns among them and the search answers "nothing". The suffix is the whole difference
 * between `7` and `7cII`, so it belongs in the net rather than only in the precision pass.
 *
 * Only letters *immediately* following the digits join a run: whitespace and punctuation end it, so
 * a query carrying words ("200 MNH") or a range ("3706 - 3711") keeps the runs it always had. A
 * vendor abbreviation or area code **leads** its number and so is never swept in.
 */
export function catalogNumberRuns(input: string): string[] {
  return input.match(/\d+[a-z]*/gi) ?? [];
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
 * The exact-match identity key for duplicate detection (#85): catalog vendor +
 * effective area prefix + the stored number, compared *exactly* (only trimmed —
 * no case/spacing folding, unlike {@link catalogMatchKey}). Two stamp catalog
 * numbers are duplicates iff their identity keys are equal, so `Mi·PL 200` and
 * `Mi·DE 200` (different prefix) — and `200` vs `200a` (different number) — never
 * collide. `\u0000` separates the parts so no vendor/prefix/number concatenation
 * can alias another.
 */
export function catalogIdentityKey(
  vendorId: string,
  areaPrefix: string | null | undefined,
  number: string
): string {
  return `${vendorId}\u0000${(areaPrefix ?? "").trim()}\u0000${number.trim()}`;
}

// ── What a catalog-number chip copies (#420) ─────────────────────────────────
//
// Clicking a chip puts the number on the clipboard, and what lands there is deliberately
// *narrower* than what the chip reads: the **area prefix stays, the vendor abbreviation goes**.
// `Mi·PL 200` copies as `PL 200`. The prefix is part of the number's identity — `Mi·PL 200` and
// `Mi·DE 200` are different stamps (#66/#377) — while the vendor names the catalogue the number was
// read out of, which is context the collector already has wherever they are pasting it (a Colnect
// search box, a marketplace title, a note).

/** {@link catalogChipCopyValue} for a chip built from its parts — the area's effective prefix
 * (#377) and the stored number. */
export function catalogChipCopyValue(
  areaPrefix: string | null | undefined,
  number: string
): string {
  const prefix = areaPrefix?.trim();
  return prefix ? `${prefix} ${number.trim()}` : number.trim();
}

/**
 * The same value recovered from an already-formatted label, for the surfaces that only carry one
 * (`PickedStamp.catalogLabels`, an issue's declared range). `formatStampCN` /
 * `formatIssueCatalogNumber` write `<vendor>·<prefix> <number>` or `<vendor> <number>`, so the head
 * is everything up to the **first** space — leaving a multi-word number (`Ark. 103`) intact — and
 * the prefix is what follows the `·` in it. A label with no vendor head at all (a bare number, which
 * is what `formatStampCN` renders with no vendor entry) is copied unchanged: there is nothing to
 * strip, and guessing would eat the number itself.
 */
export function catalogChipCopyValueFromLabel(label: string): string {
  const trimmed = label.trim();
  const space = trimmed.indexOf(" ");
  if (space < 0) return trimmed;
  const head = trimmed.slice(0, space);
  const rest = trimmed.slice(space + 1);
  const dot = head.indexOf("·");
  if (dot > 0) return `${head.slice(dot + 1)} ${rest}`;
  // No `·`, so either `<vendor> <number>` or a number that simply contains a space (`Ark. 103`,
  // which `formatStampCN` renders bare when the area declares no entry for the vendor). A vendor
  // abbreviation is a short run of letters; anything else is taken to be part of the number and
  // kept, since eating the number is the worse of the two mistakes.
  return /^\p{L}{1,4}$/u.test(head) ? rest : trimmed;
}

// ── Prefixed catalog-number search (#146) ────────────────────────────────────
//
// Catalog search/filter boxes accept a full catalog identity, not just the bare
// stored number: a vendor abbreviation, an optional country/area code, and the
// number, in any spacing — "Mi PL 200", "Mi PL200", "MiPL200", "PL200", "200".
// Parsing splits that into the vendor (when its abbreviation leads the input) and
// the numeric part; the area code, which isn't part of the stored `number`, is
// tolerated and dropped. A bare number leaves the vendor unresolved so the caller
// can fall back to a selected vendor filter (or search across all vendors).

export interface ParsedCatalogSearch {
  /** Resolved vendor id when the input led with a known vendor abbreviation; null
   *  otherwise (bare number, unknown prefix, or vendor-only input). */
  vendorId: string | null;
  /** The number part (base digits + any suffix), spacing and prefixes stripped.
   *  Empty when the input carries no number. */
  number: string;
}

/**
 * Parse a catalog search box's raw text into an optional vendor and a bare number,
 * resolving a leading vendor abbreviation against the collection's vendors. Spacing
 * and any area/country code between the vendor and the number are ignored. Examples,
 * with a Michel (`Mi`) vendor known: `"Mi PL 200"`, `"MiPL200"`, `"Mi 200"` →
 * `{ vendorId: <Mi>, number: "200" }`; `"PL200"`, `"200"` →
 * `{ vendorId: null, number: "200" }` (bare number, vendor unresolved).
 */
export function parseCatalogSearch(
  raw: string,
  vendors: readonly { id: string; abbreviation: string }[]
): ParsedCatalogSearch {
  const key = normalizeCatalogKey(raw);
  if (!key) return { vendorId: null, number: "" };

  // Strip a known vendor abbreviation prefix, longest first so a vendor whose
  // abbreviation is a prefix of another's ("S" vs "Sc") doesn't win spuriously.
  // Require something after the abbreviation so "Mi" alone isn't consumed to empty.
  let vendorId: string | null = null;
  let rest = key;
  const byLength = [...vendors].sort(
    (a, b) => b.abbreviation.length - a.abbreviation.length
  );
  for (const v of byLength) {
    const abbr = normalizeCatalogKey(v.abbreviation);
    if (abbr && key.length > abbr.length && key.startsWith(abbr)) {
      vendorId = v.id;
      rest = key.slice(abbr.length);
      break;
    }
  }

  // Whatever leads the remainder (an area code like "pl") is dropped; the number is
  // the digit run plus any trailing suffix.
  const parts = parseCatalogNumberParts(rest);
  const number = parts ? `${parts.base}${parts.suffix}` : "";
  return { vendorId, number };
}

// ── Auto-generate range parsing (#70, #148, #149, #150, #383) ────────────────
//
// A catalog number entered in the auto-generate First/Last fields is split into
// three parts: an optional leading non-digit prefix, a base number, and an
// optional trailing non-digit suffix — e.g. "BL120a" → prefix "BL", base "120",
// suffix "a". An auto-generate range varies exactly one dimension while the
// others stay constant:
//   • base   — "100"–"105", "BL120"–"BL123", "40A"–"50A" (suffix "A" constant)
//   • letter — "423a"–"423c" (base "423" constant, suffix a→c)
//   • roman  — "12I"–"12II"  (base "12" constant, suffix I→II)
//   • upper  — "423A"–"423C" (base "423" constant, suffix A→C)
// A First value on its own (no Last) always increments the varying dimension.
//
// `upper` and `roman` overlap on the seven letters a numeral is spelt with, and the tie is settled
// **for the pair, not for each end**: a range is Roman only when *both* ends spell a canonical
// numeral, so "I"–"V" stays the numeral run it always was while "A"–"D" and "C"–"F" are letters.
// Only a pair that is Roman-valid throughout ("C"–"D") is read as numerals against the collector's
// likely intent, and there it is unresolvable — writing the values out ("C, D") says which is meant.
//
// A number that is *itself* a Roman numeral ("I"–"VIII", #383) carries no digits
// at all, so it never reaches the three-part split. It is recognized ahead of it
// and enumerated as the same `roman` scheme with an empty base — the numeral is
// the whole number rather than a suffix hanging off one — so nothing downstream
// (formatting, span arithmetic, range-extension detection) needs a fourth kind.

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

/** A catalog number that is nothing but a canonical Roman numeral ("VIII", #383), as its
 *  value — or null when it carries digits, a prefix, or anything else besides. */
function parseBareRoman(input: string): number | null {
  return parseRoman(input.trim());
}

/** A single lowercase letter (a–z) as a 1-based index, or null. */
function parseLetter(input: string): number | null {
  if (!/^[a-z]$/.test(input)) return null;
  return input.charCodeAt(0) - 96;
}

/** A single uppercase letter (A–Z) as a 1-based index, or null. */
function parseUpperLetter(input: string): number | null {
  if (!/^[A-Z]$/.test(input)) return null;
  return input.charCodeAt(0) - 64;
}

/**
 * Where a suffix sits in its own sequence, as a 1-based ordinal — the same two schemes an
 * auto-generate range enumerates (#150): lowercase letters `a`–`z` and canonical Roman numerals.
 * Null when the suffix is neither ("CKB", "A"). Ordinals are only comparable within one `kind`,
 * since a suffix like `C` reads as a Roman numeral and `c` as a letter.
 */
export function parseSuffixOrdinal(
  suffix: string
): { kind: "letter" | "roman"; value: number } | null {
  const letter = parseLetter(suffix);
  if (letter !== null) return { kind: "letter", value: letter };
  const roman = parseRoman(suffix);
  if (roman !== null) return { kind: "roman", value: roman };
  return null;
}

/**
 * How a resolved range enumerates its values. `base` reapplies a constant prefix
 * and suffix around an incrementing number; `letter`/`upper`/`roman` hold a constant
 * prefix+base and enumerate a suffix sequence. A `roman` scheme with an empty
 * `base` is a bare Roman-numeral range (#383) — the numeral is the whole number.
 */
export type CatalogRangeScheme =
  | { kind: "base"; prefix: string; suffix: string; from: number }
  | { kind: "letter"; prefix: string; base: string; from: number }
  | { kind: "upper"; prefix: string; base: string; from: number }
  | { kind: "roman"; prefix: string; base: string; from: number };

/** The sequence a suffix range runs over, and where its ends sit on it. Shared by
 *  {@link resolveCatalogRange}'s suffix-varying branch and {@link parseVariantNumberSpec}, which
 *  ask the same question of two suffixes — one having split them out of full catalog numbers, the
 *  other having been handed them on their own. Roman is tried before uppercase letters and settled
 *  across **both** ends, so "I"–"V" is a numeral run and "A"–"D" a lettered one. */
function resolveSuffixRange(
  fromSuffix: string,
  toSuffix: string
): { kind: "letter" | "upper" | "roman"; from: number; span: number } | { error: string } {
  const pairs: [(v: string) => number | null, "letter" | "roman" | "upper"][] = [
    [parseLetter, "letter"],
    [parseRoman, "roman"],
    [parseUpperLetter, "upper"],
  ];
  for (const [parse, kind] of pairs) {
    const from = parse(fromSuffix);
    const to = parse(toSuffix);
    if (from === null || to === null) continue;
    if (from > to) return { error: "First suffix must be ≤ Last suffix." };
    return { kind, from, span: to - from + 1 };
  }
  return { error: "Unrecognized suffix sequence (use letters a–z, A–Z, or Roman numerals)." };
}

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
  // Bare Roman numerals first (#383): they hold no digits, so the three-part split
  // below would reject them outright.
  const fromBareRoman = parseBareRoman(firstRaw);
  if (fromBareRoman !== null) {
    const scheme: CatalogRangeScheme = { kind: "roman", prefix: "", base: "", from: fromBareRoman };
    if (lastRaw === null || !lastRaw.trim()) return { scheme, span: null };
    const toBareRoman = parseBareRoman(lastRaw);
    if (toBareRoman === null) {
      return { error: "Last catalog number must be a Roman numeral too." };
    }
    if (fromBareRoman > toBareRoman) return { error: "First catalog number must be ≤ Last." };
    return { scheme, span: toBareRoman - fromBareRoman + 1 };
  }

  const first = parseCatalogNumberParts(firstRaw);
  if (!first) {
    return { error: "First catalog number must contain a number or be a Roman numeral." };
  }
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

  const suffixes = resolveSuffixRange(first.suffix, last.suffix);
  if ("error" in suffixes) return suffixes;
  return {
    scheme: {
      kind: suffixes.kind,
      prefix: first.prefix,
      base: first.base,
      from: suffixes.from,
    },
    span: suffixes.span,
  };
}

/** Render a single scalar position of a scheme back to a catalog-number string.
 * `base` reapplies the constant prefix/suffix around the number; `letter`/`upper`/`roman`
 * hold prefix+base constant and render the suffix at that position. Leading zeros
 * are not preserved (the scalar is numeric), matching {@link generateCatalogNumbers}. */
export function formatSchemeValue(scheme: CatalogRangeScheme, value: number): string {
  if (scheme.kind === "base") {
    return `${scheme.prefix}${value}${scheme.suffix}`;
  }
  if (scheme.kind === "letter") {
    return `${scheme.prefix}${scheme.base}${String.fromCharCode(96 + value)}`;
  }
  if (scheme.kind === "upper") {
    return `${scheme.prefix}${scheme.base}${String.fromCharCode(64 + value)}`;
  }
  return `${scheme.prefix}${scheme.base}${toRoman(value)}`;
}

/** Enumerate `count` catalog numbers for a resolved scheme. */
export function generateCatalogNumbers(scheme: CatalogRangeScheme, count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) {
    out.push(formatSchemeValue(scheme, scheme.from + i));
  }
  return out;
}

// ── Catalog number specs (#452) ───────────────────────────────────────────────
//
// A First/Last pair says exactly one run, and real series routinely need more than one:
// "2823a, 2823b" is two stamps off one base, and "2895A-2897A, 2895B-2897B" is a series printed
// in two variants — six stamps, two runs. A *spec* is the comma-separated list of such segments,
// each of which is still resolved by `resolveCatalogRange`, so every scheme that already worked
// (plain, shared prefix, letter/roman suffix, bare Roman numeral) keeps working inside one.
//
// The series range the issue *declares* is derived from the spec rather than typed: suffixes
// dropped, prefix kept, min to max of the base numbers. "2895A-2897A, 2895B-2897B" therefore
// declares 2895–2897 while creating all six stamps, and "3025-3027, BL48" declares 3025–3027
// while creating the block too — see `declaredRangeOf` for which family gets measured.

/** Most stamps one spec may generate. Positional matching across catalogs makes a long
 *  auto-generated run a poor idea, and the ceiling is what the dialogs and the action share. */
export const AUTO_CREATE_MAX_STAMPS = 50;

/** One comma-separated piece of a spec, resolved for generation. */
export interface CatalogSpecSegment {
  scheme: CatalogRangeScheme;
  count: number;
}

export interface CatalogNumberSpec {
  segments: CatalogSpecSegment[];
  /** Every number the spec generates, in the order typed. */
  numbers: string[];
  /** The series range the spec declares — suffixes dropped, prefix kept. `lastNumber` is null
   *  when the whole spec sits on a single base number. */
  declared: { firstNumber: string; lastNumber: string | null };
}

/** The base numbers one segment covers, on the axis the declared range is measured along.
 *  `bare` marks a bare Roman-numeral segment (#383), whose scalars are numerals, not digits. */
function segmentBaseSpan(
  segment: CatalogSpecSegment
): { prefix: string; bare: boolean; min: number; max: number } {
  const { scheme, count } = segment;
  if (scheme.kind === "base") {
    return { prefix: scheme.prefix, bare: false, min: scheme.from, max: scheme.from + count - 1 };
  }
  if (scheme.base === "") {
    // Bare Roman numerals carry no base digits, so the numerals themselves are the range.
    return { prefix: scheme.prefix, bare: true, min: scheme.from, max: scheme.from + count - 1 };
  }
  // A suffix-varying segment holds its base constant, so it contributes that one number.
  const base = parseInt(scheme.base, 10);
  return { prefix: scheme.prefix, bare: false, min: base, max: base };
}

/**
 * Reduce resolved segments to the one range the issue declares.
 *
 * A spec may mix numbering families — "3025-3027, BL48" is an ordinary run plus the issue's
 * block, and both are that catalog's numbers for this issue. A declared range can only be one
 * family, so it is measured over the **basic numbering** (the prefix-less one) whenever the spec
 * has any, the same ranking {@link computeIssueRangeExtension} applies to an issue's members.
 * Segments outside that family still create their stamps; they just do not widen the range.
 * With no basic family at all, the first segment's own family is the one declared, so a spec of
 * nothing but blocks declares a block range.
 */
function declaredRangeOf(
  segments: CatalogSpecSegment[]
): { firstNumber: string; lastNumber: string | null } {
  const spans = segments.map(segmentBaseSpan);
  const sameFamily = (a: (typeof spans)[number], b: (typeof spans)[number]) =>
    a.bare === b.bare && a.prefix === b.prefix;
  const family = spans.find((s) => !s.bare && s.prefix === "") ?? spans[0];
  const measured = spans.filter((s) => sameFamily(s, family));
  const min = Math.min(...measured.map((s) => s.min));
  const max = Math.max(...measured.map((s) => s.max));
  const render = (value: number) => (family.bare ? toRoman(value) : `${family.prefix}${value}`);
  return { firstNumber: render(min), lastNumber: max > min ? render(max) : null };
}

/** Split a segment on any of the dashes a range may be typed with. */
const RANGE_SEPARATORS = /[-–—]/;

/**
 * Parse a human-readable catalog number spec — "2820-2822", "2823a, 2823b",
 * "2895A-2897A, 2895B-2897B" — into the numbers it generates and the series range it declares.
 *
 * Blank pieces are ignored rather than rejected: a trailing comma, or a dash with nothing after
 * it yet, is an ordinary state while the field is being typed into, and the caller validates on
 * every keystroke. A genuinely empty spec is an error, as is a repeated number.
 */
export function parseCatalogNumberSpec(input: string): CatalogNumberSpec | { error: string } {
  const segments: CatalogSpecSegment[] = [];
  for (const piece of input.split(",")) {
    if (!piece.trim()) continue;
    const parts = piece.split(RANGE_SEPARATORS).map((p) => p.trim());
    if (parts.length > 2) {
      return { error: "Use one dash per range, and a comma between ranges (e.g. 2820-2822, 2823a)." };
    }
    const range = resolveCatalogRange(parts[0], parts[1] ?? null);
    if ("error" in range) return range;
    segments.push({ scheme: range.scheme, count: range.span ?? 1 });
  }
  if (segments.length === 0) return { error: "Enter at least one catalog number." };

  const numbers = segments.flatMap((s) => generateCatalogNumbers(s.scheme, s.count));
  const seen = new Set<string>();
  for (const number of numbers) {
    if (seen.has(number)) return { error: `${number} appears more than once.` };
    seen.add(number);
  }

  return { segments, numbers, declared: declaredRangeOf(segments) };
}

// ── Variant specs, written under a base stamp's number (#722) ────────────────
//
// A variant range is typed where the base number is already on screen: the collector is looking at
// `240` and wants its colour variants `a` through `f`. Writing `240a-240f` there says the base
// number twice for no reason, so the same spec may be typed as the **suffixes alone** — `a-f`,
// `a, b, c`, `I-III` — and the base number is understood.
//
// The two forms are decided per comma-separated segment, on whether it carries a digit: a segment
// with digits is an ordinary catalog number and goes through `parseCatalogNumberSpec`'s own
// resolution, a segment without is a suffix sequence hung off the base. Nothing in between is
// guessed — `240a-c` is read as a full number against a suffix and rejected as such — because the
// two halves of a range have to agree about which axis they are on.
//
// A suffix *range* goes through `resolveSuffixRange`, the same resolution the issue-level range
// field uses, so it runs over the sequences the app already knows: lowercase letters, uppercase
// letters and Roman numerals. A **lone** suffix is taken literally instead, so a base that is
// itself a variant takes the suffixes its catalogue actually prints: `309A` + `P` is `309AP`,
// which no sequence would have produced.

/** Expand a variant spec typed under `baseNumber` — the base stamp's number in the catalogue the
 *  variants are being numbered in — into the catalog numbers it generates, in the order typed.
 *
 *  `baseNumber` may be empty, which is the state of a base stamp carrying no number in that
 *  catalogue: the full-number form still works, and a bare suffix says so rather than silently
 *  generating a number with nothing in front of it. */
export function parseVariantNumberSpec(
  input: string,
  baseNumber: string
): { numbers: string[] } | { error: string } {
  const base = baseNumber.trim();
  const numbers: string[] = [];

  for (const piece of input.split(",")) {
    if (!piece.trim()) continue;
    const parts = piece.split(RANGE_SEPARATORS).map((p) => p.trim());
    if (parts.length > 2) {
      return { error: "Use one dash per range, and a comma between ranges (e.g. a-f, h)." };
    }

    // A segment carrying digits is a catalog number in full, resolved exactly as it would be in
    // an issue's range field.
    if (/\d/.test(piece)) {
      const range = resolveCatalogRange(parts[0], parts[1] ?? null);
      if ("error" in range) return range;
      numbers.push(...generateCatalogNumbers(range.scheme, range.span ?? 1));
      continue;
    }

    if (!base) {
      return {
        error: "This stamp has no number in that catalogue — write the variants' numbers in full.",
      };
    }

    // Suffixes alone, against the base number.
    if (parts.length === 1) {
      numbers.push(`${base}${parts[0]}`);
      continue;
    }
    const range = resolveSuffixRange(parts[0], parts[1]);
    if ("error" in range) return range;
    const scheme: CatalogRangeScheme = { kind: range.kind, prefix: "", base, from: range.from };
    numbers.push(...generateCatalogNumbers(scheme, range.span));
  }

  if (numbers.length === 0) return { error: "Enter at least one variant number." };

  const seen = new Set<string>();
  for (const number of numbers) {
    if (seen.has(number)) return { error: `${number} appears more than once.` };
    seen.add(number);
  }
  return { numbers };
}

// ── Issue range coverage vs. member stamps (#…) ───────────────────────────────
//
// An issue declares a catalog range (First–Last) per vendor. Its member stamps
// carry their own per-vendor numbers and are added independently, so they can
// drift *beyond* the declared range. We surface only that: an extension the user
// probably wants folded back into the declared range. A narrower set of members
// than declared is a normal, partially-entered state and never warns.
//
// Comparison happens within the *same family* as the range endpoints — the
// scheme's constant dimensions (`resolveCatalogRange`): a `base` range (e.g.
// 100–105) matches members sharing its prefix AND suffix; a `letter`/`roman`
// range (e.g. 423a–423c) matches members sharing its prefix AND base. A block
// "BL12" or sheet "Ark. 103" against a bare numeric range is a different family
// and is ignored, whereas "BL19" against "BL17–BL18" is the same family and does
// extend it.
//
// One family outranks the rest: the *basic numbering* (no prefix, no suffix — a
// plain integer). If a range is declared in a special numbering (a non-empty
// prefix such as a block "BL" range) but the issue's members include basic
// numbers, the series should *adopt* the basic numbering instead of extending the
// special one (kind: "adopt-basic"). Otherwise same-family widening applies
// (kind: "extend").

/** The scalar position of a member number on a scheme's varying axis, or null
 * when the member belongs to a different family (mismatched constant dimensions,
 * or a suffix that isn't valid for a suffix-varying scheme). */
function scalarInScheme(scheme: CatalogRangeScheme, parts: CatalogNumberParts): number | null {
  if (parts.prefix !== scheme.prefix) return null;
  if (scheme.kind === "base") {
    if (parts.suffix !== scheme.suffix) return null;
    return parseInt(parts.base, 10);
  }
  if (parts.base !== scheme.base) return null;
  if (scheme.kind === "letter") return parseLetter(parts.suffix);
  if (scheme.kind === "upper") return parseUpperLetter(parts.suffix);
  return parseRoman(parts.suffix);
}

/** Structural parts of a *member* number, which may also be a bare Roman numeral (#383).
 *  A bare numeral stands in as a prefix-less, base-less suffix — exactly the shape
 *  {@link scalarInScheme} reads a bare-Roman scheme's members at, so a "I"–"VIII" range
 *  is extended by a member "IX" while a numeric member stays a different family. */
function parseMemberParts(input: string): CatalogNumberParts | null {
  const parts = parseCatalogNumberParts(input);
  if (parts) return parts;
  const trimmed = input.trim();
  return parseBareRoman(trimmed) !== null ? { prefix: "", base: "", suffix: trimmed } : null;
}

/** A plain-integer basic catalog number (no prefix, no suffix) → its value, else null. */
function basicValue(parts: CatalogNumberParts): number | null {
  if (parts.prefix !== "" || parts.suffix !== "") return null;
  return parseInt(parts.base, 10);
}

export interface IssueRangeExtension {
  /** "extend" widens the declared range within its own family; "adopt-basic"
   *  replaces a prefixed (e.g. block) range with the members' basic numbering. */
  kind: "extend" | "adopt-basic";
  /** Proposed First, formatted in the target scheme. */
  proposedFirst: string;
  /** Proposed Last, or null when the proposed range is a single value. */
  proposedLast: string | null;
  /** Raw member numbers (trimmed) driving the change. */
  outsideNumbers: string[];
}

/**
 * Detect whether member catalog numbers should change an issue's declared First–Last
 * range, and if so propose the new range. Two cases:
 *   • adopt-basic — the range is declared in a special (prefixed) numbering but the
 *     members include basic (plain-integer) numbers; the series adopts their span.
 *   • extend — members of the same family widen the declared range.
 * Returns null when the range can't be interpreted or nothing changes (only widening
 * or a basic-numbering takeover is ever proposed — never narrowing).
 */
export function computeIssueRangeExtension(
  firstNumber: string,
  lastNumber: string | null,
  memberNumbers: readonly string[]
): IssueRangeExtension | null {
  const resolved = resolveCatalogRange(firstNumber, lastNumber);
  if ("error" in resolved) return null;
  const { scheme, span } = resolved;

  const parsed = memberNumbers
    .map((raw) => ({ raw: raw.trim(), parts: parseMemberParts(raw) }))
    .filter((p): p is { raw: string; parts: CatalogNumberParts } => p.parts !== null);

  // Basic-numbering precedence: a prefixed (special) range yields to basic members.
  if (scheme.prefix !== "") {
    const basic = parsed
      .map((p) => ({ raw: p.raw, value: basicValue(p.parts) }))
      .filter((p): p is { raw: string; value: number } => p.value !== null);
    if (basic.length > 0) {
      const min = Math.min(...basic.map((b) => b.value));
      const max = Math.max(...basic.map((b) => b.value));
      const basicScheme: CatalogRangeScheme = { kind: "base", prefix: "", suffix: "", from: min };
      return {
        kind: "adopt-basic",
        proposedFirst: formatSchemeValue(basicScheme, min),
        proposedLast: max > min ? formatSchemeValue(basicScheme, max) : null,
        outsideNumbers: basic.map((b) => b.raw),
      };
    }
  }

  // Same-family widening.
  const from = scheme.from;
  const to = span != null ? from + span - 1 : from;
  let minScalar = from;
  let maxScalar = to;
  const outside: string[] = [];
  for (const { raw, parts } of parsed) {
    const scalar = scalarInScheme(scheme, parts);
    if (scalar === null) continue;
    if (scalar < from || scalar > to) outside.push(raw);
    if (scalar < minScalar) minScalar = scalar;
    if (scalar > maxScalar) maxScalar = scalar;
  }

  if (minScalar === from && maxScalar === to) return null;

  return {
    kind: "extend",
    proposedFirst: formatSchemeValue(scheme, minScalar),
    proposedLast: maxScalar > minScalar ? formatSchemeValue(scheme, maxScalar) : null,
    outsideNumbers: outside,
  };
}

export interface IssueRangeSuggestion {
  catalogVendorId: string;
  vendorAbbreviation: string;
  /** "extend" widens the declared range; "adopt-basic" replaces a prefixed range
   *  with the members' basic numbering. */
  kind: "extend" | "adopt-basic";
  currentFirst: string;
  currentLast: string | null;
  proposedFirst: string;
  proposedLast: string | null;
  outsideNumbers: string[];
}

/**
 * For each of an issue's declared per-vendor ranges, compute whether its member
 * stamps extend it, returning one suggestion per extended vendor. Pure — the
 * caller supplies the issue's catalog ranges, the members' per-vendor numbers,
 * and a vendor-id → abbreviation map for labelling.
 */
export function computeIssueRangeSuggestions(
  catalogNumbers: readonly { catalogVendorId: string; firstNumber: string; lastNumber: string | null }[],
  memberNumbers: readonly { catalogVendorId: string; number: string }[],
  vendorAbbrev: ReadonlyMap<string, string>
): IssueRangeSuggestion[] {
  const byVendor = new Map<string, string[]>();
  for (const m of memberNumbers) {
    const list = byVendor.get(m.catalogVendorId);
    if (list) list.push(m.number);
    else byVendor.set(m.catalogVendorId, [m.number]);
  }
  const out: IssueRangeSuggestion[] = [];
  for (const cn of catalogNumbers) {
    const ext = computeIssueRangeExtension(
      cn.firstNumber,
      cn.lastNumber,
      byVendor.get(cn.catalogVendorId) ?? []
    );
    if (!ext) continue;
    out.push({
      catalogVendorId: cn.catalogVendorId,
      vendorAbbreviation: vendorAbbrev.get(cn.catalogVendorId) ?? "",
      kind: ext.kind,
      currentFirst: cn.firstNumber,
      currentLast: cn.lastNumber,
      proposedFirst: ext.proposedFirst,
      proposedLast: ext.proposedLast,
      outsideNumbers: ext.outsideNumbers,
    });
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
