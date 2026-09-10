/**
 * *How many of a picker's ticks its own filters are hiding* (#1046) — the picker's answer to the
 * question the Copies list answers by narrowing (`rows-in-view.ts`).
 *
 * The rule is in `docs/agents/ui-patterns.md`. A **list** bar acts on the collection and a mistake
 * there writes to rows nobody looked at, so there the ticked rows **in view** are what it counts
 * and hands to an action. A **picker** ends in one explicit submit whose count the collector reads
 * before pressing it, and narrowing there would destroy the workflow the picker exists for —
 * search *Poland*, tick four, search *1950*, tick three, add all seven. So the picker keeps the
 * whole selection and **says how many rows are not on screen**: what the list rule protects is not
 * *an action must not reach a hidden row* but *the collector must not be surprised by what it
 * reached*, and on a picker honesty buys that more cheaply than narrowing.
 *
 * **The count is over every filter the dialog has, not only its search box.** Three of the four
 * pickers carry an area rail and a year facet beside the search, and the area is resolved
 * *server-side* — a tick made under *Poland* is not in the fetched list at all once the rail moves
 * to *France*. Subtracting what is on screen from what is ticked answers all three axes at once
 * without the dialog having to know which one did it, which is why this takes the rows rather than
 * the filters.
 *
 * **A fold is not a filter** and must not reach this. Where a picker draws collapsible groups (the
 * sale-line dialog's quantity offers), a collapsed group's sets are still *in view*: the group row
 * is on screen reporting its own ticks, and a label contradicting it would be two controls on one
 * screen answering one question. Callers pass the rows their filters produced, never the rows
 * their folds happen to be showing.
 *
 * Nothing here writes: the selection goes in and comes out untouched, which is #853's half of the
 * same rule.
 */

/**
 * How many ticked rows the current filters are keeping off screen.
 *
 * `inView` is what the dialog's filters produced — for a client-filtered picker that is the list it
 * renders; a tick the *server* is no longer sending is simply absent from it and is counted here
 * for the same reason.
 */
export function countHiddenTicks(
  ticked: Iterable<string>,
  inView: ReadonlySet<string>
): number {
  let hidden = 0;
  for (const id of ticked) if (!inView.has(id)) hidden += 1;
  return hidden;
}

/**
 * What a submit button adds to its own label, and **nothing at all when nothing is hidden**.
 *
 * *Add 7 (3 hidden by these filters)* is the whole point when it is true; *Add 7 (0 hidden)* is
 * noise on every ordinary use, and ordinary use is most uses (#1046, the user's own addition to
 * the decision). So the empty string is the answer for zero rather than a parenthetical saying so,
 * and a caller appends it unconditionally instead of branching.
 */
export function hiddenTicksSuffix(hidden: number): string {
  return hidden > 0 ? ` (${hidden} hidden by these filters)` : "";
}
