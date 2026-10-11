// **Profit and loss on a sale, a sold unit and a sold copy** (#168). Pure — no Prisma, no
// `server-only` — so the sale screen, the copy page and the Overview tile read one rule, and the
// client can import the wording helper beside the figures.
//
// The arithmetic is ADR-0012 §6: a line's base-currency net (after handling, commission and my
// shipping at the frozen rate, `distributeSaleShared`) against the frozen cost basis of the copies
// that left on it. What this module adds is **what happens when a figure cannot be had**, and the
// rule is that an uncountable copy is **left out and counted, never valued at zero**:
//
//   no-rate       the sale is in another currency (or its shipping is) and no rate is frozen — no
//                 base figure exists for any copy on it.
//   cost-pending  the copy's purchase lot is still open; its cost basis is not settled.
//   no-cost       the copy carries no cost basis at all (added by hand, dropped from its lot).
//   no-opening-value
//                 the copy came in on an opening balance whose lot was stated without a value
//                 (#1323) — a cost *not applicable*, never zero, which would make the whole price
//                 profit (#1324). Told apart from no-cost so the screen can say which.
//   unsplittable  the copy's own cost is known, but it shares a unit with a copy that is left out,
//                 and the unit's net cannot be split across its copies (ADR-0012 §6.3) — so its
//                 share is unknown.
//
// A **unit** carries a profit only when every copy on it counts: its net against the cost of the
// copies in it, with no split needed. A **sale** counts what it can — a unit wholly countable is
// taken whole, a partly countable one gives up the share of its countable copies by the sale
// engine's own catalogue split — and says how many copies it left out and why. The Overview's
// realized figure is the sum of the sales' figures (`sumProfitFigures`), so the two cannot disagree.
//
// **The sale's own screen counts a pending copy at its estimate** (#1814): a copy whose lot is still
// open is given the estimated cost its purchase order and its own page show (#1696), and counted as
// if that were its cost — so the collector can judge a sale before the lot closes. Only a copy whose
// {@link SaleProfitCopy.estimate} is set is counted so; one with none is still left out as
// cost-pending. Every figure that leans on one says how many copies it estimated
// (`estimatedCount`), so the screen marks it. The profit and loss screen and the Overview pass no
// estimates and keep such a copy pending; once the lot closes its frozen cost basis wins and the
// estimate is never read again.

import {
  allocateSaleLine,
  SaleLineBlockedError,
  type SaleLineItemInput,
} from "./sale-allocation";
import { resolveCostBasis, type CostBasisInput, type CostBasisState } from "./cost-basis";

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** Whether a sale has no base-currency figure at all: its transaction currency, or the currency
 * its shipping was paid in, differs from the base and no rate to base is frozen for it. */
export function saleRateMissing(sale: {
  baseCurrency: string;
  currency: string;
  fxRateToBase: unknown;
  shippingCost: unknown;
  shippingCurrency: string | null;
  shippingFxRateToBase: unknown;
}): boolean {
  if (sale.currency !== sale.baseCurrency && sale.fxRateToBase == null) return true;
  return (
    sale.shippingCost != null &&
    sale.shippingCurrency != null &&
    sale.shippingCurrency !== sale.baseCurrency &&
    sale.shippingFxRateToBase == null
  );
}

/** One copy that left on a unit: its cost-basis inputs and its catalogue weight, which is read only
 * when the unit's net has to be split. */
export interface SaleProfitCopy extends CostBasisInput, SaleLineItemInput {
  /** The copy's estimated cost (base currency) while its lot is open (#1814), counted in place of
   * the cost basis it does not have yet. Read only when the copy is pending; absent or null, a
   * pending copy is left out as before. */
  estimate?: number | null;
}

/** One sold unit: its base-currency net and the copies that left on it. */
export interface SaleProfitLine {
  id: string;
  netBase: number;
  copies: SaleProfitCopy[];
}

/** Copies left out of a figure, by why. */
export interface ProfitLeftOut {
  costPending: number;
  noCost: number;
  /** From an opening balance's lot with no opening value (#1324). */
  noOpeningValue: number;
  noRate: number;
  unsplittable: number;
}

const NOTHING_LEFT_OUT: ProfitLeftOut = {
  costPending: 0,
  noCost: 0,
  noOpeningValue: 0,
  noRate: 0,
  unsplittable: 0,
};

export function leftOutTotal(leftOut: ProfitLeftOut): number {
  return (
    leftOut.costPending +
    leftOut.noCost +
    leftOut.noOpeningValue +
    leftOut.noRate +
    leftOut.unsplittable
  );
}

/** A profit figure over a set of sold copies, in the base currency, 2-dp strings. */
export interface ProfitFigures {
  /** Every sold copy the figure ranges over. */
  copyCount: number;
  /** …of which are inside {@link proceeds} and {@link cost}. */
  countedCount: number;
  leftOut: ProfitLeftOut;
  /** Net proceeds of the counted copies. Null when there were copies and none could be counted —
   * there is no figure then, and zero would claim one. */
  proceeds: string | null;
  /** Cost basis of the counted copies; null on the same rule. */
  cost: string | null;
  /** `proceeds − cost`; null on the same rule. */
  profit: string | null;
}

/** A sold unit's profit: its net against the cost of every copy in it, or no figure at all. */
export interface UnitProfit {
  lineId: string;
  /** Σ cost basis of the unit's copies, when every one of them is known or estimated. */
  cost: string | null;
  /** How many of the unit's copies {@link cost} counts at an estimate (#1814) — the figure is then an
   * estimate itself. Zero when it has no figure. */
  estimatedCount: number;
  /** `net − cost`, when every copy is counted; otherwise null and {@link leftOut} says why. */
  profit: string | null;
  /** Why the unit has no figure: its copies' cost states, or the sale's missing rate. Never
   * `unsplittable` — a unit needs no split to be judged whole. */
  leftOut: ProfitLeftOut;
}

/** A sale's figure as its own screen states it: {@link ProfitFigures} plus how many of the counted
 * copies are counted at an estimate (#1814), which marks the figure as one. */
export interface EstimatedProfitFigures extends ProfitFigures {
  estimatedCount: number;
}

export interface SaleProfit extends EstimatedProfitFigures {
  units: UnitProfit[];
}

/** The estimate a copy is counted at, or null when it is counted at its cost basis or not at all. */
function estimateOf(copy: SaleProfitCopy, state: CostBasisState): number | null {
  return state.state === "pending" && copy.estimate != null ? copy.estimate : null;
}

/** The copies whose catalogue weight {@link computeSaleProfit} will need: those on a unit that is
 * only partly countable, the one case that splits a net. The caller loads weights for these alone. */
export function copiesNeedingWeights(lines: readonly Pick<SaleProfitLine, "copies">[]): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    const counted = line.copies.filter((c) => {
      const state = resolveCostBasis(c);
      return state.state === "known" || estimateOf(c, state) != null;
    }).length;
    if (counted > 0 && counted < line.copies.length) ids.push(...line.copies.map((c) => c.id));
  }
  return ids;
}

/** Profit and loss on one sale, and on each of its units. See the module header for the rules. */
export function computeSaleProfit(lines: SaleProfitLine[], rateMissing: boolean): SaleProfit {
  const leftOut = { ...NOTHING_LEFT_OUT };
  let copyCount = 0;
  let countedCount = 0;
  let proceedsCents = 0;
  let costCents = 0;
  let estimatedCount = 0;
  const units: UnitProfit[] = [];

  for (const line of lines) {
    const n = line.copies.length;
    copyCount += n;

    if (rateMissing) {
      leftOut.noRate += n;
      units.push({
        lineId: line.id,
        cost: null,
        estimatedCount: 0,
        profit: null,
        leftOut: { ...NOTHING_LEFT_OUT, noRate: n },
      });
      continue;
    }

    const states = line.copies.map((c) => resolveCostBasis(c));
    // A copy is counted when its cost is known or, on the sale's own screen, estimated (#1814).
    const counted = line.copies.map(
      (c, i) => states[i].state === "known" || estimateOf(c, states[i]) != null
    );
    const unitLeftOut = { ...NOTHING_LEFT_OUT };
    let knownCostCents = 0;
    let unitEstimated = 0;
    states.forEach((state, i) => {
      const estimate = estimateOf(line.copies[i], state);
      if (state.state === "known") knownCostCents += toCents(Number(state.amount));
      else if (estimate != null) {
        knownCostCents += toCents(estimate);
        unitEstimated++;
      } else if (state.state === "pending") unitLeftOut.costPending++;
      else if (state.reason === "no_opening_value") unitLeftOut.noOpeningValue++;
      else unitLeftOut.noCost++;
    });
    const netCents = toCents(line.netBase);

    if (leftOutTotal(unitLeftOut) === 0) {
      // Wholly countable: the net is the unit's however its copies weigh, so nothing is split.
      countedCount += n;
      estimatedCount += unitEstimated;
      proceedsCents += netCents;
      costCents += knownCostCents;
      units.push({
        lineId: line.id,
        cost: fromCents(knownCostCents),
        estimatedCount: unitEstimated,
        profit: fromCents(netCents - knownCostCents),
        leftOut: unitLeftOut,
      });
      continue;
    }

    units.push({
      lineId: line.id,
      cost: null,
      estimatedCount: 0,
      profit: null,
      leftOut: unitLeftOut,
    });
    leftOut.costPending += unitLeftOut.costPending;
    leftOut.noCost += unitLeftOut.noCost;
    leftOut.noOpeningValue += unitLeftOut.noOpeningValue;

    const knownCount = n - leftOutTotal(unitLeftOut);
    if (knownCount === 0) continue;
    try {
      const shares = allocateSaleLine(line.netBase, line.copies);
      shares.forEach((share, i) => {
        if (!counted[i]) return;
        proceedsCents += toCents(share.proceeds);
      });
      countedCount += knownCount;
      estimatedCount += unitEstimated;
      costCents += knownCostCents;
    } catch (err) {
      if (!(err instanceof SaleLineBlockedError)) throw err;
      leftOut.unsplittable += knownCount;
    }
  }

  const figures = figuresOf(copyCount, countedCount, leftOut, proceedsCents, costCents);
  return { ...figures, estimatedCount, units };
}

function figuresOf(
  copyCount: number,
  countedCount: number,
  leftOut: ProfitLeftOut,
  proceedsCents: number,
  costCents: number
): ProfitFigures {
  const none = countedCount === 0 && leftOutTotal(leftOut) > 0;
  return {
    copyCount,
    countedCount,
    leftOut,
    proceeds: none ? null : fromCents(proceedsCents),
    cost: none ? null : fromCents(costCents),
    profit: none ? null : fromCents(proceedsCents - costCents),
  };
}

/** Several sales' figures as one — the Overview's realized profit. Summed in cents over the sales
 * that have a figure, with every left-out copy still counted, so it is exactly the sale screens
 * added up. */
export function sumProfitFigures(all: readonly ProfitFigures[]): ProfitFigures {
  const leftOut = { ...NOTHING_LEFT_OUT };
  let copyCount = 0;
  let countedCount = 0;
  let proceedsCents = 0;
  let costCents = 0;
  for (const f of all) {
    copyCount += f.copyCount;
    countedCount += f.countedCount;
    leftOut.costPending += f.leftOut.costPending;
    leftOut.noCost += f.leftOut.noCost;
    leftOut.noOpeningValue += f.leftOut.noOpeningValue;
    leftOut.noRate += f.leftOut.noRate;
    leftOut.unsplittable += f.leftOut.unsplittable;
    if (f.proceeds != null) proceedsCents += toCents(Number(f.proceeds));
    if (f.cost != null) costCents += toCents(Number(f.cost));
  }
  return figuresOf(copyCount, countedCount, leftOut, proceedsCents, costCents);
}

/** What one sold copy earned (#168's copy page). */
export interface CopySaleProfit {
  /** The copy's share of its unit's net: the whole net on a unit of one, the sale engine's
   * catalogue split otherwise. Null when there is no share to state — see {@link shareGap}. */
  share: string | null;
  shareGap: "no-rate" | "unsplittable" | null;
  cost: CostBasisState;
  /** `share − cost basis` when both are known, else null. */
  profit: string | null;
}

/** The share, cost basis and profit of one copy on its unit. A unit of several copies always splits
 * here, whatever its cost states — the copy page asks what *this* piece fetched. */
export function computeCopySaleProfit(
  line: SaleProfitLine,
  copyId: string,
  rateMissing: boolean
): CopySaleProfit {
  const copy = line.copies.find((c) => c.id === copyId);
  if (!copy) throw new Error("The copy is not on this sale line.");
  const cost = resolveCostBasis(copy);

  let shareCents: number | null = null;
  let shareGap: CopySaleProfit["shareGap"] = null;
  if (rateMissing) {
    shareGap = "no-rate";
  } else {
    try {
      const shares = allocateSaleLine(line.netBase, line.copies);
      shareCents = toCents(shares.find((s) => s.itemId === copyId)!.proceeds);
    } catch (err) {
      if (!(err instanceof SaleLineBlockedError)) throw err;
      shareGap = "unsplittable";
    }
  }

  return {
    share: shareCents == null ? null : fromCents(shareCents),
    shareGap,
    cost,
    profit:
      shareCents != null && cost.state === "known"
        ? fromCents(shareCents - toCents(Number(cost.amount)))
        : null,
  };
}

/** The left-out counts as short phrases ("2 with cost pending"), in a fixed order, zeros dropped. */
export function describeLeftOut(leftOut: ProfitLeftOut): string[] {
  const parts: string[] = [];
  if (leftOut.noRate > 0) parts.push(`${leftOut.noRate} with no exchange rate`);
  if (leftOut.costPending > 0) parts.push(`${leftOut.costPending} with cost pending`);
  if (leftOut.noCost > 0) parts.push(`${leftOut.noCost} with no cost recorded`);
  if (leftOut.noOpeningValue > 0) {
    parts.push(`${leftOut.noOpeningValue} from an opening balance with no value`);
  }
  if (leftOut.unsplittable > 0) parts.push(`${leftOut.unsplittable} whose share cannot be split`);
  return parts;
}

/** The note on a profit counting `estimatedCount` copies at an open lot's estimate (#1814): how many,
 * and that the figure settles when the lot closes. Null when none is. */
export function describeEstimated(estimatedCount: number): string | null {
  if (estimatedCount === 0) return null;
  const one = estimatedCount === 1;
  return `~ ${estimatedCount} cop${one ? "y" : "ies"} counted at ${one ? "its" : "their"} estimated cost — ${one ? "its" : "their"} purchase lot${one ? " is" : "s are"} still open, and the figure settles when ${one ? "it is" : "they are"} closed`;
}
