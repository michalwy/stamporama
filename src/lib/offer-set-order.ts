// Pure, Prisma-free ordering rules for offer sets and the copies inside them (#306). Kept out of
// `offers.ts` so they can be unit-tested without a database and reused verbatim wherever a set's
// composition is enumerated (detail read model, listing-text generation, duplication, sale flow,
// and the offer photo plan). No side effects.
//
// Two levels, two rules:
//
// - **Sets** carry a non-null `sortOrder`, dense and 0-based within their offer. Purely explicit:
//   the collector drags sets into the order a buyer should read them in.
// - **Copies** carry a nullable `sortOrder`. `null` means "derive from the catalog sort key"
//   (`stamp.primaryCatalogSortKey`, ADR-0014); a value means the collector hand-corrected the
//   order. The distinction is deliberate — without it there is no way to tell "this is how catalog
//   order came out" from "this is how I want it", and no safe rule for where a new copy goes.
//
// A set is kept **all-or-nothing**: reordering writes a value for every copy in the set, and the
// reset action clears the whole set back to null. The comparator still degrades sensibly if a
// mixed state is ever reached — explicit positions come first, derived copies follow.

import { compareCatalogSortKeys } from "./catalog-sort-key";

/** The fields a set needs to be ordered within its offer. */
export interface SetOrderRow {
  id: string;
  sortOrder: number;
}

/** The fields a copy needs to be ordered within its set. `catalogSortKey` is the denormalized
 * `stamp.primaryCatalogSortKey`; null (no parseable catalog number) sorts last. */
export interface SetItemOrderRow {
  itemId: string;
  sortOrder: number | null;
  catalogSortKey: string | null;
}

/** Sets in explicit order; `id` breaks ties so the result is total and stable. */
export function compareSets(a: SetOrderRow, b: SetOrderRow): number {
  if (a.sortOrder !== b.sortOrder) return a.sortOrder - b.sortOrder;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/** Copies in effective order: hand-corrected positions first (ascending), then derived ones by
 * catalog sort key with key-less copies last, `itemId` breaking every remaining tie. */
export function compareSetItems(a: SetItemOrderRow, b: SetItemOrderRow): number {
  if (a.sortOrder !== b.sortOrder) {
    if (a.sortOrder == null) return 1;
    if (b.sortOrder == null) return -1;
    return a.sortOrder - b.sortOrder;
  }
  const byCatalog = compareCatalogSortKeys(a.catalogSortKey, b.catalogSortKey);
  if (byCatalog !== 0) return byCatalog;
  return a.itemId < b.itemId ? -1 : a.itemId > b.itemId ? 1 : 0;
}

/** `rows` sorted by {@link compareSetItems}, without mutating the input. */
export function sortSetItems<T extends SetItemOrderRow>(rows: readonly T[]): T[] {
  return [...rows].sort(compareSetItems);
}

/** True when the set's copy order was hand-corrected (any explicit position) rather than derived
 * from catalog order. Drives the "Reset to catalog order" action and where a new copy lands. */
export function hasManualItemOrder(rows: readonly { sortOrder: number | null }[]): boolean {
  return rows.some((r) => r.sortOrder != null);
}

/** The position a copy appended to `rows` should take: `null` while the set is still derived (it
 * simply slots into its catalog position), otherwise one past the last explicit position. */
export function nextItemSortOrder(rows: readonly { sortOrder: number | null }[]): number | null {
  if (!hasManualItemOrder(rows)) return null;
  return rows.reduce((max, r) => Math.max(max, r.sortOrder ?? -1), -1) + 1;
}
