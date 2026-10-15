// Replacement pairs (#1936, ADR-0070) — the vocabulary and the decisions that need no database.
//
// A pair is a **new** copy that replaces an **old** one in the collection. It is recorded once and
// settled later: *Done* puts the old copy on the sale card being packed, takes it out of the
// collection and marks it for sale. Pure, so the Replacements screen, the copy's own page and the
// domain module read one vocabulary.

import { compareLocationRef } from "./location-ref";

export const REPLACEMENT_STATUSES = ["open", "done", "cancelled", "moot"] as const;
export type ReplacementStatus = (typeof REPLACEMENT_STATUSES)[number];

/** How a copy can leave the collector's hands before its pair is settled — each closes the pair as
 * moot, since there is then nothing left to swap. */
export const MOOT_REASONS = ["sold", "traded", "disposed", "deleted"] as const;
export type MootReason = (typeof MOOT_REASONS)[number];

export type ReplacementSide = "new" | "old";

export function isReplacementStatus(value: string): value is ReplacementStatus {
  return (REPLACEMENT_STATUSES as readonly string[]).includes(value);
}

export function isMootReason(value: string): value is MootReason {
  return (MOOT_REASONS as readonly string[]).includes(value);
}

/** What a pair-closing read needs to know about one of its copies; null for a copy that was deleted. */
export interface ReplacementCopyState {
  sold: boolean;
  tradedAway: boolean;
  disposed: boolean;
}

/**
 * Why a copy no longer belongs in an open pair, or null when it still does. Deleted first (there is
 * nothing else to say about it), then sold, traded and disposed — the order a collector would name
 * them in, since a copy is only ever one of them in practice.
 */
export function copyMootReason(copy: ReplacementCopyState | null): MootReason | null {
  if (copy == null) return "deleted";
  if (copy.sold) return "sold";
  if (copy.tradedAway) return "traded";
  if (copy.disposed) return "disposed";
  return null;
}

/** Whether an open pair has become moot, and through which copy. The old copy is asked first: it is
 * the one the pair exists to move, so its departure is the more telling reason. */
export function pairMootReason(
  newCopy: ReplacementCopyState | null,
  oldCopy: ReplacementCopyState | null
): { reason: MootReason; side: ReplacementSide } | null {
  const oldReason = copyMootReason(oldCopy);
  if (oldReason) return { reason: oldReason, side: "old" };
  const newReason = copyMootReason(newCopy);
  if (newReason) return { reason: newReason, side: "new" };
  return null;
}

const MOOT_VERBS: Record<MootReason, string> = {
  sold: "was sold",
  traded: "was traded away",
  disposed: "is no longer held",
  deleted: "was deleted",
};

/** How a closed pair's status reads — *Done*, *Cancelled*, or the moot reason as a sentence naming
 * the copy: *Closed — #123 was sold*. `copyLabel` formats a copy number the way the screen does. */
export function describeReplacementStatus(
  pair: {
    status: string;
    mootReason: string | null;
    mootSide: string | null;
    newItemNo: number;
    oldItemNo: number;
  },
  copyLabel: (itemNo: number) => string
): string {
  switch (pair.status) {
    case "open":
      return "Open";
    case "done":
      return "Done";
    case "cancelled":
      return "Cancelled";
    case "moot": {
      const reason = pair.mootReason && isMootReason(pair.mootReason) ? pair.mootReason : null;
      if (!reason) return "Closed";
      const itemNo = pair.mootSide === "new" ? pair.newItemNo : pair.oldItemNo;
      return `Closed — ${copyLabel(itemNo)} ${MOOT_VERBS[reason]}`;
    }
    default:
      return pair.status;
  }
}

/** Where an old copy lies, as the Replacements screen orders them. */
export interface ReplacementPlace {
  /** The location's full path (`Stockbooks › Blue › Page 3`), or null for a copy stored nowhere. */
  locationPath: string | null;
  locationRef: string | null;
  oldItemNo: number;
}

/**
 * The order open pairs are listed in: **by where the old copy lies** — location, then the ref in
 * walk order (`compareLocationRef`) — so the list is the round to take them out in. Copies stored
 * nowhere come last; the copy number keeps the order stable.
 */
export function compareReplacementPlace(a: ReplacementPlace, b: ReplacementPlace): number {
  if (a.locationPath !== b.locationPath) {
    if (a.locationPath == null) return 1;
    if (b.locationPath == null) return -1;
    const byPath = a.locationPath.localeCompare(b.locationPath, undefined, {
      numeric: true,
      sensitivity: "base",
    });
    if (byPath !== 0) return byPath;
  }
  return compareLocationRef(a.locationRef, b.locationRef) || a.oldItemNo - b.oldItemNo;
}

/** Why a pair cannot be recorded, as the collector reads it; null when it can. Each copy is described
 * by its number, whether it is still held, and the open pairs it is already in on each side. */
export function replacementConflict(input: {
  newCopy: { itemNo: number; gone: MootReason | null; openAsNew: boolean };
  oldCopy: { itemNo: number; gone: MootReason | null; openAsOld: boolean };
  copyLabel: (itemNo: number) => string;
}): string | null {
  const { newCopy, oldCopy, copyLabel } = input;
  if (newCopy.itemNo === oldCopy.itemNo) return "A copy cannot replace itself.";
  if (newCopy.gone) return `${copyLabel(newCopy.itemNo)} ${MOOT_VERBS[newCopy.gone]}.`;
  if (oldCopy.gone) return `${copyLabel(oldCopy.itemNo)} ${MOOT_VERBS[oldCopy.gone]}.`;
  if (newCopy.openAsNew) {
    return `${copyLabel(newCopy.itemNo)} already replaces another copy — cancel that pair first.`;
  }
  if (oldCopy.openAsOld) {
    return `${copyLabel(oldCopy.itemNo)} is already being replaced — cancel that pair first.`;
  }
  return null;
}
