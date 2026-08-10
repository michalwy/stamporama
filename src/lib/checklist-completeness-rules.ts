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
