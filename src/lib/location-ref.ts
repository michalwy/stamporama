// Ordering for in-location refs (#330) — the free-text identifier a copy carries inside its
// storage location (`A234`). Refs overwhelmingly follow a `prefix + number` scheme (`A100`,
// `A1200`, `B-3000`), and that is how a collector walks a shelf: all of `A` first, in numeric
// order, then all of `B`. A plain collator gets that wrong as soon as the separator varies
// (`A-100` vs `A100`), so the prefix and the number are compared separately.
//
// Pure (no React / Prisma) so the printable packing list and the on-screen packing view share
// one ordering.

const COLLATOR = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

/** A ref split into its leading label and its trailing number, when it has one. */
export interface ParsedLocationRef {
  /** The part before the trailing number, upper-cased with separators trimmed (`B-` → `B`). */
  prefix: string;
  /** The trailing run of digits, leading zeros stripped, or null when the ref doesn't end in one.
   * Kept as a string so an absurdly long number still compares exactly. */
  digits: string | null;
}

/** Matches `<anything><separators><digits>` — the lazy prefix hands as much as possible to the
 * trailing number, so `A-100` splits into `A` + `100`. */
const REF_PATTERN = /^(.*?)[\s._/-]*(\d+)$/;

export function parseLocationRef(ref: string): ParsedLocationRef {
  const trimmed = ref.trim();
  const match = REF_PATTERN.exec(trimmed);
  if (!match) return { prefix: trimmed.toLocaleUpperCase(), digits: null };
  return {
    prefix: match[1].trim().toLocaleUpperCase(),
    digits: match[2].replace(/^0+(?=\d)/, ""),
  };
}

/** Compare two digit runs numerically without going through `Number` (so a very long ref can't
 * lose precision): more digits means a larger number, equal length compares lexicographically. */
function compareDigits(a: string, b: string): number {
  if (a.length !== b.length) return a.length - b.length;
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Order two in-location refs: by prefix first, then by the trailing number. Blank refs sort last
 * (in both directions — an unlabelled piece has no place in the walk-order). A ref with no
 * trailing number sorts after the numbered ones sharing its prefix, then alphabetically.
 */
export function compareLocationRef(a: string | null, b: string | null): number {
  const ra = a?.trim() ?? "";
  const rb = b?.trim() ?? "";
  if (!ra || !rb) {
    if (!ra && !rb) return 0;
    return ra ? -1 : 1;
  }
  const pa = parseLocationRef(ra);
  const pb = parseLocationRef(rb);
  const byPrefix = COLLATOR.compare(pa.prefix, pb.prefix);
  if (byPrefix !== 0) return byPrefix;
  if (pa.digits == null || pb.digits == null) {
    if (pa.digits == null && pb.digits == null) return COLLATOR.compare(ra, rb);
    return pa.digits == null ? 1 : -1;
  }
  const byNumber = compareDigits(pa.digits, pb.digits);
  if (byNumber !== 0) return byNumber;
  // Same prefix, same number — order by the raw text so the result is stable (`A01` vs `A1`).
  return COLLATOR.compare(ra, rb);
}
