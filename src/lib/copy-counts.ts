import "server-only";
import { prisma } from "./db";
import { UNAVAILABLE_DELIVERY_STATES } from "./delivery-state";
import { buildDescendantMap } from "./pricing";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";

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
  /** Copies carrying **no** marker at all. Not derivable from the three figures above, precisely
   * because they overlap — 3 copies with 2 in the collection and 2 for sale is either 0 or 1
   * unmarked depending on how they pair up — so it is counted rather than subtracted. It is what
   * lets a breakdown stand on its own without the total beside it. */
  unmarked: number;
}

export const NO_COPIES: StampCopyCounts = {
  total: 0,
  inCollection: 0,
  forSale: 0,
  forTrade: 0,
  unmarked: 0,
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
 * (#207) — a badge that disagreed with the list it opens would be worse than no badge.
 *
 * So are copies no longer **held** (#396): disposed of after delivery (#394), or never arrived in
 * usable form (`not_delivered` / `damaged`). The badge answers "how many of this do I have", and a
 * copy that is gone is not one of them. The in-flight states are deliberately still counted — a
 * copy in transit is bought, and its state is visible on the copy row itself (#272).
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
    where: {
      collectionId,
      stampId: { in: ids },
      saleLineItems: { none: {} },
      disposedAt: null,
      deliveryState: { notIn: [...UNAVAILABLE_DELIVERY_STATES] },
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    const n = row._count._all;
    const entry = counts.get(row.stampId) ?? { ...NO_COPIES };
    entry.total += n;
    if (row.inCollection) entry.inCollection += n;
    if (row.forSale) entry.forSale += n;
    if (row.forTrade) entry.forTrade += n;
    if (!row.inCollection && !row.forSale && !row.forTrade) entry.unmarked += n;
    counts.set(row.stampId, entry);
  }
  return counts;
}

/**
 * Copies held under each stamp's **variant** descendants, for the given stamp ids. Stamps with no
 * such copies are absent from the map — a caller reads them as zero.
 *
 * The counterpart of {@link countCopiesByStamp}, which counts a stamp exactly (#348): together they
 * are the two numbers a catalog row shows (#528) — what you hold *of this stamp*, and what you hold
 * of the specific variants under it. Two numbers rather than one sum, because they answer different
 * questions and the tree already shows each child's own badge one line down.
 *
 * Which descendants count is ADR-0010 §3's rule exactly, as the unknown-variant valuation
 * (#101/#130) and the headline-price rollup (#238) apply it: **every** descendant, at any depth,
 * whose own effective `actsAsVariant` is true (#239 — an intermediate node is as much a variant as
 * a direct child). A descendant that is a distinct entry — an error, a plate flaw, an overprint —
 * is its own thing to collect, not another way of holding this stamp, so it and nothing else is
 * left out; a variant filed under one still counts, since it is a variant of this stamp all the
 * same.
 *
 * The totals come from {@link countCopiesByStamp} rather than a second `groupBy`, so "a copy you
 * hold" cannot come to mean one thing in the first number and another in the second — including
 * the **disposition markers**, which are summed across the counting descendants the same way the
 * total is, so the badge can say what the variant copies are held *for* and not only how many
 * there are.
 */
export async function countVariantDescendantCopies(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, StampCopyCounts>> {
  const totals = new Map<string, StampCopyCounts>();
  const ids = new Set(stampIds);
  if (ids.size === 0) return totals;

  // One recursive CTE for the whole page's subtrees, then one read of their variant flags: the
  // depth is a handful of levels, so this is two queries regardless of how many rows are on screen.
  const descendantsByStamp = await buildDescendantMap(collectionId, ids);
  if (descendantsByStamp.size === 0) return totals;

  const descendantIds = new Set<string>();
  for (const set of descendantsByStamp.values()) for (const id of set) descendantIds.add(id);

  const descendants = await prisma.stamp.findMany({
    where: { id: { in: [...descendantIds] } },
    select: { id: true, ...VARIANT_FLAG_SELECT },
  });
  const isVariant = new Map(descendants.map((s) => [s.id, childIsVariant(s)]));

  const counts = await countCopiesByStamp(
    collectionId,
    descendants.filter(childIsVariant).map((s) => s.id)
  );

  for (const [stampId, set] of descendantsByStamp) {
    const summed: StampCopyCounts = { ...NO_COPIES };
    for (const id of set) {
      if (!isVariant.get(id)) continue;
      const c = counts.get(id);
      if (!c) continue;
      summed.total += c.total;
      summed.inCollection += c.inCollection;
      summed.forSale += c.forSale;
      summed.forTrade += c.forTrade;
      summed.unmarked += c.unmarked;
    }
    if (summed.total > 0) totals.set(stampId, summed);
  }
  return totals;
}

/** The two copy figures a catalog row shows for one stamp: its own copies (#348) and the copies
 * under its variant descendants (#528). Absent ids read as {@link NO_COPIES} on both sides. */
export interface StampCopyCountMaps {
  direct: Map<string, StampCopyCounts>;
  variant: Map<string, StampCopyCounts>;
}

/** Both figures for a page of stamps, loaded together — every surface that shows one shows the
 * other, and a single entry point keeps the pair from drifting apart at the call sites. */
export async function loadStampCopyCounts(
  collectionId: string,
  stampIds: string[]
): Promise<StampCopyCountMaps> {
  const [direct, variant] = await Promise.all([
    countCopiesByStamp(collectionId, stampIds),
    countVariantDescendantCopies(collectionId, stampIds),
  ]);
  return { direct, variant };
}

/** How a `stamp × condition` count is keyed. The separator cannot occur in a cuid, so the two
 * segments are unambiguous — the same trick `marketKeyOf` uses. */
export function stampConditionKey(stampId: string, conditionId: string): string {
  return `${stampId}~${conditionId}`;
}

/**
 * Copies held per `stamp × condition`, keyed by {@link stampConditionKey}. Pairs with no copies are
 * absent from the map — a caller reads them as zero.
 *
 * The condition axis is what an auction lot line is described at (ADR-0021 §7), so this is the
 * figure a bid recommendation states as evidence: *"you already hold 2 of these"* (ADR-0029 §7). It
 * is **shown, never computed with** — an automatic duplicate discount is wrong precisely where this
 * app is strongest, since duplicates are bought deliberately for trade and resale.
 *
 * Exclusions are `countCopiesByStamp`'s exactly — sold, disposed and never-usably-delivered copies
 * are not held — so the two counts cannot disagree about what "having one" means.
 */
export async function countCopiesByStampAndCondition(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  const ids = [...new Set(stampIds)];
  if (ids.length === 0) return counts;

  const rows = await prisma.item.groupBy({
    by: ["stampId", "conditionId"],
    where: {
      collectionId,
      stampId: { in: ids },
      saleLineItems: { none: {} },
      disposedAt: null,
      deliveryState: { notIn: [...UNAVAILABLE_DELIVERY_STATES] },
    },
    _count: { _all: true },
  });

  for (const row of rows) {
    counts.set(stampConditionKey(row.stampId, row.conditionId), row._count._all);
  }
  return counts;
}
