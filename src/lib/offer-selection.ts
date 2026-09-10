/**
 * *The two writes the offers list makes to its ticked selection* (#1031) — the pure half of
 * **a filter never unticks anything**, on the surface where that rule is easiest to undo by
 * accident.
 *
 * The rule is in `docs/agents/ui-patterns.md`: a filter is a way of looking, so it never unticks
 * anything, and a bulk action never reaches a row the collector cannot see. The **narrowing** half
 * is `rows-in-view.ts` and is shared with the Copies list; this module is deliberately not there,
 * because that one's own invariant is that it never writes to a selection — *the narrowing is a
 * view and never a write* — and both functions here are writes.
 *
 * **They are here rather than inline because they are where the rule goes quietly wrong.** Each
 * used to be one expression in `offers-list-panel.tsx` that was correct while a filter change
 * threw the whole selection away, and is wrong the moment it does not: both reached every ticked
 * offer, and under the new rule some of those are rows the collector cannot see. Neither failure
 * shows on screen — the bar's count is right either way, and what is gone is a tick that was going
 * to come back when the filter was released.
 */

/** A row as this sees one: an id, and whatever else the list puts on it. */
export interface IdentifiedRow {
  id: string;
}

/**
 * *Select all* / *deselect all* over the rows the list is showing.
 *
 * The box is a control over **everything here**, and *here* is the rows loaded for the current
 * filter set — so it ticks or unticks exactly those and **never touches a tick the filter is
 * hiding**. Replacing the whole selection with the loaded rows is the shape that was there before
 * and it fails in both directions: ticking the box would drop the hidden ticks, and unticking it
 * would clear them without saying so. That second one is *Clear*'s job, which is the collector
 * saying they are done and which announces what it reaches.
 *
 * It unticks when every row in view is already ticked and ticks otherwise, which is the same
 * question the box's own `checked` asks.
 */
export function toggleRowsInView<T extends IdentifiedRow>(
  selected: ReadonlyMap<string, T>,
  rows: readonly T[]
): Map<string, T> {
  const next = new Map(selected);
  if (rows.length > 0 && rows.every((row) => selected.has(row.id))) {
    for (const row of rows) next.delete(row.id);
  } else {
    for (const row of rows) next.set(row.id, row);
  }
  return next;
}

/**
 * What stays ticked after a bulk run.
 *
 * Two rules, and only the first was ever written down. **Exactly the refused offers stay ticked**
 * — they are what is left to deal with, and a selection left whole after the fact is an invitation
 * to run it a second time. **And a tick the filter was hiding stays too**, because it was never in
 * the batch: the run neither succeeded nor was refused over it, so there is nothing about it that
 * the run has settled. Dropping it would let a bulk action untick a row the collector cannot see,
 * which is the same failure as acting on one.
 */
export function keptAfterBulkRun<T>(
  selected: ReadonlyMap<string, T>,
  batchIds: Iterable<string>,
  refusedIds: Iterable<string>
): Map<string, T> {
  const refused = new Set(refusedIds);
  const next = new Map(selected);
  for (const id of batchIds) if (!refused.has(id)) next.delete(id);
  return next;
}
