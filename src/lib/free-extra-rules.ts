import { normalizeDecimalInput } from "./decimal-input";

// Free extras on a sale (#2408): copies put into the parcel for nothing, on top of what the buyer
// bought. The sale proposes them and the collector confirms; this module is the pure half — the
// limits as typed, the ranking, the proposal and the running totals — so the dialog and the tests
// read one rule. The candidates themselves (which copies may be given away, and what each is worth in
// the sale's currency) are the server's, in `sales.ts`.
//
// Settled with the collector on 2026-11-04:
//
// - **Value ranks first**, the copy's catalogue value from valuation, never its purchase cost; where
//   two are worth the same, a copy on no open offer comes before a listed one.
// - What the buyer bought does not steer the choice — no matching by area, period or theme.
// - The limits are a **count** and a **budget**, either or both; the budget is an amount in the
//   sale's currency or a percentage of the order's value — the sale's paid lines, without shipping
//   and without the free extras themselves.
//
// Every figure here is in whole **cents** of the sale's currency, so a budget of 5.00 holds five
// copies at 1.00 exactly rather than four and a rounding error.

/** How the budget was typed: an amount in the sale's currency, or a percentage of the order. */
export type FreeExtraBudgetKind = "amount" | "percent";

/** The limits as the dialog's fields hold them. */
export interface FreeExtraLimitsRaw {
  count: string;
  budget: string;
  budgetKind: FreeExtraBudgetKind;
}

/** The limits resolved: null where a limit was left empty. At least one is set. */
export interface FreeExtraLimits {
  count: number | null;
  /** The budget in cents of the sale's currency — a percentage already taken of the order. */
  budgetCents: number | null;
}

/** One copy that may be given away, as the proposal reads it. */
export interface FreeExtraCandidate {
  itemId: string;
  /** The copy's own number (#268) — the last word in the order, so the ranking is stable. */
  itemNo: number;
  /** Its value in cents of the sale's currency. A copy with no value is never a candidate. */
  valueCents: number;
  /** On an open offer somewhere. Ranked after an unlisted copy of the same value. */
  listed: boolean;
}

/** A decimal amount as whole cents — rounded half away from zero, as the stored amounts are. */
export function toCents(amount: number | string): number {
  const n = typeof amount === "number" ? amount : Number(amount);
  return Math.sign(n) * Math.round(Math.abs(n) * 100);
}

/** Cents as a 2-dp string, the shape every amount on a sale is printed in. */
export function fromCents(cents: number): string {
  return (cents / 100).toFixed(2);
}

/** The order's value (#2408): the sale's paid lines summed — shipping is not a line, and a free
 *  extra, priced at 0, is left out by name rather than by its price. */
export function orderValueCents(
  lines: readonly { price: number | string; freeExtra: boolean }[]
): number {
  return lines.reduce((sum, l) => (l.freeExtra ? sum : sum + toCents(l.price)), 0);
}

/**
 * Read the limits as typed. Blank is *no limit*; a count is a positive whole number; a budget is a
 * positive amount or percentage, the percentage taken of `orderCents`. At least one limit is
 * required — without either the proposal would be the whole stock.
 */
export function parseFreeExtraLimits(
  raw: FreeExtraLimitsRaw,
  orderCents: number
): { ok: true; limits: FreeExtraLimits } | { ok: false; message: string } {
  const countText = raw.count.trim();
  const budgetText = normalizeDecimalInput(raw.budget.trim());
  if (!countText && !budgetText) {
    return { ok: false, message: "Enter how many copies, a budget, or both." };
  }
  let count: number | null = null;
  if (countText) {
    if (!/^\d+$/.test(countText) || Number(countText) < 1) {
      return { ok: false, message: "The number of copies must be a whole number of at least 1." };
    }
    count = Number(countText);
  }
  let budgetCents: number | null = null;
  if (budgetText) {
    const n = Number(budgetText);
    if (!Number.isFinite(n) || n <= 0) {
      return {
        ok: false,
        message:
          raw.budgetKind === "percent"
            ? "The budget must be a percentage above 0."
            : "The budget must be an amount above 0.",
      };
    }
    budgetCents = raw.budgetKind === "percent" ? Math.floor((orderCents * n) / 100) : toCents(n);
  }
  return { ok: true, limits: { count, budgetCents } };
}

/** The proposal's order: the lowest value first; at equal value a copy on no open offer before a
 *  listed one; then by copy number, so the same stock always proposes the same copies. */
export function compareFreeExtraCandidates(a: FreeExtraCandidate, b: FreeExtraCandidate): number {
  if (a.valueCents !== b.valueCents) return a.valueCents - b.valueCents;
  if (a.listed !== b.listed) return a.listed ? 1 : -1;
  return a.itemNo - b.itemNo;
}

/** The candidates in the proposal's order ({@link compareFreeExtraCandidates}), as a new array. */
export function rankFreeExtraCandidates<T extends FreeExtraCandidate>(candidates: readonly T[]): T[] {
  return [...candidates].sort(compareFreeExtraCandidates);
}

/**
 * The copies proposed: walking the ranked candidates, each one taken while there is room under both
 * limits — no more copies than the count, and a total no higher than the budget. A copy that would
 * go over the budget is passed over; in ranked order every copy after it is worth as much or more,
 * so the walk ends there in practice, but a caller's own order is not trusted to be ranked.
 */
export function proposeFreeExtras(
  ranked: readonly FreeExtraCandidate[],
  limits: FreeExtraLimits
): string[] {
  const picked: string[] = [];
  let total = 0;
  for (const c of ranked) {
    if (limits.count !== null && picked.length >= limits.count) break;
    if (limits.budgetCents !== null && total + c.valueCents > limits.budgetCents) continue;
    picked.push(c.itemId);
    total += c.valueCents;
  }
  return picked;
}

/** What the ticked copies come to, against the limits — the dialog's footer. Ticking past a limit by
 *  hand is the collector's call; the footer says so rather than refusing it. */
export function freeExtraTotals(
  ticked: readonly FreeExtraCandidate[],
  limits: FreeExtraLimits | null
): { count: number; valueCents: number; overCount: boolean; overBudget: boolean } {
  const valueCents = ticked.reduce((sum, c) => sum + c.valueCents, 0);
  return {
    count: ticked.length,
    valueCents,
    overCount: limits?.count != null && ticked.length > limits.count,
    overBudget: limits?.budgetCents != null && valueCents > limits.budgetCents,
  };
}

// ── A platform's free-extras settings (#2409) ──────────────────────────────────────────────────────
//
// Each platform states when its sales are due free extras and how generous they are: a minimum order
// value, a default budget as a percentage of the order, and a maximum budget capping what the
// percentage gives. The dialog opens from them; the collector can still change the budget for the
// sale. Below the minimum the sale says no free extra is due, but nothing stops one being added by
// hand — a hint, not a block.

/** A platform's free-extras settings, its two amounts already in cents of the sale's currency. */
export interface FreeExtraPlatformDefaults {
  minimumOrderCents: number | null;
  budgetPercent: number | null;
  maximumBudgetCents: number | null;
}

/** What the dialog opens with, read off the platform's settings and the order. */
export type FreeExtraPrefill =
  /** The platform states nothing: the dialog opens empty, as before #2409. */
  | { kind: "none" }
  /** The order is under the platform's minimum: no free extra is due, and no budget is filled in. */
  | { kind: "below-minimum"; minimumOrderCents: number }
  /** Free extras are due. `budgetCents` is null where the platform states no budget, or the one it
   *  gives comes to nothing; `capped` says the maximum cut the percentage's figure down. */
  | { kind: "due"; budgetCents: number | null; capped: boolean };

/**
 * The budget a platform proposes for an order (#2409): its percentage of the order's value, capped
 * at its maximum. With the maximum alone, the maximum is the budget; with the percentage alone,
 * nothing caps it. An order under the minimum is due none. A budget that rounds down to 0 fills
 * nothing in — the limits refuse a budget of 0.
 */
export function prefillFreeExtras(
  defaults: FreeExtraPlatformDefaults | null,
  orderCents: number
): FreeExtraPrefill {
  if (
    !defaults ||
    (defaults.minimumOrderCents == null &&
      defaults.budgetPercent == null &&
      defaults.maximumBudgetCents == null)
  ) {
    return { kind: "none" };
  }
  if (defaults.minimumOrderCents != null && orderCents < defaults.minimumOrderCents) {
    return { kind: "below-minimum", minimumOrderCents: defaults.minimumOrderCents };
  }
  let budgetCents: number | null = null;
  let capped = false;
  if (defaults.budgetPercent != null) {
    budgetCents = Math.floor((orderCents * defaults.budgetPercent) / 100);
    if (defaults.maximumBudgetCents != null && budgetCents > defaults.maximumBudgetCents) {
      budgetCents = defaults.maximumBudgetCents;
      capped = true;
    }
  } else if (defaults.maximumBudgetCents != null) {
    budgetCents = defaults.maximumBudgetCents;
  }
  return { kind: "due", budgetCents: budgetCents != null && budgetCents > 0 ? budgetCents : null, capped };
}
