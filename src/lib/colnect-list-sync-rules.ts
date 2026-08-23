// The vocabulary of **Colnect list sync** (#684, the foundation of #684–#690) — pure, no Prisma and
// no `server-only`, so what a list is configured to mean can be asserted in `test:unit`.
//
// Colnect has no API and no import, only a CSV export of a list (read by `colnect-list-rules.ts`
// for trades, #645). Keeping a Colnect list in step with this collection is therefore a loop —
// export, load, look at the differences, fix whichever side is wrong — and the loop needs two
// answers per list before it can run: **what of ours does this list mirror**, and **which side wins
// when the two disagree**. Both are stored on `ColnectListMapping`; the words they are stored in
// live here.

/** Which predicate of ours defines a list's membership. Stored as the string, so a new predicate is
 *  a code change and never a migration. */
export type ColnectListSource =
  /** Copies in the collection and in hand: `inCollection`, delivered, not disposed. */
  | "items_in_collection"
  /** Copies marked `forTrade`. */
  | "items_for_trade"
  /** Copies marked `forSale`. */
  | "items_for_sale"
  /** `Want` rows still open — `closedAt` null. */
  | "wants_open";

/** Which side wins when the two disagree, and therefore what the report proposes for an item
 *  present only on Colnect: remove it there (`local`), or adopt it here (`colnect`). */
export type ColnectListSourceOfTruth = "local" | "colnect";

/**
 * Which difference a standing acceptance or a *done on Colnect* claim is about
 * (`ColnectListDecision.kind`, `ColnectListDoneMark.kind`) — and, with `not-comparable` added, the
 * report's own buckets (#686). One vocabulary for both, because a bucket the screen files a row
 * under and the kind a decision about that row is keyed by have to be the same word or the decision
 * stops finding its row.
 *
 * A plain string in the database, which is what let the report add `quantity` and `grade` to #684's
 * original pair without a migration.
 */
export type ColnectListDifferenceKind =
  /** On Colnect, not here. */
  | "only-colnect"
  /** Here, not on Colnect. */
  | "only-local"
  /** On both, but the count of qualifying local rows is not the list entry's `Quantity`. */
  | "quantity"
  /** On both, but the grade the list entry states is not the one the local side agrees on. */
  | "grade";

/**
 * What the report files a row under (#686) — every difference kind, plus the one bucket that is not
 * a difference at all.
 *
 * **`not-comparable` is separate on purpose.** A local stamp carrying no `colnectId` (#247) is
 * neither on both sides nor missing from one: nothing was ever checked. Filing it under *missing on
 * Colnect* would be the report asserting something it never verified, and would open the Wish list
 * with thousands of rows that are really a statement about the Assistant's backfill (#250) rather
 * than about the list. It is also why it can carry no decision and no done mark: both are keyed by
 * `colnectId`, and these rows have none.
 */
export type ColnectListBucket = ColnectListDifferenceKind | "not-comparable";

/** One membership predicate, as Settings offers it. */
export interface ColnectListSourceOption {
  value: ColnectListSource;
  /** What the picker says. */
  label: string;
  /** The predicate spelled out, because "items for trade" and "copies marked for trade, still in
   *  hand" are not the same sentence and the difference is the whole report. */
  description: string;
}

/**
 * The predicates a Colnect list can mirror. Copies are counted **in hand** — a copy already sold or
 * given away is not on offer, and a Swap list still naming it is exactly the discrepancy this whole
 * track exists to surface, not something to feed back into the comparison.
 *
 * Wants are the one non-copy predicate, and the reason the set is a list of named predicates rather
 * than a filter expression: a wish list is not a fact about copies at all, and any shape general
 * enough to cover both would be a query language in a settings row.
 */
export const COLNECT_LIST_SOURCES: readonly ColnectListSourceOption[] = [
  {
    value: "items_in_collection",
    label: "Copies in the collection",
    description: "Copies marked as in the collection, delivered and not disposed of.",
  },
  {
    value: "items_for_trade",
    label: "Copies for trade",
    description: "Copies marked for trade, delivered and not disposed of.",
  },
  {
    value: "items_for_sale",
    label: "Copies for sale",
    description: "Copies marked for sale, delivered and not disposed of.",
  },
  {
    value: "wants_open",
    label: "Open wants",
    description: "Wants that are still open — nothing closed, and nothing about copies.",
  },
];

/** The two answers to *who wins*, as Settings offers them. */
export const COLNECT_LIST_SOURCES_OF_TRUTH: readonly {
  value: ColnectListSourceOfTruth;
  label: string;
  description: string;
}[] = [
  {
    value: "local",
    label: "Stamporama",
    description: "What is here is right: an item only on Colnect is proposed for removal there.",
  },
  {
    value: "colnect",
    label: "Colnect",
    description: "What is on Colnect is right: an item only there is proposed for adoption here.",
  },
];

/** One of Colnect's standard lists, with what it means here before the collector says otherwise. */
export interface ColnectStandardList {
  /** Colnect's own list id — `div.ibox_list[data-lt=N]` on every item row. */
  lt: number;
  /** Colnect's name for it, and the seed for `ColnectListMapping.label`. */
  label: string;
  defaultSource: ColnectListSource;
  defaultSourceOfTruth: ColnectListSourceOfTruth;
}

/**
 * Colnect's four standard lists, in the order Settings shows them — Colnect's own `lt` order, which
 * is also collection-first and therefore the order a collector thinks about them in.
 *
 * **Wish defaults to `colnect` and the other three to `local`**, and that asymmetry is a fact about
 * the data rather than a preference. The account read on 2026-08-22 held Collection 5,346 · Wish
 * 25,145 · Swap 3,119 · Sell 3,419: the wish list is years of clicking *I want this* on Colnect
 * against far fewer `Want` rows here, so a `local` Wish would open with a report proposing to delete
 * twenty-five thousand things — formally correct, and useless (#688). The other three are
 * maintained here and exported there, so here is where they are right.
 *
 * Custom lists (`custom_list__N`, numbers like 11, 15, 16) are deliberately absent: `lt` is a plain
 * integer and a mapping row for one needs no migration, but Colnect states no name for them
 * anywhere a file or a row can be read, so offering one means asking the collector to type it —
 * which is a screen, not a constant.
 */
export const COLNECT_STANDARD_LISTS: readonly ColnectStandardList[] = [
  {
    lt: 2,
    label: "Collection",
    defaultSource: "items_in_collection",
    defaultSourceOfTruth: "local",
  },
  { lt: 3, label: "Swap", defaultSource: "items_for_trade", defaultSourceOfTruth: "local" },
  { lt: 4, label: "Wish", defaultSource: "wants_open", defaultSourceOfTruth: "colnect" },
  { lt: 5, label: "Sell", defaultSource: "items_for_sale", defaultSourceOfTruth: "local" },
];

/** The standard list with this id, or null when it is a custom one. */
export function colnectStandardList(lt: number): ColnectStandardList | null {
  return COLNECT_STANDARD_LISTS.find((l) => l.lt === lt) ?? null;
}

/** Whether a value is a predicate this app can evaluate — the write-side guard, so a stored mapping
 *  can always be resolved to a set of stamps. */
export function isColnectListSource(value: string): value is ColnectListSource {
  return COLNECT_LIST_SOURCES.some((s) => s.value === value);
}

/** Whether a value is one of the two sides. */
export function isColnectListSourceOfTruth(value: string): value is ColnectListSourceOfTruth {
  return COLNECT_LIST_SOURCES_OF_TRUTH.some((s) => s.value === value);
}

/** Whether a value is a difference kind an acceptance or a done mark can be filed against. */
export function isColnectListDifferenceKind(value: string): value is ColnectListDifferenceKind {
  return COLNECT_LIST_BUCKETS.some((b) => b.value === value && b.decidable);
}

/** Whether a value is one of the report's buckets. */
export function isColnectListBucket(value: string): value is ColnectListBucket {
  return COLNECT_LIST_BUCKETS.some((b) => b.value === value);
}

/** One bucket, as the report's filter row offers it. */
export interface ColnectListBucketOption {
  value: ColnectListBucket;
  /** The chip's own word. */
  label: string;
  /** What being in this bucket means, in the report's terms. */
  description: string;
  /** Whether a row here can be ignored or marked done — false only for `not-comparable`, which has
   *  no `colnectId` and therefore nothing to key either by. */
  decidable: boolean;
}

/**
 * The report's five buckets (#686), in the order the screen counts them.
 *
 * The order is the collector's: the two membership buckets first, because *is it there at all* is
 * the question the loop is run for, then the two that are about an item present on both sides, then
 * the one that is not a difference.
 */
export const COLNECT_LIST_BUCKETS: readonly ColnectListBucketOption[] = [
  {
    value: "only-local",
    label: "Missing on Colnect",
    description: "The list should hold it and does not — the predicate holds here, no row there.",
    decidable: true,
  },
  {
    value: "only-colnect",
    label: "Extra on Colnect",
    description: "The list holds it and the predicate does not hold here.",
    decidable: true,
  },
  {
    value: "quantity",
    label: "Quantity",
    description: "On both sides, but the list's quantity is not the number held here.",
    decidable: true,
  },
  {
    value: "grade",
    label: "Grade",
    description:
      "On both sides, but the list's grade is not the one the local side agrees on. Silent where it does not agree.",
    decidable: true,
  },
  {
    value: "not-comparable",
    label: "Not comparable",
    description: "No Colnect ID here, so nothing was checked either way.",
    decidable: false,
  },
];

/** What a bucket is called on screen, or the raw value for one this build no longer offers — a
 *  stored decision naming a kind that was dropped still has to render as something. */
export function colnectListBucketLabel(value: string): string {
  return COLNECT_LIST_BUCKETS.find((b) => b.value === value)?.label ?? value;
}

/**
 * What a predicate is *made of*, which is the one thing the report has to know about it that
 * Settings does not: three of the four count **copies** and differ only in which flag, and the
 * fourth counts **wants** and is a different table entirely.
 *
 * Kept here rather than in the query that uses it so the mapping from a stored string to a column
 * is asserted in `test:unit` — the query builds SQL from it, and a typo there is a wrong report
 * rather than an error.
 */
export type ColnectListSourceShape =
  | { kind: "copies"; flag: "inCollection" | "forTrade" | "forSale" }
  | { kind: "wants" };

export function colnectListSourceShape(source: ColnectListSource): ColnectListSourceShape {
  switch (source) {
    case "items_in_collection":
      return { kind: "copies", flag: "inCollection" };
    case "items_for_trade":
      return { kind: "copies", flag: "forTrade" };
    case "items_for_sale":
      return { kind: "copies", flag: "forSale" };
    case "wants_open":
      return { kind: "wants" };
  }
}

/** What the picker says for a stored predicate, or the raw value where it is one this build no
 *  longer offers — a screen that renders a blank for a row it cannot explain is worse than one that
 *  prints the word it found. */
export function colnectListSourceLabel(value: string): string {
  return COLNECT_LIST_SOURCES.find((s) => s.value === value)?.label ?? value;
}
