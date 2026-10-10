// **What an offer's sets cost, while some of their copies' cost is still pending** (#1736).
//
// Everywhere else a copy on an open lot is counted as *pending* and kept out of a total (#1696): a
// holdings figure, the Overview, profit and loss. An offer's COST is the one exception, because it
// is the figure an asking price is set against, and *—* tells the collector nothing at the moment
// they are pricing. So here a pending copy is counted at **its estimate** — the figure its purchase
// order and its own page show — and the result is marked as an estimate wherever any copy under it
// is pending. A pending copy with no possible estimate leaves the figure incomplete and is named.
//
// Pure: `offers.ts` feeds it the frozen side (from the set's holdings summary) and each pending
// copy's estimate (from `cost-estimates.ts`), so the unit suite can hold the rule. The Lot builder's
// proposed lot is costed by the same rule from its copies' own fields (`copiesCost`, #1743).

import { resolveCostBasis, type CostBasisInput } from "./cost-basis";

/** A pending copy of a set, as the offer's COST needs it. */
export interface OfferPendingCopy {
  /** The copy's label, for the hint naming the copies without a figure. */
  label: string;
  /** Its estimated cost, base currency, or null when none can be made. */
  estimate: number | null;
}

/** One set's COST under #1736's rule. Every amount is a base-currency 2-dp string. */
export interface OfferSetCost {
  /** Known cost bases plus the pending copies' estimates; null when there is neither. */
  amount: string | null;
  /** Copies counted at their frozen cost basis. */
  knownCount: number;
  /** Pending copies counted at their estimate. */
  estimatedCount: number;
  /** Pending copies with no estimate — left out of {@link amount}, and named. */
  unestimated: string[];
  /** Copies with no cost recorded at all (not pending): left out, as everywhere. */
  noneCount: number;
  /** {@link amount} leans on an open lot — an estimate, or a gap where one could not be made. */
  estimated: boolean;
}

const cents = (amount: number) => Math.round(amount * 100);

/**
 * A set's COST: its frozen cost bases (`known.total` over `known.count` copies) plus the estimate of
 * each pending copy that has one.
 */
export function offerSetCost(
  known: { total: string; count: number; noneCount: number },
  pending: readonly OfferPendingCopy[]
): OfferSetCost {
  let total = known.count > 0 ? cents(Number(known.total)) : 0;
  let estimatedCount = 0;
  const unestimated: string[] = [];
  for (const copy of pending) {
    if (copy.estimate == null) {
      unestimated.push(copy.label);
    } else {
      total += cents(copy.estimate);
      estimatedCount++;
    }
  }
  const counted = known.count + estimatedCount;
  return {
    amount: counted === 0 ? null : (total / 100).toFixed(2),
    knownCount: known.count,
    estimatedCount,
    unestimated,
    noneCount: known.noneCount,
    estimated: pending.length > 0,
  };
}

/** A copy as {@link copiesCost} reads it: its cost-basis inputs, whether its lot is on an opening
 *  balance, the estimate a list read already carries while it is pending (#1696), and its label. */
export interface CopyCostInput extends CostBasisInput {
  openingBalance: boolean;
  /** Base-currency 2-dp estimate while pending, or null when none can be made. */
  costEstimate: string | null;
  label: string;
}

/**
 * What one copy contributes to {@link copiesCost} (#1746) — the figure a Lot builder row shows beside
 * its catalogue value. The summary is the sum of these, so a row and the total cannot disagree:
 *
 *  - `known` — its frozen cost basis;
 *  - `estimate` — pending on an open lot, at the estimate its purchase order shows;
 *  - `missing` — no figure, and why: `pending` (an open lot with no estimate — named by the summary),
 *    `unrecorded` / `no_opening_value` (no cost at all — counted as *no cost recorded*), or
 *    `opening_balance` (an opening value, not money spent — left out, #1324).
 */
export type CopyCostFigure =
  | { kind: "known"; amount: string }
  | { kind: "estimate"; amount: string }
  | { kind: "missing"; why: "pending" | "unrecorded" | "no_opening_value" | "opening_balance" };

export function copyCostFigure(copy: Omit<CopyCostInput, "label">): CopyCostFigure {
  if (copy.openingBalance) return { kind: "missing", why: "opening_balance" };
  const basis = resolveCostBasis(copy);
  if (basis.state === "known") return { kind: "known", amount: basis.amount };
  if (basis.state === "pending") {
    return copy.costEstimate == null
      ? { kind: "missing", why: "pending" }
      : { kind: "estimate", amount: copy.costEstimate };
  }
  return { kind: "missing", why: basis.reason };
}

/**
 * The COST of copies not yet on an offer — the Lot builder's proposed lot (#1743) — under the very
 * rule a set's COST follows: a frozen cost basis where known, the estimate where the lot is still
 * open. Built from each copy's own fields rather than a holdings summary, which is what an offer set
 * reads, but to the same split: a copy on an opening balance carries an opening value, not money
 * spent, and is left out as `holdings.cost` leaves it out (#1324). The caller hands it held copies
 * only. Summed from {@link copyCostFigure}, the figure each row shows (#1746).
 */
export function copiesCost(copies: readonly CopyCostInput[]): OfferSetCost {
  let total = 0;
  let count = 0;
  let noneCount = 0;
  const pending: OfferPendingCopy[] = [];
  for (const copy of copies) {
    const figure = copyCostFigure(copy);
    if (figure.kind === "known") {
      total += cents(Number(figure.amount));
      count++;
    } else if (figure.kind === "estimate") {
      pending.push({ label: copy.label, estimate: Number(figure.amount) });
    } else if (figure.why === "pending") {
      pending.push({ label: copy.label, estimate: null });
    } else if (figure.why !== "opening_balance") {
      noneCount++;
    }
  }
  return offerSetCost({ total: (total / 100).toFixed(2), count, noneCount }, pending);
}

/** The offer's *Total* and *Per set* COST, summed from its sets' (#378's rule: an offer never lists a
 *  copy twice, so the parts add up exactly, and the average divides by the sets carrying a figure). */
export interface OfferCostTotals {
  total: number | null;
  average: number | null;
  /** Sets carrying a figure — the average's divisor. */
  countedSets: number;
  estimatedCount: number;
  unestimated: string[];
  /** Any set's figure leans on an open lot. */
  estimated: boolean;
}

export function offerCostTotals(sets: readonly OfferSetCost[]): OfferCostTotals {
  let total = 0;
  let countedSets = 0;
  for (const set of sets) {
    if (set.amount === null) continue;
    total += cents(Number(set.amount));
    countedSets++;
  }
  return {
    total: countedSets > 0 ? total / 100 : null,
    average: countedSets > 0 ? total / 100 / countedSets : null,
    countedSets,
    estimatedCount: sets.reduce((n, s) => n + s.estimatedCount, 0),
    unestimated: sets.flatMap((s) => s.unestimated),
    estimated: sets.some((s) => s.estimated),
  };
}

/** How many copies a hint names before it says *and N more* — a lot of a hundred is one listing. */
const NAMED_LIMIT = 5;

/**
 * The hint's note on an estimated COST: how many copies it estimates and that the figure settles when
 * their lots close, then the copies it has no figure for. Empty when nothing under it is pending.
 */
export function offerCostEstimateNotes(estimatedCount: number, unestimated: readonly string[]): string[] {
  const notes: string[] = [];
  if (estimatedCount > 0) {
    notes.push(
      `~ ${estimatedCount} cop${estimatedCount === 1 ? "y" : "ies"} estimated from ${estimatedCount === 1 ? "its" : "their"} open purchase lot — the figure settles when the lot${estimatedCount === 1 ? " is" : "s are"} closed`
    );
  }
  if (unestimated.length > 0) {
    const named = unestimated.slice(0, NAMED_LIMIT).join(", ");
    const more = unestimated.length - NAMED_LIMIT;
    notes.push(
      `no figure yet for ${named}${more > 0 ? ` and ${more} more` : ""} — pending on an open lot with no estimate`
    );
  }
  return notes;
}
