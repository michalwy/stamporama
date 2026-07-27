import "server-only";
import { prisma } from "./db";

// How many copies of a stamp you hold (#348), for the badge the catalog screens show beside a
// stamp — the Issues list stamp tree and the flat Stamps list. Kept out of `items.ts` because
// both readers (`issues.ts`, `stamps.ts`) only want the counts, not the copy read model.

/** Copies held of one stamp. `total` is the whole; the disposition figures are **markers**, not
 * a partition — a copy can be in the collection *and* for sale, so they may overlap and may sum
 * to more (or, for a copy carrying no marker, less) than `total`. */
export interface StampCopyCounts {
  total: number;
  inCollection: number;
  forSale: number;
  forTrade: number;
}

export const NO_COPIES: StampCopyCounts = {
  total: 0,
  inCollection: 0,
  forSale: 0,
  forTrade: 0,
};

/**
 * Copies held per stamp, for the given stamp ids. Stamps with no copies are absent from the
 * map — a caller reads them as {@link NO_COPIES}.
 *
 * Counted **per stamp exactly**, never rolled up from variant children: a copy is linked to one
 * stamp at one level of the variant tree, and the tree already shows the children's own badges,
 * so rolling up would show the same copy twice on one screen.
 *
 * Copies that have **sold** are excluded, matching the *View copies* popup the badge sits next to
 * (#207) — a badge that disagreed with the list it opens would be worse than no badge. Delivery
 * state is deliberately not filtered: a copy still in transit is bought and is counted, and its
 * state is visible on the copy row itself (#272).
 *
 * One `groupBy` over the disposition flags: at most a handful of rows per stamp, so the whole
 * page's counts cost a single aggregate query rather than a count per row.
 */
export async function countCopiesByStamp(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, StampCopyCounts>> {
  const counts = new Map<string, StampCopyCounts>();
  const ids = [...new Set(stampIds)];
  if (ids.length === 0) return counts;

  const rows = await prisma.item.groupBy({
    by: ["stampId", "inCollection", "forSale", "forTrade"],
    where: { collectionId, stampId: { in: ids }, saleLineItems: { none: {} } },
    _count: { _all: true },
  });

  for (const row of rows) {
    const n = row._count._all;
    const entry = counts.get(row.stampId) ?? { ...NO_COPIES };
    entry.total += n;
    if (row.inCollection) entry.inCollection += n;
    if (row.forSale) entry.forSale += n;
    if (row.forTrade) entry.forTrade += n;
    counts.set(row.stampId, entry);
  }
  return counts;
}
