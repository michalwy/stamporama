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

// ── Allocating the next ref (#565) ───────────────────────────────────────────
//
// Filing a batch of copies suggests the ref the printed strip of ref cards is up to. The suggestion
// is derived from the refs **already used in the target location** and nowhere else: the box is
// shared across purchases, so a per-lot counter would drop two `A147`s from two different
// stockbooks into one box.

/** The next ref after `ref` — its trailing number plus one, in the same shape: separators and
 * zero-padding are kept (`B-3000` → `B-3001`, `A007` → `A008`), because the strip in the box is
 * written one way and a suggestion in another shape reads as a different strip. Null when `ref`
 * carries no trailing number, which is a ref that cannot be counted from. */
export function incrementLocationRef(ref: string): string | null {
  const trimmed = ref.trim();
  const match = /^(.*?)(\d+)$/.exec(trimmed);
  if (!match) return null;
  const [, head, digits] = match;
  // Through BigInt, so a ref longer than 2^53 counts on rather than rounding — the same care
  // `compareDigits` takes for the same reason.
  const next = (BigInt(digits) + 1n).toString();
  return head + next.padStart(digits.length, "0");
}

/**
 * The ref to suggest for a location, given every ref already written in it: one past the highest,
 * or null when the location has never been ref'd in.
 *
 * Null is the **normal** answer for an album or stockbook, where the location itself is the
 * address — the ref is optional and this action files copies going into the collection just as
 * much as stock, so a location that uses no refs must suggest none rather than inventing `1`.
 *
 * "Highest" is {@link compareLocationRef}'s order, which sorts by prefix first: a box holding
 * `A1…A200` and `B1…B5` suggests `B6`, since `B` is the strip currently being filled. Refs with no
 * trailing number are ignored — they are labels, not a counter.
 */
export function nextLocationRef(refs: Iterable<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const raw of refs) {
    const ref = raw?.trim();
    if (!ref || parseLocationRef(ref).digits == null) continue;
    if (best == null || compareLocationRef(ref, best) > 0) best = ref;
  }
  return best == null ? null : incrementLocationRef(best);
}

/** How long a printed strip may be, and how long it is when the address does not say (#565).
 *
 * These live here, beside {@link locationRefStrip}, rather than in the sheet's `"use client"`
 * controls where they started. The **server** page clamps with the maximum, and a client module's
 * exports reach a server component as *client references* rather than as values — `Math.min(<client
 * reference>, n)` is `NaN`, and a `NaN` count printed exactly one card for every number the
 * collector typed. A constant both halves read belongs in a module neither half owns. */
export const MAX_REF_CARDS = 200;
export const DEFAULT_REF_CARDS = 20;

/** How many cards an address asks for: the URL's number clamped to a printable strip, falling back
 * to {@link DEFAULT_REF_CARDS} when it names none or names nonsense. A mistyped count must not be
 * able to render a book, and must not be able to render nothing either. */
export function parseRefCardCount(raw: string | undefined): number {
  const n = raw ? parseInt(raw, 10) : NaN;
  if (!Number.isFinite(n)) return DEFAULT_REF_CARDS;
  return Math.min(MAX_REF_CARDS, Math.max(1, n));
}

/** A run of `count` consecutive refs starting at `start` — what a strip of blank ref cards carries
 * (#565). Empty when `start` has no trailing number to count from, which is the caller's cue that
 * there is nothing to print rather than a strip of one. */
export function locationRefStrip(start: string, count: number): string[] {
  const first = start.trim();
  if (!first || parseLocationRef(first).digits == null) return [];
  const strip = [first];
  for (let i = 1; i < count; i++) {
    const next = incrementLocationRef(strip[strip.length - 1]);
    if (!next) break;
    strip.push(next);
  }
  return strip;
}
