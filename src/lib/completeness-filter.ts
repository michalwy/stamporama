// ── The Copies list's *Complete* filter (#1884) ─────────────────────────────
//
// Grouped by issue, the list states each issue's completeness as a line of chips (#594/#1859). This
// filter is the same statement turned into a narrowing: it keeps the issues whose chips say
// complete — or the ones whose chips say not — so the collector looking for series to offer whole
// does not scroll past every incomplete one. The rule lives here, pure, so the server's narrowing
// and the header's chips decide *which checklists have chips* by one sentence.

/**
 * The filter's values. **Absent is *All*** — the default, and not a value of its own, so an
 * untouched list and a cleared one key the same query (`MultiStampFilter`'s rule).
 *
 * - `any` — some checklist of the issue has its *Any* chip at n/n: every stamp held, in whatever
 *   conditions (#1859). The value the control turns on with.
 * - `one` — some checklist has a **single condition's** chip at n/n. Always a subset of `any`.
 * - `incomplete` — the issues with chips and none of them complete in any condition: the rest.
 */
export type CompletenessFilter = "any" | "one" | "incomplete";

export const COMPLETENESS_FILTERS: readonly CompletenessFilter[] = ["any", "one", "incomplete"];

/** Read a filter value off a query string or storage. Anything unrecognised is **no filter** rather
 *  than an unmatchable one: a stale or hand-edited link should show the list, not an empty screen. */
export function asCompletenessFilter(
  value: string | null | undefined
): CompletenessFilter | undefined {
  return (COMPLETENESS_FILTERS as readonly string[]).includes(value ?? "")
    ? (value as CompletenessFilter)
    : undefined;
}

/** What the rule needs of one checklist's figures — the shape the header's chips are drawn from
 *  (`IssueGroupChecklistCompleteness`), structurally, so this module stays free of the server. */
export interface ChecklistCompletenessFigures {
  requiredCount: number;
  /** Stamps held in at least one condition — the *Any* chip. */
  owned: number;
  /** One per condition something is held in — the condition chips. */
  conditions: readonly { owned: number }[];
}

/**
 * Whether a checklist draws a chip line at all. A checklist with nothing held of it, and an empty
 * one, fall away rather than printing `0/0` — the chips *are* the statement — so they are also
 * nothing for the filter to judge.
 */
export function hasCompletenessChips(checklist: ChecklistCompletenessFigures): boolean {
  return checklist.requiredCount > 0 && checklist.conditions.length > 0;
}

/**
 * Whether one issue answers a filter value, from its checklists' figures — exactly the figures its
 * header draws, so the filter and the chips on screen cannot disagree.
 *
 * **Any checklist decides** (the collector, 2026-10-13): an issue carrying a basic set and a
 * finer one is complete when either is, and *incomplete* when none is. An issue with no chips —
 * no checklist, or nothing held of any — is **neither**, and is left out by every value.
 */
export function issueMatchesCompleteness(
  checklists: readonly ChecklistCompletenessFigures[],
  filter: CompletenessFilter
): boolean {
  const judged = checklists.filter(hasCompletenessChips);
  if (judged.length === 0) return false;
  const completeInAny = judged.some((c) => c.owned === c.requiredCount);
  switch (filter) {
    case "any":
      return completeInAny;
    case "one":
      return judged.some((c) => c.conditions.some((k) => k.owned === c.requiredCount));
    case "incomplete":
      return !completeInAny;
  }
}
