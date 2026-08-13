// Completeness of a checklist read off the copies actually held (#519, the disposition × condition
// half of #133; #531 made the subject a checklist rather than an issue). Pure: the caller supplies
// the checklist's stamps and one count per (stamp × condition × disposition), and gets back the
// grid the detail screen draws.
//
// Two figures, and they answer different questions. **Owned** is how many of the checklist's
// stamps are held at all — the progress bar. **Complete sets** is the *minimum* count across every
// stamp on it — how many times over the whole set can be assembled, which is the figure that
// says whether a duplicate is a spare or the only one. A single missing stamp makes it zero
// however deep the pile of the others is, and that is the point.

/** Which copies a completeness figure counts. Not a partition: a copy can be in the collection
 *  *and* for sale, so the disposition rows overlap and `any` is never their sum. */
export type CompletenessDisposition = "any" | "in_collection" | "for_sale" | "for_trade";

export const COMPLETENESS_DISPOSITIONS: readonly CompletenessDisposition[] = [
  "any",
  "in_collection",
  "for_sale",
  "for_trade",
] as const;

export const COMPLETENESS_DISPOSITION_LABEL: Record<CompletenessDisposition, string> = {
  any: "Any",
  in_collection: "In collection",
  for_sale: "For sale",
  for_trade: "For trade",
};

/** One copy's worth of counted facts — what the `groupBy` behind this module hands over. */
export interface CompletenessCount {
  stampId: string;
  conditionId: string;
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
  count: number;
}

/** One cell of the grid: a disposition against a condition (`null` = any condition). */
export interface CompletenessRow {
  disposition: CompletenessDisposition;
  conditionId: string | null;
  /** Stamps on the checklist with at least one matching copy. */
  owned: number;
  /** Times over the whole checklist can be assembled from matching copies. */
  completeSets: number;
}

export interface ChecklistCompletenessGrid {
  /** How many stamps the checklist carries — the denominator of every `owned` figure. */
  requiredCount: number;
  /** Every (disposition × condition) cell, plus the `conditionId: null` roll-up per disposition.
   *  Cells with nothing owned are kept: an empty column is what says the condition is untouched. */
  rows: CompletenessRow[];
}

/**
 * How close one checklist's **for-sale** stock is to a complete set (#563), and which of its stamps
 * are missing.
 *
 * The narrow slice of the grid above, on a different surface and with one thing the grid cannot
 * say: `owned` is the same figure `for_sale × any condition` reports, but a fraction alone does not
 * tell a collector working through a stockbook what to look for on the next card. So this names the
 * gap, and the grid does not — id lists in every cell of a disposition × condition matrix would be
 * a payload nobody reads them out of.
 *
 * **Two sets in, two figures out.** `stockStampIds` is what the collection holds for sale *anywhere*
 * and leads, because it answers the question that provokes an action — *can I list this?* A figure
 * scoped to the lot alone reads `5/6` about a series whose sixth copy has been in the box for six
 * months, and sends the collector looking for a stamp they already own; the **missing** stamps are
 * named against the same set, for the same reason. `fromLotStampIds` is the quiet second figure —
 * how much of this arrived just now — which is what separates a series being built out of this
 * parcel, where the sixth may yet surface from the copies not sorted yet, from one assembled months
 * ago, where there is nothing to wait for.
 *
 * Which copies are in either set is the caller's: this decides nothing about delivery or disposition,
 * so a query and a test cannot disagree about what "in hand and for sale" means.
 *
 * `fromHere` is intersected with the stock rather than counted on its own. The lot's copies *are*
 * part of the collection's stock, so the two agree by construction — but a figure whose second half
 * can exceed its first is one nobody can read, and one line of arithmetic is cheaper than trusting
 * two queries to stay in step.
 *
 * An empty checklist is nothing to be complete against: `0/0` with nothing missing, never "complete".
 */
export function computeForSaleSetCompleteness(
  checklistStampIds: readonly string[],
  stockStampIds: Iterable<string>,
  fromLotStampIds: Iterable<string>
): ForSaleSetCompleteness {
  const required = [...new Set(checklistStampIds)];
  const stock = new Set(stockStampIds);
  const fromLot = new Set(fromLotStampIds);

  let owned = 0;
  let fromHere = 0;
  const missingStampIds: string[] = [];
  for (const stampId of required) {
    if (stock.has(stampId)) {
      owned += 1;
      if (fromLot.has(stampId)) fromHere += 1;
    } else {
      missingStampIds.push(stampId);
    }
  }
  return { requiredCount: required.length, owned, fromHere, missingStampIds };
}

/** One checklist's for-sale reading, counted over the copies the caller decided are in hand. */
export interface ForSaleSetCompleteness {
  /** Stamps on the checklist — the denominator, and `requiredCount` on the grid above. */
  requiredCount: number;
  /** Of those, the ones the collection holds a for-sale copy of. */
  owned: number;
  /** Of the owned ones, the ones this lot contributed a for-sale copy of. */
  fromHere: number;
  /** The rest, in the checklist's own order — what the header names as still to look for. */
  missingStampIds: string[];
}

function matches(c: CompletenessCount, disposition: CompletenessDisposition): boolean {
  switch (disposition) {
    case "any":
      return true;
    case "in_collection":
      return c.inCollection;
    case "for_sale":
      return c.forSale;
    case "for_trade":
      return c.forTrade;
  }
}

/**
 * The completeness grid for one checklist.
 *
 * `checklistStampIds` is the checklist's membership — the same set the list row's badge counts, so
 * the page and the row cannot disagree. An empty checklist has nothing to be complete against:
 * every cell is zero rather than "complete", because a set of nothing is not an achievement.
 */
export function computeChecklistCompleteness(
  checklistStampIds: string[],
  counts: CompletenessCount[],
  conditionIds: string[]
): ChecklistCompletenessGrid {
  const required = [...new Set(checklistStampIds)];
  const rows: CompletenessRow[] = [];

  for (const disposition of COMPLETENESS_DISPOSITIONS) {
    for (const conditionId of [null, ...conditionIds]) {
      const perStamp = new Map<string, number>();
      for (const c of counts) {
        if (!matches(c, disposition)) continue;
        if (conditionId !== null && c.conditionId !== conditionId) continue;
        perStamp.set(c.stampId, (perStamp.get(c.stampId) ?? 0) + c.count);
      }
      let owned = 0;
      let completeSets = required.length === 0 ? 0 : Infinity;
      for (const stampId of required) {
        const n = perStamp.get(stampId) ?? 0;
        if (n > 0) owned += 1;
        if (n < completeSets) completeSets = n;
      }
      rows.push({
        disposition,
        conditionId,
        owned,
        completeSets: Number.isFinite(completeSets) ? completeSets : 0,
      });
    }
  }

  return { requiredCount: required.length, rows };
}
