import type { Prisma } from "@/generated/prisma/client";

// **A carrier bearing more than one stamp is a copy of none of them** (#745; ADR-0044 §3).
//
// A cover franked with Mi 200, 201 and 205 does not mean the collection holds Mi 200. The stamp is
// glued to something that will be sold whole, so counting it as a held copy makes the collection
// assert something false — and it is false about the **leading** stamp exactly as much as about the
// others, which is why nothing here treats `Item.stampId` as an exception. The stamps stay
// searchable and visible; they are a description of the piece, never a claim of ownership.
//
// The rule is not about indivisibility. A cover bearing **one** stamp is equally indivisible and is
// correctly counted as a copy of that stamp on cover — catalogues price exactly that — so what is
// tested is **unambiguity**: while a carrier holds one catalogue position it *is* that position, in
// the shape "on cover"; holding several it is none of them in particular.
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

/**
 * {@link NOT_MULTI_STAMP} as a SQL predicate, without the table alias — for the Colnect list reads,
 * which are one raw query each by design and so cannot spread a Prisma fragment. Used as
 * ``AND i.${Prisma.raw(NOT_MULTI_STAMP_SQL)}``, the same shape their flag column already takes.
 *
 * It is the same sentence rather than a second one: a run acting on rows the report never showed is
 * exactly what one spelling prevents.
 */
export const NOT_MULTI_STAMP_SQL = '"stampCount" = 1';

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
 * The key of the one group every multi-stamp copy is collected into when the Copies list is grouped
 * by duplicates or by issue. Both of those file a copy **under its stamp** — its `stampId`, or its
 * stamp's series — and that is exactly the claim §3 removes, so a carrier is filed under neither and
 * the carriers are one bucket of their own instead. Filing by location is untouched: where a piece
 * is kept is a fact about the object, not about a catalogue position.
 *
 * A sentinel no cuid can collide with, in the same spelling family as `NO_ISSUE`.
 */
export const MULTI_STAMP_GROUP_KEY = "__multi_stamp__";

/** The multi-stamp bucket of a grouped Copies list. Deliberately thin: the bucket is not a stamp,
 *  an issue or a place, so all it can honestly state is how many carriers the filter holds. */
export interface MultiStampGroupRow {
  key: typeof MULTI_STAMP_GROUP_KEY;
  count: number;
}
