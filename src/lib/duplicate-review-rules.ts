// The Replacements screen's duplicate review (#1938, ADR-0070) — the pure half. No Prisma, so the
// server read and the unit tests share one derivation.
//
// The review lists the stamps held **in the collection** more than once, each with its copies'
// pictures side by side; the collector picks the copy to keep, and every other copy becomes a pair
// replaced by it. "The same stamp" is what duplicate grouping counts (#1932): `copyGroupKey` under
// the *Split by …* switches, so a deliberate mint-and-used pair can be kept apart.

import {
  copyGroupKey,
  encodeCopyGroupKey,
  type CopyGroupAxes,
  type GroupableCopy,
} from "./copy-groups";

/** What the review reads of a copy to decide whether its stack is offered. */
export interface DuplicateReviewCopy extends GroupableCopy {
  id: string;
  itemNo: number;
  stampLabel: string;
  /** Kept, with the rest of its stack, by an earlier *Keep all*. */
  keptAll: boolean;
  /** The copy replacing this one in an open pair, or null. Such a copy is already on its way out. */
  replacedByItemNo: number | null;
}

/** One stack in the review: the copies of one stamp (under the switches) held in the collection. */
export interface DuplicateReviewStack<T extends DuplicateReviewCopy> {
  key: string;
  stampId: string;
  stampLabel: string;
  /** Every copy of the stack, those already being replaced included — shown with their pair. */
  copies: T[];
}

/**
 * Whether a copy is still to be decided on: not already the old copy of an open pair. A copy that
 * is already being replaced is shown with its pair and **not offered twice** — it is neither a
 * keeper nor paired again.
 */
export function isUndecided(copy: { replacedByItemNo: number | null }): boolean {
  return copy.replacedByItemNo == null;
}

/**
 * The stacks the review offers, in the order it lists them.
 *
 * A stack is offered when **two or more** of its copies are still undecided — a stamp whose
 * duplicates are already all in open pairs is settled as far as the review is concerned — and not
 * every one of those carries a *Keep all* mark. A copy joining the collection afterwards has no
 * mark, so it brings the stack back.
 *
 * Listed biggest stack first, as duplicate grouping lists them, then by stamp in catalogue reading
 * order; the copies within a stack by number.
 */
export function duplicateReviewStacks<T extends DuplicateReviewCopy>(
  copies: readonly T[],
  axes: CopyGroupAxes
): DuplicateReviewStack<T>[] {
  const byKey = new Map<string, T[]>();
  for (const copy of copies) {
    const key = encodeCopyGroupKey(copyGroupKey(copy, axes), axes);
    const stack = byKey.get(key);
    if (stack) stack.push(copy);
    else byKey.set(key, [copy]);
  }
  const stacks: DuplicateReviewStack<T>[] = [];
  for (const [key, members] of byKey) {
    const undecided = members.filter(isUndecided);
    if (undecided.length < 2) continue;
    if (undecided.every((c) => c.keptAll)) continue;
    stacks.push({
      key,
      stampId: members[0].stampId,
      stampLabel: members[0].stampLabel,
      copies: [...members].sort((a, b) => a.itemNo - b.itemNo),
    });
  }
  const undecidedCount = (s: DuplicateReviewStack<T>) => s.copies.filter(isUndecided).length;
  return stacks.sort(
    (a, b) =>
      undecidedCount(b) - undecidedCount(a) ||
      a.stampLabel.localeCompare(b.stampLabel, undefined, { numeric: true, sensitivity: "base" }) ||
      a.key.localeCompare(b.key)
  );
}

/**
 * The copies picking `keeperId` pairs: every other undecided copy of the stack, each to be replaced
 * by the keeper. Null when the keeper cannot be picked — not in the stack, or already being
 * replaced itself.
 */
export function keeperReplaces<T extends { id: string; replacedByItemNo: number | null }>(
  stack: readonly T[],
  keeperId: string
): T[] | null {
  const keeper = stack.find((c) => c.id === keeperId);
  if (!keeper || !isUndecided(keeper)) return null;
  return stack.filter((c) => c.id !== keeperId && isUndecided(c));
}
