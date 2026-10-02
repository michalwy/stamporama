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
 * The ref a location's counter is currently *at* — the highest one already written in it, or null
 * when it has never been ref'd in.
 *
 * This is the card being packed right now, and it is what the Store dialog offers by default
 * (#629): a transport card takes twenty stamps and is rarely filled in one sitting, so continuing
 * the card already on the desk is the common act and starting a new one is the exception.
 *
 * "Highest" is {@link compareLocationRef}'s order, which sorts by prefix first: a box holding
 * `A1…A200` and `B1…B5` is at `B5`, since `B` is the strip currently being filled. Refs with no
 * trailing number are ignored — they are labels, not a counter.
 */
export function highestLocationRef(refs: Iterable<string | null | undefined>): string | null {
  let best: string | null = null;
  for (const raw of refs) {
    const ref = raw?.trim();
    if (!ref || parseLocationRef(ref).digits == null) continue;
    if (best == null || compareLocationRef(ref, best) > 0) best = ref;
  }
  return best;
}

/**
 * The next free ref for a location: one past {@link highestLocationRef}, or null when the location
 * has never been ref'd in.
 *
 * Null is the **normal** answer for an album or stockbook, where the location itself is the
 * address — the ref is optional and this action files copies going into the collection just as
 * much as stock, so a location that uses no refs must suggest none rather than inventing `1`.
 *
 * What this answers is *"start a new card"* — the strip of blank cards to print, and the Store
 * dialog's explicit next-ref action (#629). It is deliberately not that dialog's default: handing
 * out a fresh number on every open is what made a collector retype the previous one all afternoon.
 */
export function nextLocationRef(refs: Iterable<string | null | undefined>): string | null {
  const best = highestLocationRef(refs);
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

// ── What the ref box is showing, and what that means (#629/#1334) ────────────
//
// Two dialogs ask the same question — Store on a purchase order, and Bulk edit on the Copies list —
// so the reading of "typed nothing yet / typed something / that ref is already in use" is one
// function rather than one per dialog. It lives here, beside the ordering and the counter it reads,
// because it is pure: the usage comes off the wire and everything below is arithmetic on it.

/** One in-location ref and how many copies currently sit under it. */
export interface LocationRefInUse {
  ref: string;
  count: number;
}

/** What refs a location already holds, which card its counter is at, and the next free one. */
export interface LocationRefUsage {
  /** Every ref written in this location, in walk order, with its copy count. */
  refs: LocationRefInUse[];
  /** The card this location's counter is at — what filing offers by default (#629), or null when
   * the location uses no refs. */
  highest: string | null;
  /** The next free ref, for starting a new card and for printing a strip of blank ones (#565). */
  suggestion: string | null;
}

/** How a ref field reads right now, given what the collector has typed and what the location holds. */
export interface LocationRefChoice {
  /** What the box shows: the typed ref if there is one, otherwise the card being packed (#629). */
  ref: string;
  /** {@link ref} trimmed — what would actually be written. */
  trimmed: string;
  /** How many copies already sit under {@link trimmed} in this location; 0 for a free ref. */
  collision: number;
  /** Whether that collision is the card the location is up to — the expected path, said quietly,
   * as against any other collision, which might be a typo and keeps the warning colour. */
  continuingCurrentCard: boolean;
  /** Where a strip of blank cards should start: one past the card being packed, since blank cards
   * are printed for the cards *not yet* packed. A typed ref is taken at face value. */
  printFrom: string;
}

/**
 * Read a ref field's state: what it shows and whether that ref is already in use (#629).
 *
 * `typedRef` is null until the collector types — the box then simply shows the card the location is
 * up to, so switching location re-offers on its own, and once they have typed, what they typed
 * stands. A ref already in use is a **confirmation, not an error**: a card holding twenty stamps is
 * rarely filled in one sitting, so topping one up is the normal path.
 */
export function resolveLocationRefChoice(
  typedRef: string | null,
  usage: LocationRefUsage | undefined
): LocationRefChoice {
  const highest = usage?.highest ?? null;
  const ref = typedRef ?? highest ?? "";
  const trimmed = ref.trim();
  const lower = trimmed.toLocaleLowerCase();
  const collision = countUnderRef(usage?.refs, trimmed);
  const continuingCurrentCard = highest != null && lower === highest.toLocaleLowerCase();
  return {
    ref,
    trimmed,
    collision,
    continuingCurrentCard,
    printFrom: continuingCurrentCard ? (usage?.suggestion ?? "") : trimmed,
  };
}

/** How many copies sit under `ref` in a tally — matched ignoring case, the way the collector reads
 * a card's label. 0 for a blank ref, or one the tally does not name. */
export function countUnderRef(refs: readonly LocationRefInUse[] | undefined, ref: string): number {
  const lower = ref.trim().toLocaleLowerCase();
  if (!lower) return 0;
  return refs?.find((r) => r.ref.toLocaleLowerCase() === lower)?.count ?? 0;
}

/** Fold `(ref, count)` rows into one tally per written ref, in walk order. Blank and null refs are
 * folded away — "nothing is written on these" is one answer, and the database cannot merge the two
 * into it — and refs that differ only in surrounding whitespace are one card. */
export function foldLocationRefCounts(
  rows: Iterable<{ ref: string | null | undefined; count: number }>
): LocationRefInUse[] {
  const counts = new Map<string, number>();
  for (const row of rows) {
    const ref = row.ref?.trim();
    if (!ref) continue;
    counts.set(ref, (counts.get(ref) ?? 0) + row.count);
  }
  return [...counts.entries()]
    .map(([ref, count]) => ({ ref, count }))
    .sort((a, b) => compareLocationRef(a.ref, b.ref));
}

/** The copies being filed that already sit in `locationId`, tallied by the ref they carry there
 * (#1535) — for a dialog that holds its copies, as the Copies list's bulk edit does. */
export function tallyLocationRefs(
  copies: Iterable<{ locationId: string | null; locationRef: string | null }>,
  locationId: string
): LocationRefInUse[] {
  const rows: { ref: string | null; count: number }[] = [];
  for (const c of copies) if (c.locationId === locationId) rows.push({ ref: c.locationRef, count: 1 });
  return foldLocationRefCounts(rows);
}

// ── What filing does to the card (#1535) ─────────────────────────────────────
//
// A ref card is filled up to what it can take, so the three numbers the collector packs by are how
// many copies are on it now, how many are going on, and how many it will hold afterwards — and the
// third must not be left to mental arithmetic. They count **copies**, the unit filing writes: a
// cover carrying several stamps is one.

/** A ref card before and after filing. */
export interface RefFillFigures {
  /** Copies under the ref in this location today — 0 for a new card. */
  now: number;
  /** Copies being filed that are not on the ref yet. */
  adding: number;
  /** Distinct copies the ref will hold once filed. */
  after: number;
}

/**
 * The card's figures for filing `count` copies onto a ref that holds `now`, `alreadyOnRef` of those
 * copies sitting under it already (#1535).
 *
 * **A copy already on the card is not counted twice.** Re-storing a batch some of which was packed
 * in an earlier sitting writes the same ref onto those copies again, which moves nothing — so they
 * are neither *added* nor a second time in the total. `alreadyOnRef` is clamped to both other
 * figures, since a stale read cannot make more copies already-there than either side holds.
 */
export function refFillFigures(now: number, count: number, alreadyOnRef: number): RefFillFigures {
  const overlap = Math.max(0, Math.min(alreadyOnRef, now, count));
  const adding = Math.max(0, count - overlap);
  return { now, adding, after: now + adding };
}
