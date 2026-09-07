// What an order — or one of its lots — actually cost (#852): the total, its breakdown into
// price and shipping, and the same three in the collection's base currency.
//
// The app has always held every part of this and never added them up. The price paid is one
// figure on the order header, the shipping another chip beside it, and the base-currency
// equivalent existed only per lot (`LotPool.poolBase`). "What did this parcel cost me" was the
// one question the purchase screen could not answer.
//
// Pure — no Prisma, no `server-only` — so it is unit-testable and so the client components that
// print it are not doing arithmetic on money. It sits beside `purchase-allocation.ts` rather
// than inside it: that module is the engine that *decides* where the money goes (ADR-0009 §3),
// and this one only restates its inputs in the two currencies a reader wants them in.
//
// Two rules carry the whole module, and both are about not overstating:
//
//  1. **The parts sum to the total, exactly.** The base-currency total is converted directly
//     (the same `round(amount × rate)` the pool conversion does), and price and shipping are
//     then apportioned out of it by `apportionMoney` — the engine's own largest-remainder rule.
//     Converting each part on its own instead would routinely produce a breakdown a cent away
//     from its own total, which is precisely the kind of figure that is right on seeded data
//     and wrong on real data.
//  2. **An unconvertible total is absent, never partial.** A purchase has a single transaction
//     currency, so price and shipping either both convert or neither does; there is no case
//     where one component could be dropped from the sum. When no rate is recorded and the
//     order's currency is not the base one, `base` is null and the screen says so — a total
//     that quietly omitted a part would be worse than no total.

import { apportionMoney } from "./purchase-allocation";

/** Round a money amount to whole cents, guarding against binary-float drift. */
function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function money(amount: number): string {
  return (toCents(amount) / 100).toFixed(2);
}

/** The three figures, in one currency, at 2 dp. */
export interface SpendBreakdown {
  /** ISO code the three amounts are stated in. */
  currency: string;
  /** `price` + `shipping`. */
  total: string;
  /** The priced lines: a lot's own price, or every lot and expense of an order. */
  price: string;
  /** The shared cost: the order's whole shipping charge, or one lot's share of it. */
  shipping: string;
}

/** What one scope cost, in both currencies (#852). */
export interface PurchaseSpend {
  /**
   * Which scope these figures are about — the whole order, or one of its lots. It exists so the
   * screen can *name* the row (`Order total` / `Lot total`) rather than print a bare `Total cost`
   * two rows above the bar's existing `Purchase cost`, which is a different figure: that one is
   * the cost basis frozen onto the copies in scope, and this one is the order's money.
   */
  scope: "order" | "lot";
  /** The transaction currency — what was actually paid, and what a receipt would show. */
  tx: SpendBreakdown;
  /**
   * The same three in the collection's base currency at the rate frozen on the order, the only
   * figures comparable with anything else in the app. **Null when the order is in a foreign
   * currency and carries no rate**: the conversion is unavailable rather than partial.
   *
   * When the transaction currency *is* the base currency this is a copy of `tx`, so a caller
   * can read it without a special case; a screen tells the two apart by comparing the codes,
   * not by this field being set.
   */
  base: SpendBreakdown | null;
  /** The collection's base currency, stated even when nothing could be converted into it. */
  baseCurrency: string;
  /**
   * On a **lot**, the order's whole shipping charge (transaction currency) that `shipping` is a
   * share of; null on an order, whose shipping is the charge itself, and on a lot of an order
   * with no shipping at all.
   *
   * A lot's shipping is apportioned across every line by price (ADR-0009 §3.1) — it is not a
   * charge the lot incurred — so the whole is named beside the share rather than the share
   * being left to read as the bill.
   */
  shippingShareOf: string | null;
  /**
   * How many priced lines are behind `price` on an **order**: inventory lots and non-inventory
   * expenses (ADR-0009 §1), which are counted apart because an expense is not a stamp. Null on
   * a lot, whose price is one line.
   */
  lines: { lots: number; expenses: number } | null;
}

export interface SpendInput {
  scope: "order" | "lot";
  /** Priced lines, transaction currency. */
  priceTx: number;
  /** Shared cost — the whole charge on an order, this lot's share on a lot. */
  shippingTx: number;
  currency: string;
  baseCurrency: string;
  /** The rate frozen on the order, or null (which is also how "no conversion needed" is stored). */
  fxRateToBase: number | null;
  /** The order's whole shipping charge, when this scope is one lot of it. */
  shippingShareOf?: number | null;
  /** Line counts, when this scope is a whole order. */
  lines?: { lots: number; expenses: number } | null;
}

/**
 * Resolve what a scope cost in both currencies. `priceTx` and `shippingTx` are the engine's own
 * figures — a lot's `price` and `sharedCost` from `computeLotPool`, or an order's line total and
 * `shippingCost` — so the total here and the pool the cost basis is split from cannot drift
 * apart.
 */
export function resolvePurchaseSpend(input: SpendInput): PurchaseSpend {
  const priceCents = toCents(input.priceTx);
  const shippingCents = toCents(input.shippingTx);
  const totalTx = (priceCents + shippingCents) / 100;

  const tx: SpendBreakdown = {
    currency: input.currency,
    total: money(totalTx),
    price: money(priceCents / 100),
    shipping: money(shippingCents / 100),
  };

  // The rate is deliberately null when the transaction currency *is* the base one, so a
  // genuinely-unknown cross-currency rate is the only case that leaves the base side empty —
  // `getPurchaseDetail`'s `canExpressBase` makes the same call for `poolBase`.
  const sameCurrency = input.currency === input.baseCurrency;
  const convertible = sameCurrency || input.fxRateToBase != null;

  let base: SpendBreakdown | null = null;
  if (convertible) {
    const rate = input.fxRateToBase ?? 1;
    const totalBase = toCents(totalTx * rate) / 100;
    // Parts out of the converted whole (rule 1 above), by the engine's own apportionment, so
    // price + shipping is the total to the cent in the base currency too. A zero total yields
    // zero parts whatever the weights, which is the only way the weight base can be empty here.
    const [priceBase, shippingBase] = apportionMoney(totalBase, [
      priceCents / 100,
      shippingCents / 100,
    ]);
    base = {
      currency: input.baseCurrency,
      total: money(totalBase),
      price: money(priceBase),
      shipping: money(shippingBase),
    };
  }

  return {
    scope: input.scope,
    tx,
    base,
    baseCurrency: input.baseCurrency,
    shippingShareOf:
      input.shippingShareOf != null && toCents(input.shippingShareOf) > 0
        ? money(input.shippingShareOf)
        : null,
    lines: input.lines ?? null,
  };
}
