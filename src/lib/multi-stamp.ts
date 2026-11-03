import type { Prisma } from "@/generated/prisma/client";

// **A carrier bearing more than one stamp is a copy of none of them** (#745; ADR-0044 §3).
//
// A cover franked with Mi 200, 201 and 205 does not mean the collection holds Mi 200. The stamp is
// glued to something that will be sold whole, so counting it as a held copy makes the collection
// assert something false — and it is false about the **leading** stamp exactly as much as about the
// others, which is why nothing here treats `Item.stampId` as an exception. The stamps stay
// searchable and visible; they are a description of the piece, never a claim of ownership.
//
// #745 read the rule as **unambiguity** — a cover bearing one stamp was counted as a copy of that
// stamp "on cover". #2383 (ADR-0079) reversed that: a cover bearing one stamp is a **piece**, counted
// towards none of its stamps exactly as one bearing several, and the counts read `NOT_PIECE` below.
// What stays here about *several* stamps is the Copies list's filter and its grouping bucket.
//
// This module is the one place that spelling lives, for `trade-exit.ts`'s reason a level up: a
// fragment used wherever the other held-copy guards are used, so the copy counts, the checklists,
// the wants, the completeness reads and the Colnect source predicates cannot come to disagree about
// which copies they are counting. `Item.stampCount` is materialised (ADR-0044 §4) precisely so that
// every one of them stays a flat `where` beside `disposedAt: null` rather than a join.
//
// It reaches only the reads that are about a **catalogue position**. A multi-stamp copy stays fully
// a copy for everything that is about the object — offers, sales, trades, location, disposal,
// delivery, cost basis, photos, `itemNo` — and it stays on the Copies list, which is the one
// inventory list there is (ADR-0044 §7).

/**
 * `Item` fragment: this copy is a copy **of its stamp** — one catalogue position, unambiguously.
 * Spread beside the sold, traded-away and disposed guards.
 *
 * `stampCount` is the summed `quantity` of the copy's entries, and `quantity` counts described
 * components rather than sheets of paper (ADR-0044 §4). So a block of four *on* a cover is one
 * component of quantity 1 and the piece is still counted, while a cover bearing Mi 200 twice loose
 * is one entry of quantity 2 and is not: the collection cannot supply *a* Mi 200 off it either way.
 */
export const NOT_MULTI_STAMP: Prisma.ItemWhereInput = { stampCount: 1 };

/** The same copy, the other way round: an indivisible carrier of several catalogue positions. */
export const MULTI_STAMP: Prisma.ItemWhereInput = { stampCount: { gt: 1 } };

// ── Pieces (#2383; ADR-0079) ──────────────────────────────────────────────────
//
// **No piece counts towards a stamp's holdings.** A piece is a carrier of several stamps *or* one
// stamp on a format of kind on cover or on piece (`isPiece`), and a cover bearing one Mi 200 is now
// counted exactly as one bearing several: towards none of them. The test is no longer unambiguity
// (#745's reading above) — a cover is not a copy of its stamp whatever it carries.
//
// A piece has no condition, and `item-condition.ts` keeps `Item.conditionId` null exactly for one, so
// the condition is the flat column every held-copy predicate reads: a plain `where` beside
// `disposedAt: null`, as `stampCount` was, rather than a join on the format's kind. `NOT_MULTI_STAMP`
// stays for what is about **several** stamps — the Copies list's *Several stamps* filter and its
// grouping bucket — and every count of a stamp's copies reads `NOT_PIECE`.

/** `Item` fragment: this copy is a copy **of its stamp** — a loose stamp, not a piece. Spread beside
 *  the sold, traded-away and disposed guards wherever copies of a catalogue position are counted. */
export const NOT_PIECE: Prisma.ItemWhereInput = { stampCount: 1, conditionId: { not: null } };

/** The same copy, the other way round: a piece, which answers no want and fills no checklist. */
export const PIECE: Prisma.ItemWhereInput = { conditionId: null };

/**
 * For or against the pieces, as a grouped Copies list addresses its own rows (#2383): the duplicate
 * and issue groups are keyed on a stamp, so their members are `exclude`, and the bucket that collects
 * the pieces instead is `only`. Not a control on the bar — that one is `MultiStampFilter`, about
 * several stamps — but a parameter of the member reads, so a group can never list a copy its count
 * did not include.
 */
export type PieceFilter = "only" | "exclude";

/** Read a piece filter off a query string; anything unrecognised is no filter. */
export function asPieceFilter(value: string | null | undefined): PieceFilter | undefined {
  return value === "only" || value === "exclude" ? value : undefined;
}

/** The `Item` fragment a piece filter narrows to — {@link PIECE} and {@link NOT_PIECE} themselves. */
export function pieceFilterWhere(filter: PieceFilter | undefined): Prisma.ItemWhereInput {
  if (filter === "only") return PIECE;
  if (filter === "exclude") return NOT_PIECE;
  return {};
}

/** {@link NOT_PIECE} as a SQL predicate, without the table alias, used as
 *  ``AND i.${Prisma.raw(NOT_PIECE_SQL)}`` — the condition alone, which is null for every piece. */
export const NOT_PIECE_SQL = '"conditionId" IS NOT NULL';

/** Whether a copy's `stampCount` makes it a multi-stamp carrier — the pure form of the predicate,
 *  for the surfaces that hold a copy already read rather than a query to narrow. */
export function isMultiStampCount(stampCount: number): boolean {
  return stampCount > 1;
}

// ── The Copies list (#748; ADR-0044 §7) ──────────────────────────────────────
//
// Multi-stamp copies live on the Copies list rather than on a screen of their own, so the list needs
// two things this module is the natural home of: a filter for and against them, and a name for the
// group they are collected into when the list is grouped.

/**
 * The Copies list's multi-stamp filter. **Absent is both** — the default, and not a value of its
 * own, so an untouched list and a cleared one key the same query. `only` narrows to the carriers,
 * `exclude` to everything else.
 */
export type MultiStampFilter = "only" | "exclude";

export const MULTI_STAMP_FILTERS: readonly MultiStampFilter[] = ["only", "exclude"];

/** Read a filter value off a query string or storage. Anything unrecognised is **no filter** rather
 *  than an unmatchable one: a stale or hand-edited link should show the list, not an empty screen. */
export function asMultiStampFilter(value: string | null | undefined): MultiStampFilter | undefined {
  return (MULTI_STAMP_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as MultiStampFilter)
    : undefined;
}

/** The `Item` fragment a filter value narrows to — {@link MULTI_STAMP} and {@link NOT_MULTI_STAMP}
 *  themselves, so the list filter and the counts cannot come to mean different copies by it. */
export function multiStampFilterWhere(
  filter: MultiStampFilter | undefined
): Prisma.ItemWhereInput {
  if (filter === "only") return MULTI_STAMP;
  if (filter === "exclude") return NOT_MULTI_STAMP;
  return {};
}

/**
 * The key of the one group every **piece** is collected into when the Copies list is grouped by
 * duplicates or by issue — a carrier of several stamps (#748) and, since #2383, a cover or fragment
 * carrying one. Both groupings file a copy **under its stamp** — its `stampId`, or its stamp's series
 * — and that is exactly the claim ADR-0044 §3 and ADR-0079 remove, so a piece is filed under neither
 * and the pieces are one bucket of their own instead. Filing by location is untouched: where a piece
 * is kept is a fact about the object, not about a catalogue position.
 *
 * A sentinel no cuid can collide with, in the same spelling family as `NO_ISSUE`.
 */
export const MULTI_STAMP_GROUP_KEY = "__multi_stamp__";

/** The pieces bucket of a grouped Copies list. Deliberately thin: the bucket is not a stamp, an
 *  issue or a place, so all it can honestly state is how many pieces the filter holds. */
export interface MultiStampGroupRow {
  key: typeof MULTI_STAMP_GROUP_KEY;
  count: number;
}
