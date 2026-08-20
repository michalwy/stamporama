// The quick-jump box (#431): one always-reachable field that takes a type prefix and a short
// number — `o 200`, `iss12`, `lot 3` — and goes straight there.
//
// It exists because every major entity now carries a small per-collection number (#268 for copies,
// #416 for offers, #432 for the rest), and a number is only worth allocating if there is somewhere
// to type it. The alternative — a general search that guesses what `200` means — cannot be right
// often enough: `200` is a perfectly good catalog number, price and year as well as a copy.
// Stating the type is one keystroke and removes the guess entirely.
//
// Pure (no React / Prisma): the box parses here, and the server resolves the parsed pair to an
// address in `quick-jump-server.ts`. What each prefix *means* is stated once, in the table below.

/** The entities a quick jump can name. Extending the scheme is a row in {@link QUICK_JUMP_PREFIXES}
 * and a case in the server-side resolver — nothing else. */
export type QuickJumpEntity =
  | "item"
  | "offer"
  | "purchase"
  | "sale"
  | "issue"
  | "auctionLot"
  | "trade";

export interface QuickJumpPrefix {
  /** What the collector types. Lower-case; input is lower-cased before matching. */
  prefix: string;
  entity: QuickJumpEntity;
  /** How the entity is named back to the collector, e.g. in "No offer #12 here". */
  label: string;
}

/** The prefix table.
 *
 * Single letters where one is free and obvious, more where it is not: `s` is the sale, so an issue
 * is `iss` and an auction lot is `lot`. A prefix is deliberately a *word a collector would guess*
 * rather than a compact code — the box is used a few times a day, not a few times a second, and a
 * wrong guess that silently lands somewhere else is much worse than one that finds nothing.
 *
 * Order does not matter: matching takes the longest prefix, so `iss12` can never be read as `i`
 * followed by `ss12`. */
export const QUICK_JUMP_PREFIXES: readonly QuickJumpPrefix[] = [
  { prefix: "i", entity: "item", label: "copy" },
  { prefix: "o", entity: "offer", label: "offer" },
  { prefix: "p", entity: "purchase", label: "purchase" },
  { prefix: "s", entity: "sale", label: "sale" },
  { prefix: "iss", entity: "issue", label: "issue" },
  { prefix: "lot", entity: "auctionLot", label: "auction lot" },
  { prefix: "t", entity: "trade", label: "trade" },
];

export interface QuickJumpTarget {
  entity: QuickJumpEntity;
  no: number;
}

/** The `#` the app's own surfaces put in front of one of these numbers, so a bare integer on a busy
 * row reads as an identifier rather than a count or a price. The same convention as a copy number's
 * (`ITEM_NO_PREFIX` in `item-number.ts`), which is what makes the box's input match what is on
 * screen. */
export const ENTITY_NO_PREFIX = "#";

/** Render one of these numbers for the app's own surfaces: `12` → `#12`.
 *
 * Unpadded, unlike a copy number (#268): padding exists there because the number is written on the
 * physical piece and a column of stock cards has to line up. None of these are. */
export function formatEntityNo(no: number): string {
  return `${ENTITY_NO_PREFIX}${no}`;
}

/** Read a search-box entry as one of these numbers, or null when it isn't one.
 *
 * The same rule as a copy number's (`parseItemNoSearch`, #268), and deliberately the same shape: a
 * bare number or one behind a `#`. A list that supports it matches the number *in addition to* the
 * text, never instead of it — `200` is also a perfectly good catalog number. */
export function parseEntityNoSearch(search: string): number | null {
  const trimmed = search.trim();
  const digits = trimmed.startsWith(ENTITY_NO_PREFIX) ? trimmed.slice(1).trim() : trimmed;
  if (!/^\d+$/.test(digits)) return null;
  const value = Number(digits);
  if (!Number.isSafeInteger(value) || value < 1 || value > 2_147_483_647) return null;
  return value;
}

/** Read a quick-jump entry, or null when it is not one.
 *
 * Accepts `<prefix><number>` with or without a space between them, in any case, and tolerates a `#`
 * in front of the number — that is how the number reads on screen, so it is what gets pasted.
 * Everything else is not a jump: the caller says so rather than guessing.
 *
 * Zero, negative and absurd values are rejected here rather than at the database: the sequences
 * start at 1 and the columns are 32-bit, so nothing else could ever match. */
export function parseQuickJump(input: string): QuickJumpTarget | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;

  // Longest prefix first, so `iss` is never read as `i` and `lot` never as `l`-that-isn't.
  const candidates = [...QUICK_JUMP_PREFIXES].sort((a, b) => b.prefix.length - a.prefix.length);
  for (const { prefix, entity } of candidates) {
    if (!trimmed.startsWith(prefix)) continue;
    let rest = trimmed.slice(prefix.length).trim();
    if (rest.startsWith(ENTITY_NO_PREFIX)) rest = rest.slice(1).trim();
    if (!/^\d+$/.test(rest)) continue;
    const no = Number(rest);
    if (!Number.isSafeInteger(no) || no < 1 || no > 2_147_483_647) continue;
    return { entity, no };
  }
  return null;
}

/** How an entity is named back to the collector when a jump finds nothing. */
export function quickJumpLabel(entity: QuickJumpEntity): string {
  return QUICK_JUMP_PREFIXES.find((p) => p.entity === entity)?.label ?? entity;
}
