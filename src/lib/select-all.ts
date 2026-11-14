// Select all on the Copies list (#2538) — the pure half. No React, no Prisma, so the server read,
// the panel and the unit tests share one derivation.
//
// Select all is two steps, as in Gmail, settled with the collector on 2026-11-15: the header box
// ticks **what is loaded on screen**, and only then does the selection bar offer to extend to
// **every copy matching the filters**, naming the count. The second step is the one place a bulk
// action reaches rows that are not drawn — said out loud, with the number, before it is taken.
//
// In a grouped view the header box ticks each loaded group **by the rule its own box follows**
// (#398): an outlier of a duplicate group stays out. The extended selection follows the same rule
// across every matching group, so the two steps never disagree about which copies "all" means.

import { encodeCopyGroupKey, copyGroupKey, outlierCopyIds } from "./copy-groups";
import type { CopyGroupAxes, GroupableCopy } from "./copy-groups";

/** A loaded group's answer to "are your copies ticked?", as its own select-all box reads it.
 *  `empty` is a group with nothing its box could tick — every member an outlier or no longer held —
 *  and is left out of the header's reading rather than holding it at *partly*. */
export type GroupSelectState = "all" | "some" | "none" | "empty";

export interface HeaderBoxState {
  checked: boolean;
  /** Some, but not all, of what the box speaks for is ticked. */
  partial: boolean;
}

/** The header box over a **flat** list: the loaded copies a box can tick, against the selection. */
export function flatHeaderBoxState(
  loadedSelectableIds: readonly string[],
  selected: ReadonlySet<string>
): HeaderBoxState {
  const ticked = loadedSelectableIds.filter((id) => selected.has(id)).length;
  const checked = loadedSelectableIds.length > 0 && ticked === loadedSelectableIds.length;
  return { checked, partial: !checked && ticked > 0 };
}

/** The header box over a **grouped** list: every loaded group's own box, read together. Checked
 *  only when every group with something to tick has all of it ticked. */
export function groupedHeaderBoxState(states: Iterable<GroupSelectState>): HeaderBoxState {
  let counted = 0;
  let all = 0;
  let some = 0;
  for (const state of states) {
    if (state === "empty") continue;
    counted += 1;
    if (state === "all") all += 1;
    else if (state === "some") some += 1;
  }
  const checked = counted > 0 && all === counted;
  return { checked, partial: !checked && all + some > 0 };
}

/** A copy as the selectable-set read sees it: its grouping fields and whether a box is offered. */
export interface SelectableCandidate extends GroupableCopy {
  id: string;
  /** Still held — the Copies list's checkbox rule since #682 (`disposedAt == null`). */
  held: boolean;
}

/**
 * Which copies **"every copy matching the filters"** means, given the list's grouping.
 *
 * Flat, by place or by issue: every matching copy still held. Grouped as duplicates, the stacks
 * (`stacks`, the copies a duplicate group can hold) lose their **outliers**, computed exactly as a
 * group row computes them — over all of the group's members, held or not, since the row's members
 * are the list's own — and the pieces (`pieces`, the multi-stamp bucket) are taken whole, that
 * bucket's box having no axis to be an outlier on.
 *
 * The order is the order given, so a caller reading in list order keeps it.
 */
export function selectableMatchingIds(
  stacks: readonly SelectableCandidate[],
  pieces: readonly SelectableCandidate[],
  axes: CopyGroupAxes | null
): string[] {
  if (!axes) return [...stacks, ...pieces].filter((c) => c.held).map((c) => c.id);

  const groups = new Map<string, SelectableCandidate[]>();
  for (const copy of stacks) {
    const key = encodeCopyGroupKey(copyGroupKey(copy, axes), axes);
    const members = groups.get(key);
    if (members) members.push(copy);
    else groups.set(key, [copy]);
  }
  const outliers = new Set<string>();
  for (const members of groups.values()) {
    for (const id of outlierCopyIds(members, axes)) outliers.add(id);
  }
  return [
    ...stacks.filter((c) => c.held && !outliers.has(c.id)),
    ...pieces.filter((c) => c.held),
  ].map((c) => c.id);
}

/**
 * What the selection bar offers once the header box is ticked (#2538).
 *
 * - `extend`: more copies match than are ticked — offer *Select all N copies matching the filters*.
 * - `all`: every matching copy is ticked — the bar says *All N copies selected*.
 * - `none`: nothing to say — the header box is not ticked, or the count is not known yet.
 *
 * Offered only while the header box is ticked, so the offer follows the act it extends rather than
 * standing on the bar under any hand-made selection.
 */
export type SelectAllOffer =
  | { kind: "none" }
  | { kind: "extend"; total: number; missing: string[] }
  | { kind: "all"; total: number };

export function selectAllOffer({
  headerChecked,
  matchingIds,
  selected,
}: {
  headerChecked: boolean;
  matchingIds: readonly string[] | undefined;
  selected: ReadonlySet<string>;
}): SelectAllOffer {
  if (!headerChecked || !matchingIds || matchingIds.length === 0) return { kind: "none" };
  const missing = matchingIds.filter((id) => !selected.has(id));
  if (missing.length > 0) return { kind: "extend", total: matchingIds.length, missing };
  return { kind: "all", total: matchingIds.length };
}
