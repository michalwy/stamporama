// **What a purchase has earned back so far** (#559). Pure — no Prisma / server-only imports, so it
// is unit-testable in isolation like the two allocation engines it sits between
// (`purchase-allocation.ts`, #119, and `sale-allocation.ts`, ADR-0012 §6).
//
// An order's ROI is the two halves of ADR-0009 and ADR-0012 read against each other:
//
//   spent    Σ frozen cost-basis over the order's copies (#123/#179) — what the parcel cost,
//            per copy, in the base currency.
//   realized Σ base-currency **net** proceeds (after commission, buyer handling and my shipping,
//            ADR-0012 §6) attributed to those same copies once they sell.
//
// Both figures are in the base currency by construction — a cost-basis snapshot is frozen in it and
// a sale's net is converted into it — so no conversion happens here.
//
// **Two returns are reported, not one.** `netReturn = realized − spent` is what the whole order has
// made, and it reads deeply negative until most of it has sold, which is honest but says nothing
// about how the sales themselves went. `soldMargin = realized − cost of the copies that sold` is
// that second question, and it is the one that says whether the buying was any good. Neither
// answers the other, so both are stated, with the sold/unsold counts beside them.
//
// **A sold copy's proceeds may be unknown**, and that is a third state, never a zero: a sale line
// carrying copies from several purchases splits its net by primary-catalogue weight (ADR-0012 §6.3),
// and a line with an unpriced copy on it cannot be split at all. Such a copy is counted as sold and
// its proceeds are left out of `realized`, which is then reported as covering fewer copies than have
// sold — a figure that is short by a stated amount, rather than one quietly claiming a loss.

import { aggregateCostBasis, type CostBasisInput, type CostBasisTotal } from "./cost-basis";
import {
  allocateSaleLine,
  SaleLineBlockedError,
  type SaleLineItemInput,
} from "./sale-allocation";

/** Round a money amount to whole cents, guarding against binary-float drift (as both allocation
 * engines do). */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** One sale line's net proceeds, attributed to the copies of one purchase. */
export interface AttributedLine {
  /** Base-currency net proceeds this line brought the purchase, 2 dp (may be negative — a line
   * whose fees exceed its price). */
  proceeds: number;
  /** The purchase's copies on the line whose share is included in {@link proceeds}. */
  resolvedItemIds: string[];
  /** The purchase's copies on the line whose share could not be resolved, because the line mixes
   * purchases and its split is blocked (ADR-0012 §6.3). They sold; what they fetched is unknown. */
  unresolvedItemIds: string[];
}

/**
 * Attribute one sale line's base-currency net to the copies of a single purchase.
 *
 * A line **wholly** made of the purchase's copies takes the net whole, without splitting it: the
 * whole amount belongs to this order however the copies weigh against each other, and asking for a
 * per-copy split there would let one unpriced copy block a figure that needs no split to be exact.
 *
 * A **mixed** line is split by the sale engine's own rule, so the two screens can never disagree
 * about what a copy fetched. A blocked split is reported rather than thrown — one unsplittable line
 * must not take the whole order's return down with it.
 */
export function attributeLineToPurchase(
  netBase: number,
  items: SaleLineItemInput[],
  isFromPurchase: (itemId: string) => boolean
): AttributedLine {
  const mine = items.filter((it) => isFromPurchase(it.id));
  if (mine.length === 0) {
    return { proceeds: 0, resolvedItemIds: [], unresolvedItemIds: [] };
  }
  if (mine.length === items.length) {
    return {
      proceeds: toCents(netBase) / 100,
      resolvedItemIds: mine.map((it) => it.id),
      unresolvedItemIds: [],
    };
  }
  try {
    const shares = allocateSaleLine(netBase, items);
    const mineIds = new Set(mine.map((it) => it.id));
    const cents = shares
      .filter((s) => mineIds.has(s.itemId))
      .reduce((sum, s) => sum + toCents(s.proceeds), 0);
    return {
      proceeds: cents / 100,
      resolvedItemIds: mine.map((it) => it.id),
      unresolvedItemIds: [],
    };
  } catch (err) {
    if (err instanceof SaleLineBlockedError) {
      return { proceeds: 0, resolvedItemIds: [], unresolvedItemIds: mine.map((it) => it.id) };
    }
    throw err;
  }
}

/** One copy of the purchase, as the roll-up reads it: its cost-basis inputs (#123) plus how it has
 * sold. Deliberately **no per-copy proceeds**: a sale line made entirely of this order's copies is
 * attributed whole (see {@link attributeLineToPurchase}), so what one of those copies fetched on its
 * own is a figure nothing computed and this roll-up never needs. */
export interface PurchaseReturnCopy extends CostBasisInput {
  id: string;
  /** True when the copy left on a sale (ADR-0012) — the sold/unsold split. */
  sold: boolean;
  /** True when this sold copy's proceeds are inside the `realized` total handed to
   * {@link summarizePurchaseReturn}; false when its line's split was blocked. Meaningless, and
   * false, for a copy that has not sold. */
  proceedsResolved: boolean;
}

/** What one purchase order has cost and earned back so far (#559). Money is 2-dp base-currency
 * strings, as every other read model here states it. */
export interface PurchaseReturn {
  baseCurrency: string;
  /** Copies of the order the figures are over — everything that arrived, sold or not. */
  copyCount: number;
  /** …of which have sold. */
  soldCount: number;
  /** Sold copies whose proceeds could not be attributed (blocked mixed line). They are in
   * {@link soldCount} but contribute nothing to {@link realized}. */
  unattributedCount: number;
  /** Σ net proceeds attributed to the order's sold copies. */
  realized: string;
  /** Cost-basis over every copy of the order — the spend {@link netReturn} is against. */
  spent: CostBasisTotal;
  /** Cost-basis over the sold copies alone — the denominator of {@link soldMargin}. */
  soldCost: CostBasisTotal;
  /** `realized − spent`: what the whole order has made so far. Negative until enough of it sells. */
  netReturn: string;
  /** {@link netReturn} as a percentage of the spend, 1 dp; null when nothing was spent (nothing is
   * costed yet), since a percentage of zero states a return that was never invested. */
  netReturnPercent: number | null;
  /** `realized − cost of the sold copies`: how the completed sales themselves went. */
  soldMargin: string;
  /** {@link soldMargin} as a percentage of the sold copies' cost, 1 dp; null on the same rule. */
  soldMarginPercent: number | null;
}

/** A percentage of a base that may be zero or unknown; see {@link PurchaseReturn.netReturnPercent}. */
function percentOf(amountCents: number, baseCents: number): number | null {
  if (baseCents <= 0) return null;
  return Math.round((amountCents / baseCents) * 1000) / 10;
}

/**
 * Roll a purchase's copies up into its return (#559). Pure; see the module header for what each
 * figure claims and, above all, for what an unattributable sold copy does to `realized`.
 *
 * `realized` is the base-currency total the sale side attributed to these copies
 * (`realizedProceedsForItems`), which is a figure over the group rather than a sum of per-copy
 * shares — hence a total passed in beside the copies rather than read off them.
 */
export function summarizePurchaseReturn(
  copies: PurchaseReturnCopy[],
  realized: number,
  baseCurrency: string
): PurchaseReturn {
  const sold = copies.filter((c) => c.sold);
  const realizedCents = toCents(realized);
  const spent = aggregateCostBasis(copies, baseCurrency);
  const soldCost = aggregateCostBasis(sold, baseCurrency);

  const spentCents = toCents(Number(spent.totalCostBasis));
  const soldCostCents = toCents(Number(soldCost.totalCostBasis));

  return {
    baseCurrency,
    copyCount: copies.length,
    soldCount: sold.length,
    unattributedCount: sold.filter((c) => !c.proceedsResolved).length,
    realized: (realizedCents / 100).toFixed(2),
    spent,
    soldCost,
    netReturn: ((realizedCents - spentCents) / 100).toFixed(2),
    netReturnPercent: percentOf(realizedCents - spentCents, spentCents),
    soldMargin: ((realizedCents - soldCostCents) / 100).toFixed(2),
    soldMarginPercent: percentOf(realizedCents - soldCostCents, soldCostCents),
  };
}
