/**
 * *Which of the ticked rows a list is actually showing* (#1021) — the pure half of
 * **the bar counts and acts on the ticked rows that are in view**.
 *
 * The rule is in `docs/agents/ui-patterns.md`: a filter is a way of looking, so it never unticks
 * anything, and a bulk action never reaches a row the collector cannot see. On the card-scans strip
 * the second half is answerable outright — every tile is loaded, so *in view* is a predicate over
 * the chip (`scan-tile-selection.ts`, `selectedInView`). On a **paginated, grouped** list it is
 * not: the filters are resolved server-side, so nothing on the client can ask whether a copy ticked
 * ten minutes ago still matches a search or an area subtree. What the screen can say is **which
 * rows it holds**, and that is the same answer from the other end — a row is in view exactly when
 * the current filter set produced it.
 *
 * So the lists report what they hold and this pair does the arithmetic: `rowsInView` unions the
 * reports, `selectionInView` narrows the selection to them. The React side — who reports, when a
 * report is dropped, and why a folded group still reports — is `use-rows-in-view.ts`, next to the
 * screen it serves.
 *
 * **The narrowing is a view and never a write.** `selectionInView` returns rows; it does not touch
 * the selection it was given, and nothing here removes anything from one. That is the half #853
 * exists to protect — a filter must not delete a selection — and keeping it out of this module by
 * construction is cheaper than remembering it at each call site.
 */

/** A row as this sees one: an id, and whatever else its screen puts on it. */
export interface IdentifiedRow {
  id: string;
}

/**
 * Every row the reporting lists are holding, as one set.
 *
 * The reports overlap by design rather than by accident — a screen may report its flat pages and a
 * group's members in the same breath — so this is a union and never a concatenation.
 */
export function rowsInView(reported: Iterable<readonly string[]>): Set<string> {
  const all = new Set<string>();
  for (const ids of reported) for (const id of ids) all.add(id);
  return all;
}

/**
 * The ticked rows the screen is showing, in the order they were ticked in.
 *
 * What is **ticked** outlives every filter and is what the bar counts *from*; this is what it
 * counts, labels and hands to an action.
 */
export function selectionInView<T extends IdentifiedRow>(
  selected: readonly T[],
  inView: ReadonlySet<string>
): T[] {
  return selected.filter((row) => inView.has(row.id));
}

/**
 * Whether two reports name the same rows in the same order.
 *
 * A reporter is free to call with an unchanged list — a re-render, a refetch answering with the
 * same page — and a register that stored a fresh array every time would put its own state in a loop
 * with the effects reading it.
 */
export function sameRowIds(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i += 1) if (a[i] !== b[i]) return false;
  return true;
}
