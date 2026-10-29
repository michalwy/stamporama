// The Completeness screen (#2266) — the pure half: which copies count, how the chosen part of the
// catalogue is summed up, and in what order the incomplete checklists are listed.
//
// The figures themselves are the Issues list's (#531, #661): per checklist, the stamps on it with at
// least one counted copy over the stamps it carries. What this screen adds is **which copies count**
// — the conditions and the dispositions the collector chose — and a sum across every checklist under
// the chosen area and years. With every condition and every disposition chip on, a copy counts
// whatever it is, and a checklist reads exactly what its branch heading on the Issues list reads.

/**
 * A disposition chip. `none` is a copy with no disposition yet — none of the three flags set — so
 * that with all four on every held copy counts, and the screen first agrees with the lists.
 */
export type CompletenessDispositionChip = "in-collection" | "for-sale" | "for-trade" | "none";

export const COMPLETENESS_DISPOSITION_CHIPS: readonly CompletenessDispositionChip[] = [
  "in-collection",
  "for-sale",
  "for-trade",
  "none",
] as const;

export const COMPLETENESS_DISPOSITION_CHIP_LABEL: Record<CompletenessDispositionChip, string> = {
  "in-collection": "In collection",
  "for-sale": "For sale",
  "for-trade": "For trade",
  none: "None",
};

/** The address-bar names of the screen's own two filters; area and year are the shared rail's. */
export const CONDITIONS_PARAM = "conditions";
export const DISPOSITIONS_PARAM = "dispositions";

function isDispositionChip(value: string): value is CompletenessDispositionChip {
  return (COMPLETENESS_DISPOSITION_CHIPS as readonly string[]).includes(value);
}

/**
 * The chips switched on, as the `dispositions` value states them. **Absent is every chip** — the
 * default counts everything held — and so is a value naming none the screen knows, since a filter
 * that matched nothing because of a mistyped address would read as an empty collection.
 */
export function readDispositionChips(value: string | null | undefined): CompletenessDispositionChip[] {
  const chips = (value ?? "").split(",").filter(isDispositionChip);
  if (chips.length === 0) return [...COMPLETENESS_DISPOSITION_CHIPS];
  return COMPLETENESS_DISPOSITION_CHIPS.filter((c) => chips.includes(c));
}

/** The `dispositions` value for a set of chips — empty (the parameter left out) when every one is on. */
export function dispositionChipsValue(chips: readonly CompletenessDispositionChip[]): string {
  const on = COMPLETENESS_DISPOSITION_CHIPS.filter((c) => chips.includes(c));
  return on.length === COMPLETENESS_DISPOSITION_CHIPS.length ? "" : on.join(",");
}

/**
 * The chips after one is clicked. **The last chip on stays on**: with none on, nothing would count
 * and every checklist would read empty, which says nothing about the collection.
 */
export function toggleDispositionChip(
  chips: readonly CompletenessDispositionChip[],
  chip: CompletenessDispositionChip
): CompletenessDispositionChip[] {
  if (chips.includes(chip)) {
    return chips.length === 1 ? [...chips] : chips.filter((c) => c !== chip);
  }
  return COMPLETENESS_DISPOSITION_CHIPS.filter((c) => c === chip || chips.includes(c));
}

/** The conditions chosen, as the `conditions` value states them — empty is every condition. */
export function readConditionIds(value: string | null | undefined): string[] {
  return [...new Set((value ?? "").split(",").filter(Boolean))];
}

/** A copy's three disposition flags. */
export interface DispositionFlags {
  inCollection: boolean;
  forSale: boolean;
  forTrade: boolean;
}

/** Whether a copy carries a chip that is switched on — any one of them is enough. */
export function copyMatchesDispositions(
  copy: DispositionFlags,
  chips: readonly CompletenessDispositionChip[]
): boolean {
  return chips.some((chip) => {
    switch (chip) {
      case "in-collection":
        return copy.inCollection;
      case "for-sale":
        return copy.forSale;
      case "for-trade":
        return copy.forTrade;
      case "none":
        return !copy.inCollection && !copy.forSale && !copy.forTrade;
    }
  });
}

/**
 * The same choice as a Prisma `where` fragment on `Item`, or null when every chip is on and the
 * dispositions narrow nothing. One `OR` branch per chip, so a copy counts on any of them.
 */
export function dispositionChipsWhere(
  chips: readonly CompletenessDispositionChip[]
): { OR: Partial<DispositionFlags>[] } | null {
  if (COMPLETENESS_DISPOSITION_CHIPS.every((c) => chips.includes(c))) return null;
  return {
    OR: chips.map((chip): Partial<DispositionFlags> => {
      switch (chip) {
        case "in-collection":
          return { inCollection: true };
        case "for-sale":
          return { forSale: true };
        case "for-trade":
          return { forTrade: true };
        case "none":
          return { inCollection: false, forSale: false, forTrade: false };
      }
    }),
  };
}

/** One checklist's figure, as the screen reads it. */
export interface ChecklistFigure {
  /** Stamps on the checklist with at least one counted copy. */
  owned: number;
  /** Stamps on the checklist. */
  requiredCount: number;
}

export interface CompletenessSummary {
  /** Stamps held, summed over the checklists — a stamp on two checklists counts on each, as on the
   *  Overview's *Coverage by area* tile: each checklist is a goal of its own. */
  held: number;
  /** Stamps on the checklists, summed the same way. */
  total: number;
  /** Checklists every stamp of which is held. */
  completeChecklists: number;
  /** Checklists under the chosen area and years. */
  checklists: number;
}

/**
 * The summary over the checklists under the chosen area and years. **An empty checklist is left
 * out** — a set of nothing is not an achievement, and it would read as complete.
 */
export function summarizeCompleteness(figures: readonly ChecklistFigure[]): CompletenessSummary {
  let held = 0;
  let total = 0;
  let completeChecklists = 0;
  let checklists = 0;
  for (const f of figures) {
    if (f.requiredCount <= 0) continue;
    checklists += 1;
    held += f.owned;
    total += f.requiredCount;
    if (f.owned >= f.requiredCount) completeChecklists += 1;
  }
  return { held, total, completeChecklists, checklists };
}

/**
 * A share as a whole percentage, **rounded down**: 99.6 % is not 100 %, and the one figure on this
 * screen that must never read complete early is the one a collector stops looking at when it does.
 * Null when there is nothing to be a share of.
 */
export function completenessPercent(held: number, total: number): number | null {
  if (total <= 0) return null;
  return Math.floor((held / total) * 100);
}

/** What the incomplete list needs to order a checklist. */
export interface RankedChecklist extends ChecklistFigure {
  issueYear: number | null;
  issueName: string | null;
  name: string;
}

/**
 * The checklists still missing something, **closest to complete first** — the larger share held
 * first (*11/12* before *1/2*), then the fewer stamps missing (*10/11* before *20/22*), then by
 * the issue's year, the issue's name and the checklist's name, so the order is stable.
 */
export function incompleteClosestFirst<T extends RankedChecklist>(rows: readonly T[]): T[] {
  return rows
    .filter((r) => r.requiredCount > 0 && r.owned < r.requiredCount)
    .sort((a, b) => {
      const share = b.owned / b.requiredCount - a.owned / a.requiredCount;
      if (share !== 0) return share;
      const missing = a.requiredCount - a.owned - (b.requiredCount - b.owned);
      if (missing !== 0) return missing;
      const yearA = a.issueYear ?? Number.MAX_SAFE_INTEGER;
      const yearB = b.issueYear ?? Number.MAX_SAFE_INTEGER;
      if (yearA !== yearB) return yearA - yearB;
      const issue = (a.issueName ?? "").localeCompare(b.issueName ?? "");
      if (issue !== 0) return issue;
      return a.name.localeCompare(b.name);
    });
}
