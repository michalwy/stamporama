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
export interface SaleProfitCopy extends CostBasisInput, SaleLineItemInput {}

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
  /** Σ cost basis of the unit's copies, when every one of them is known. */
  cost: string | null;
  /** `net − cost`, when every copy is counted; otherwise null and {@link leftOut} says why. */
  profit: string | null;
  /** Why the unit has no figure: its copies' cost states, or the sale's missing rate. Never
   * `unsplittable` — a unit needs no split to be judged whole. */
  leftOut: ProfitLeftOut;
}

export interface SaleProfit extends ProfitFigures {
  units: UnitProfit[];
}

/** The copies whose catalogue weight {@link computeSaleProfit} will need: those on a unit that is
 * only partly countable, the one case that splits a net. The caller loads weights for these alone. */
export function copiesNeedingWeights(lines: readonly Pick<SaleProfitLine, "copies">[]): string[] {
  const ids: string[] = [];
  for (const line of lines) {
    const states = line.copies.map((c) => resolveCostBasis(c).state);
    const known = states.filter((s) => s === "known").length;
    if (known > 0 && known < line.copies.length) ids.push(...line.copies.map((c) => c.id));
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
  const units: UnitProfit[] = [];

  for (const line of lines) {
    const n = line.copies.length;
    copyCount += n;

    if (rateMissing) {
      leftOut.noRate += n;
      units.push({
        lineId: line.id,
        cost: null,
        profit: null,
        leftOut: { ...NOTHING_LEFT_OUT, noRate: n },
      });
      continue;
    }

    const states = line.copies.map((c) => resolveCostBasis(c));
    const unitLeftOut = { ...NOTHING_LEFT_OUT };
    let knownCostCents = 0;
    for (const state of states) {
      if (state.state === "known") knownCostCents += toCents(Number(state.amount));
      else if (state.state === "pending") unitLeftOut.costPending++;
      else if (state.reason === "no_opening_value") unitLeftOut.noOpeningValue++;
      else unitLeftOut.noCost++;
    }
    const netCents = toCents(line.netBase);

    if (leftOutTotal(unitLeftOut) === 0) {
      // Wholly countable: the net is the unit's however its copies weigh, so nothing is split.
      countedCount += n;
      proceedsCents += netCents;
      costCents += knownCostCents;
      units.push({
        lineId: line.id,
        cost: fromCents(knownCostCents),
        profit: fromCents(netCents - knownCostCents),
        leftOut: unitLeftOut,
      });
      continue;
    }

    units.push({ lineId: line.id, cost: null, profit: null, leftOut: unitLeftOut });
    leftOut.costPending += unitLeftOut.costPending;
    leftOut.noCost += unitLeftOut.noCost;
    leftOut.noOpeningValue += unitLeftOut.noOpeningValue;

    const knownCount = n - leftOutTotal(unitLeftOut);
    if (knownCount === 0) continue;
    try {
      const shares = allocateSaleLine(line.netBase, line.copies);
      shares.forEach((share, i) => {
        if (states[i].state !== "known") return;
        proceedsCents += toCents(share.proceeds);
      });
      countedCount += knownCount;
      costCents += knownCostCents;
    } catch (err) {
      if (!(err instanceof SaleLineBlockedError)) throw err;
      leftOut.unsplittable += knownCount;
    }
  }

  const figures = figuresOf(copyCount, countedCount, leftOut, proceedsCents, costCents);
  return { ...figures, units };
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
