// The stamp list of an issue's checklist editor (#2206). Pure — no Prisma, no React — so the unit
// suite reads the same rule the dialog draws.
//
// The editor shows **one list, not two**: the checklist's own stamps first, in the order the set
// reads (#764), and below them the rest of the issue's stamp tree, unticked. Ticking one of those
// puts it at the end of the order — `setChecklistStamps`' rule for a stamp just ticked — or, on a
// checklist following the issue's order (#2208), at its place in that order; unticking one above
// takes it off, leaving the others where they were.

import { checklistInIssueOrder } from "./issue-member-order";

/** A branch of the issue's stamp tree, as far as this rule reads it. */
export interface StampTreeBranch<N extends { stampId: string }> {
  node: N;
  children: StampTreeBranch<N>[];
}

/** One row of the tree below the checklist. */
export interface RestOfTreeRow<N> {
  node: N;
  depth: number;
  /** A stamp already on the checklist, kept here only because something under it is not — so the
   *  variant reads under the number it hangs from, the Issues list's dimmed-parent rule. */
  onChecklist: boolean;
}

/**
 * The issue's stamps that are **not** on the checklist, in tree order with their depth.
 *
 * A stamp on the checklist leaves this part of the list with every descendant that is on it too;
 * one with a descendant still off it stays as context, so `309AP` is never offered without the
 * `309` it is a variant of.
 */
export function restOfTreeRows<N extends { stampId: string }>(
  tree: readonly StampTreeBranch<N>[],
  onChecklist: ReadonlySet<string>,
  depth = 0
): RestOfTreeRow<N>[] {
  const rows: RestOfTreeRow<N>[] = [];
  for (const branch of tree) {
    const below = restOfTreeRows(branch.children, onChecklist, depth + 1);
    const on = onChecklist.has(branch.node.stampId);
    if (on && below.length === 0) continue;
    rows.push({ node: branch.node, depth, onChecklist: on }, ...below);
  }
  return rows;
}

/**
 * The order once `stampId` is ticked: at the end, unless it is already on. Given the issue's
 * reading — on a checklist that follows the issue's order (#2208) — at its place in it instead.
 */
export function tickStamp(
  order: readonly string[],
  stampId: string,
  issueReading?: readonly string[]
): string[] {
  const ticked = order.includes(stampId) ? [...order] : [...order, stampId];
  return issueReading ? checklistInIssueOrder(issueReading, ticked) : ticked;
}

/** The issue's stamps as its tree reads down the page — the order a checklist following the issue
 *  reads in (#2208), drawn from the same tree the editor shows. */
export function treeReading<N extends { stampId: string }>(
  tree: readonly StampTreeBranch<N>[]
): string[] {
  return tree.flatMap((branch) => [branch.node.stampId, ...treeReading(branch.children)]);
}

/** The order once `stampId` is unticked: the others keep their places. */
export function untickStamp(order: readonly string[], stampId: string): string[] {
  return order.filter((id) => id !== stampId);
}

/** The order once the row at `from` is dropped at `to`, the shared reorder kit's indices. */
export function moveInOrder<T>(order: readonly T[], from: number, to: number): T[] {
  const next = [...order];
  const [moved] = next.splice(from, 1);
  next.splice(to, 0, moved);
  return next;
}
