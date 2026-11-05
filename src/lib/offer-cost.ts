// **What an offer's sets cost, while some of their copies' cost is still pending** (#1736).
//
// Everywhere else a copy on an open lot is counted as *pending* and kept out of a total (#1696): a
// holdings figure, the Overview, profit and loss. An offer's COST is the one exception, because it
// is the figure an asking price is set against, and *—* tells the collector nothing at the moment
// they are pricing. So here a pending copy is counted at **its estimate** — the figure its purchase
// order and its own page show — and the result is marked as an estimate wherever any copy under it
// is pending. A pending copy with no possible estimate leaves the figure incomplete and is named.
//
// **A copy from an opening balance counts at its opening value** (#2333). #1324 made the opening value
// a copy's cost basis for profit and loss when it sells, but never *money spent*; this is the figure an
// asking price is set against, so it follows the sale's profit, not the spend: the opening value is
// counted, and the figure is marked *incl. opening value* wherever one is under it, as an estimate is
// marked, so it is never read as money spent. A copy on an opening balance with **no** opening value
// stays out, counted as having no cost. **A copy on an opening balance that is still open counts at its
// estimate** (#2437), as a pending purchase copy does, and the figure carries both marks — *estimate* and
// *incl. opening value* — since it is neither settled nor money spent. **Where a cost is still missing the figure says why** — no cost
// recorded, on an open purchase with no estimate, on the opening balance with no value
// ({@link offerCostNotes}, {@link describeCostGaps}). **A copy no longer held adds nothing** (#2436) —
// disposed, or marked not delivered or damaged — and is named by why with the other gaps, so a cost
// that is `—` because nothing under it is held still says so.
//
// Pure: `offers.ts` feeds it the frozen side (from the set's holdings summary, {@link holdingsCostParts})
// and each pending copy's estimate (from `cost-estimates.ts`), so the unit suite can hold the rule. The
// Lot builder's proposed lot is costed by the same rule from its copies' own fields (`copiesCost`, #1743).

import { resolveCostBasis, type CostBasisInput, type CostBasisTotal } from "./cost-basis";
import { isHeld, type HeldInput } from "./disposal";

/** A pending copy of a set, as the offer's COST needs it. */
export interface OfferPendingCopy {
  /** The copy's label, for the hint naming the copies without a figure. */
  label: string;
  /** Its estimated cost, base currency, or null when none can be made. */
  estimate: number | null;
  /** Its lot is on an opening balance that is still open (#2437): the estimate is a share of an
   *  opening value, never money spent, so a figure counting it is marked *incl. opening value* too. */
  openingBalance?: boolean;
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
  /** Copies with no cost recorded at all (not pending, not on an opening balance): left out, as
   *  everywhere. */
  noneCount: number;
  /** Copies from an opening balance counted at their opening value (#2333). */
  openingCount: number;
  /** Copies on an opening balance with no opening value — left out, counted as having no cost. */
  noOpeningValueCount: number;
  /** Copies no longer held (#2436), by why — left out of {@link amount}, as everywhere (#396). */
  notHeld: NotHeldCounts;
  /** {@link amount} leans on an open lot — an estimate, or a gap where one could not be made. */
  estimated: boolean;
  /** {@link amount} includes opening values (#2333) — never money spent, so it is marked. */
  opening: boolean;
}

/** A set's opening-balance side (#2333): the opening values its copies carry, and how many copies
 *  are on an opening balance with no value. */
export interface OfferOpeningCost {
  total: string;
  count: number;
  noValueCount: number;
}

const NO_OPENING: OfferOpeningCost = { total: "0.00", count: 0, noValueCount: 0 };

/** The copies of a set no longer held (#2436), by why: disposed after delivery (#394), or marked
 *  not delivered or damaged on intake. Each a copy count. */
export interface NotHeldCounts {
  notDelivered: number;
  damaged: number;
  disposed: number;
}

export const NO_NOT_HELD: NotHeldCounts = { notDelivered: 0, damaged: 0, disposed: 0 };

/** Counts the copies {@link isHeld} rejects, by why. A disposed copy counts as disposed whatever its
 *  delivery state, the order `isHeld` asks in. */
export function notHeldCounts(copies: readonly HeldInput[]): NotHeldCounts {
  const counts = { ...NO_NOT_HELD };
  for (const copy of copies) {
    if (isHeld(copy)) continue;
    if (copy.disposedAt != null) counts.disposed++;
    else if (copy.deliveryState === "not_delivered") counts.notDelivered++;
    else counts.damaged++;
  }
  return counts;
}

const cents = (amount: number) => Math.round(amount * 100);

/**
 * The two halves {@link offerSetCost} takes, read off a set's holdings summary, which keeps what was
 * spent (`cost`) apart from opening values (`openingValue`, #1324). Every copy with no cost is counted
 * once, as *no opening value* when that is why, else as *no cost recorded*. Pending copies are not
 * counted here: the caller names them with their estimates.
 */
export function holdingsCostParts(holdings: { cost: CostBasisTotal; openingValue: CostBasisTotal }): {
  known: { total: string; count: number; noneCount: number };
  opening: OfferOpeningCost;
} {
  const { cost, openingValue } = holdings;
  const noValueCount = cost.noOpeningValueCount + openingValue.noOpeningValueCount;
  return {
    known: {
      total: cost.totalCostBasis,
      count: cost.knownCount,
      noneCount: cost.noneCount + openingValue.noneCount - noValueCount,
    },
    opening: { total: openingValue.totalCostBasis, count: openingValue.knownCount, noValueCount },
  };
}

/**
 * A set's COST: its frozen cost bases (`known.total` over `known.count` copies), its opening values
 * (#2333), plus the estimate of each pending copy that has one. `notHeld` counts the copies left out
 * because they are gone (#2436), so a figure can say why it is missing.
 */
export function offerSetCost(
  known: { total: string; count: number; noneCount: number },
  pending: readonly OfferPendingCopy[],
  opening: OfferOpeningCost = NO_OPENING,
  notHeld: NotHeldCounts = NO_NOT_HELD
): OfferSetCost {
  let total = known.count > 0 ? cents(Number(known.total)) : 0;
  if (opening.count > 0) total += cents(Number(opening.total));
  let estimatedCount = 0;
  let estimatedOpening = false;
  const unestimated: string[] = [];
  for (const copy of pending) {
    if (copy.estimate == null) {
      unestimated.push(copy.label);
    } else {
      total += cents(copy.estimate);
      estimatedCount++;
      if (copy.openingBalance) estimatedOpening = true;
    }
  }
  const counted = known.count + opening.count + estimatedCount;
  return {
    amount: counted === 0 ? null : (total / 100).toFixed(2),
    knownCount: known.count,
    estimatedCount,
    unestimated,
    noneCount: known.noneCount,
    openingCount: opening.count,
    noOpeningValueCount: opening.noValueCount,
    notHeld,
    estimated: pending.length > 0,
    opening: opening.count > 0 || estimatedOpening,
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
 *  - `opening` — its opening value, from an opening balance (#2333): a cost basis, never money spent;
 *  - `estimate` — pending on an open lot, at the estimate its purchase order shows;
 *  - `missing` — no figure, and why: `pending` (an open lot with no estimate — named by the summary),
 *    `unrecorded` (no cost recorded) or `no_opening_value` (on an opening balance with no value).
 */
export type CopyCostFigure =
  | { kind: "known"; amount: string }
  | { kind: "opening"; amount: string }
  | { kind: "estimate"; amount: string }
  | { kind: "missing"; why: "pending" | "unrecorded" | "no_opening_value" };

export function copyCostFigure(copy: Omit<CopyCostInput, "label">): CopyCostFigure {
  const basis = resolveCostBasis(copy);
  if (basis.state === "known") {
    return copy.openingBalance ? { kind: "opening", amount: basis.amount } : { kind: "known", amount: basis.amount };
  }
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
 * open, an opening balance's copy at its opening value (#2333). Built from each copy's own fields rather
 * than a holdings summary, which is what an offer set reads, but to the same split. The caller hands it
 * held copies only. Summed from {@link copyCostFigure}, the figure each row shows (#1746).
 */
export function copiesCost(copies: readonly CopyCostInput[]): OfferSetCost {
  let total = 0;
  let count = 0;
  let noneCount = 0;
  let openingTotal = 0;
  let openingCount = 0;
  let noValueCount = 0;
  const pending: OfferPendingCopy[] = [];
  for (const copy of copies) {
    const figure = copyCostFigure(copy);
    if (figure.kind === "known") {
      total += cents(Number(figure.amount));
      count++;
    } else if (figure.kind === "opening") {
      openingTotal += cents(Number(figure.amount));
      openingCount++;
    } else if (figure.kind === "estimate") {
      pending.push({ label: copy.label, estimate: Number(figure.amount), openingBalance: copy.openingBalance });
    } else if (figure.why === "pending") {
      pending.push({ label: copy.label, estimate: null, openingBalance: copy.openingBalance });
    } else if (figure.why === "no_opening_value") {
      noValueCount++;
    } else {
      noneCount++;
    }
  }
  return offerSetCost({ total: (total / 100).toFixed(2), count, noneCount }, pending, {
    total: (openingTotal / 100).toFixed(2),
    count: openingCount,
    noValueCount,
  });
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
  /** Any set's figure includes opening values (#2333). */
  opening: boolean;
  /** Copies counted at their opening value. */
  openingCount: number;
  /** The copies still without a cost, by why (#2333). */
  gaps: CostGaps;
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
    opening: sets.some((s) => s.opening),
    openingCount: sets.reduce((n, s) => n + s.openingCount, 0),
    gaps: sumCostGaps(sets.map(costGapsOf)),
  };
}

/** The copies a cost is still missing for, by why (#2333) — each a copy count. The copies no longer
 *  held are among them (#2436): they add nothing to a cost, and a cost of nothing but them is `—`. */
export interface CostGaps extends NotHeldCounts {
  /** No cost recorded: no purchase lot, or dropped from a closed one. */
  unrecorded: number;
  /** On an open purchase with no estimate. */
  unestimated: number;
  /** On an opening balance with no opening value. */
  noOpeningValue: number;
}

export const NO_COST_GAPS: CostGaps = { unrecorded: 0, unestimated: 0, noOpeningValue: 0, ...NO_NOT_HELD };

export function costGapsOf(cost: OfferSetCost): CostGaps {
  return {
    unrecorded: cost.noneCount,
    unestimated: cost.unestimated.length,
    noOpeningValue: cost.noOpeningValueCount,
    ...cost.notHeld,
  };
}

const GAP_KEYS = ["unrecorded", "unestimated", "noOpeningValue", "notDelivered", "damaged", "disposed"] as const;

export function sumCostGaps(gaps: readonly CostGaps[]): CostGaps {
  const sum = { ...NO_COST_GAPS };
  for (const g of gaps) for (const k of GAP_KEYS) sum[k] += g[k];
  return sum;
}

export function hasCostGaps(gaps: CostGaps): boolean {
  return GAP_KEYS.some((k) => gaps[k] > 0);
}

const copiesWord = (n: number) => `${n} cop${n === 1 ? "y" : "ies"}`;

/**
 * Why a cost is missing, a phrase per reason (#2333): *3 copies with no cost recorded*, *2 on open
 * purchases with no estimate*, *1 on the opening balance with no value*, then the copies no longer held
 * (#2436): *1 copy not delivered*, *1 copy damaged*, *1 copy disposed*. Empty when nothing is missing.
 */
export function describeCostGaps(gaps: CostGaps): string[] {
  const out: string[] = [];
  if (gaps.unrecorded > 0) out.push(`${copiesWord(gaps.unrecorded)} with no cost recorded`);
  if (gaps.unestimated > 0) {
    out.push(`${gaps.unestimated} on ${gaps.unestimated === 1 ? "an open purchase" : "open purchases"} with no estimate`);
  }
  if (gaps.noOpeningValue > 0) out.push(`${gaps.noOpeningValue} on the opening balance with no value`);
  if (gaps.notDelivered > 0) out.push(`${copiesWord(gaps.notDelivered)} not delivered`);
  if (gaps.damaged > 0) out.push(`${copiesWord(gaps.damaged)} damaged`);
  if (gaps.disposed > 0) out.push(`${copiesWord(gaps.disposed)} disposed`);
  return out;
}

/**
 * Why a cost has no figure at all (#2333, #2436), the note a `—` Cost carries: no rate converting it
 * into the offer's currency (naming the two), the copies it is missing by why ({@link describeCostGaps},
 * the copies no longer held among them), or *no copies* when the offer has none. Since every copy is
 * counted, gapped or gone, one of these is always true of a `—`.
 */
export function describeMissingCost(cost: {
  unconvertible: { from: string; to: string } | null;
  gaps: CostGaps;
  copyCount: number;
}): string[] {
  const why = [
    ...(cost.unconvertible ? [`no rate from ${cost.unconvertible.from} to ${cost.unconvertible.to}`] : []),
    ...describeCostGaps(cost.gaps),
  ];
  if (why.length === 0 && cost.copyCount === 0) why.push("no copies");
  return why;
}

/** The note on a cost counting opening values (#2333): *4 copies at their opening value — not money
 *  spent*. */
export function describeOpeningCount(count: number): string {
  return `${copiesWord(count)} at ${count === 1 ? "its" : "their"} opening value — not money spent`;
}

/** What a cost figure is marked with, as a short note: *estimate*, *incl. opening value*, both, or
 *  null when it is neither (#1736, #2333). */
export function describeCostMarks(marks: { estimated: boolean; opening: boolean }): string | null {
  const parts = [marks.estimated ? "estimate" : null, marks.opening ? "incl. opening value" : null].filter(
    (p): p is string => p !== null
  );
  return parts.length > 0 ? parts.join(", ") : null;
}

/**
 * The hint's notes on a COST, in one place for every surface that draws one (#2333): the estimate's
 * notes ({@link offerCostEstimateNotes}), the copies counted at their opening value, then the copies
 * still without a cost — no cost recorded, or on the opening balance with no value (the open lot's
 * copies with no estimate are named by the estimate's notes).
 */
export function offerCostNotes(cost: {
  estimatedCount: number;
  unestimated: readonly string[];
  openingCount: number;
  noneCount: number;
  noOpeningValueCount: number;
  notHeld?: NotHeldCounts;
}): string[] {
  const notes = offerCostEstimateNotes(cost.estimatedCount, cost.unestimated);
  if (cost.openingCount > 0) notes.push(describeOpeningCount(cost.openingCount));
  notes.push(
    ...describeCostGaps({
      unrecorded: cost.noneCount,
      unestimated: 0,
      noOpeningValue: cost.noOpeningValueCount,
      ...(cost.notHeld ?? NO_NOT_HELD),
    })
  );
  return notes;
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
