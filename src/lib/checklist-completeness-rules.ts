// Completeness of a checklist read off the copies actually held (#519, the disposition × condition
// half of #133; #531 made the subject a checklist rather than an issue; #133's format axis
// completes it). Pure: the caller supplies the checklist's stamps and one count per
// (stamp × condition × disposition × format), and gets back the grid the detail screen draws.
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
  /** ADR-0020: `null` **is** a value here — it means single, and no dictionary row exists for it. */
  formatId: string | null;
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

/** One format's grid — the same cells, counted over copies of that format alone. */
export interface ChecklistFormatCompleteness {
  /** `null` is a single (ADR-0020), and it is a format like any other here. */
  formatId: string | null;
  rows: CompletenessRow[];
}

export interface ChecklistCompletenessGrid {
  /** How many stamps the checklist carries — the denominator of every `owned` figure. */
  requiredCount: number;
  /** Every (disposition × condition) cell **across all formats**, plus the `conditionId: null`
   *  roll-up per disposition. Cells with nothing owned are kept: an empty column is what says the
   *  condition is untouched. */
  rows: CompletenessRow[];
  /** The same grid per format, and **only for the formats actually held** (#133). Format is sparse
   *  where condition is not — a collection holds singles for nearly everything and blocks for a
   *  handful — so an empty grid per dictionary row would be a wall of zeros nobody asked for, and
   *  a checklist held in singles alone yields exactly one entry, which the card then draws as the
   *  plain grid it always was. Single first, then the caller's dictionary order. */
  formats: ChecklistFormatCompleteness[];
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

/** One copy tally the condition line is computed from — the `groupBy` behind it hands one row per
 *  (stamp × condition), the disposition and format axes having been decided by the list's filters
 *  rather than by this reading. */
export interface ConditionCompletenessCount {
  stampId: string;
  conditionId: string;
  count: number;
}

/** One chip on an issue group header: a condition (`null` = every condition), and how far the
 *  checklist has got in it. */
export interface ConditionCompletenessCell {
  conditionId: string | null;
  owned: number;
  completeSets: number;
}

/** One checklist's condition line — the roll-up first, then the conditions it is actually held in. */
export interface ConditionCompleteness {
  /** Stamps on the checklist — the denominator of every `owned` figure below. */
  requiredCount: number;
  /** Every condition something is held in, in the caller's dictionary order. */
  conditions: ConditionCompletenessCell[];
  /** The same figures over every condition at once — *have I got the series at all*. */
  any: ConditionCompletenessCell;
}

/**
 * How complete one checklist is, broken down by condition (#594) — the Copies list's issue group
 * header, where the grid on the issue's own page would not fit.
 *
 * The **disposition axis is missing on purpose**, and that is the difference from
 * {@link computeChecklistCompleteness}. The grid asks its question of the whole collection, so it
 * has to say which copies it means; a group header describes the rows underneath it, so the copies
 * it counts are whichever ones the list's filters have already chosen. Which is also why the caller
 * passes plain tallies here rather than {@link CompletenessCount}s: there are no disposition flags
 * left to decide anything with.
 *
 * **Sparse where the grid is dense.** The grid keeps an empty column because an untouched condition
 * is something a matrix can afford to state; a header cannot, and a series held in singles of one
 * condition would otherwise pay for a chip per dictionary row. So only the conditions with a copy
 * behind them get a cell — a stamp counted here is one the checklist actually names, so a copy held
 * for a neighbouring specialized set opens no column, the format axis's own rule (#133).
 *
 * An empty checklist is nothing to be complete against: `0/0`, no conditions, never "complete".
 */
export function computeConditionCompleteness(
  checklistStampIds: readonly string[],
  counts: readonly ConditionCompletenessCount[],
  conditionIds: readonly string[]
): ConditionCompleteness {
  const required = [...new Set(checklistStampIds)];
  const requiredSet = new Set(required);
  const mine = counts.filter((c) => c.count > 0 && requiredSet.has(c.stampId));

  const tally = (predicate: (c: ConditionCompletenessCount) => boolean) => {
    const perStamp = new Map<string, number>();
    for (const c of mine) {
      if (!predicate(c)) continue;
      perStamp.set(c.stampId, (perStamp.get(c.stampId) ?? 0) + c.count);
    }
    return cell(required, perStamp);
  };

  const held = new Set(mine.map((c) => c.conditionId));
  return {
    requiredCount: required.length,
    conditions: conditionIds
      .filter((id) => held.has(id))
      .map((conditionId) => ({
        conditionId,
        ...tally((c) => c.conditionId === conditionId),
      })),
    any: { conditionId: null, ...tally(() => true) },
  };
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
 * One cell's two figures, over a tally of how many matching copies each stamp has.
 *
 * The whole arithmetic of this module: **owned** counts the checklist's stamps with at least one
 * copy, **completeSets** is the minimum over every one of them. Shared by the grid and by the
 * condition line (#594) so a figure read on an issue's page and the same figure read on a group
 * header cannot be computed two ways.
 */
function cell(required: string[], perStamp: Map<string, number>): { owned: number; completeSets: number } {
  let owned = 0;
  let completeSets = required.length === 0 ? 0 : Infinity;
  for (const stampId of required) {
    const n = perStamp.get(stampId) ?? 0;
    if (n > 0) owned += 1;
    if (n < completeSets) completeSets = n;
  }
  return { owned, completeSets: Number.isFinite(completeSets) ? completeSets : 0 };
}

/** Every cell of one grid, over the counts the caller has already narrowed to a format (or not). */
function gridRows(
  required: string[],
  counts: CompletenessCount[],
  conditionIds: string[]
): CompletenessRow[] {
  const rows: CompletenessRow[] = [];
  for (const disposition of COMPLETENESS_DISPOSITIONS) {
    for (const conditionId of [null, ...conditionIds]) {
      const perStamp = new Map<string, number>();
      for (const c of counts) {
        if (!matches(c, disposition)) continue;
        if (conditionId !== null && c.conditionId !== conditionId) continue;
        perStamp.set(c.stampId, (perStamp.get(c.stampId) ?? 0) + c.count);
      }
      rows.push({ disposition, conditionId, ...cell(required, perStamp) });
    }
  }
  return rows;
}

/**
 * The completeness grid for one checklist.
 *
 * `checklistStampIds` is the checklist's membership — the same set the list row's badge counts, so
 * the page and the row cannot disagree. An empty checklist has nothing to be complete against:
 * every cell is zero rather than "complete", because a set of nothing is not an achievement.
 *
 * **Format is a third axis, and a multiple is never decomposed** (ADR-0020, #133). A block of four
 * does not count toward a set of singles, exactly as a used copy does not count toward a mint set —
 * so a per-format grid counts copies of that format and nothing else. `rows` stays the roll-up
 * across every format, which is the honest answer to "have I got the series at all": it is the same
 * mixing the `conditionId: null` column already does down the condition axis, and it is not a claim
 * that a pair is two singles.
 *
 * `formatIds` is only the dictionary's **order**; which formats appear is decided by what the
 * checklist's copies are actually held in.
 */
export function computeChecklistCompleteness(
  checklistStampIds: string[],
  counts: CompletenessCount[],
  conditionIds: string[],
  formatIds: string[] = []
): ChecklistCompletenessGrid {
  const required = [...new Set(checklistStampIds)];
  const requiredSet = new Set(required);

  // Presence is judged over this checklist's own stamps: a block held for a neighbouring
  // specialized set is no reason to open a Blocks column on the basic one.
  const held = new Set<string | null>();
  for (const c of counts) {
    if (c.count > 0 && requiredSet.has(c.stampId)) held.add(c.formatId);
  }
  const presentFormats: (string | null)[] = [
    ...(held.has(null) ? [null] : []),
    ...formatIds.filter((id) => held.has(id)),
  ];

  return {
    requiredCount: required.length,
    rows: gridRows(required, counts, conditionIds),
    formats: presentFormats.map((formatId) => ({
      formatId,
      rows: gridRows(
        required,
        counts.filter((c) => c.formatId === formatId),
        conditionIds
      ),
    })),
  };
}
