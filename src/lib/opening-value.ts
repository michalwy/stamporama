// What an opening balance — or one of its lots — brings in at value (#1325; ADR-0054): the lead line
// of its summary panel, in place of the order total a purchase leads with.
//
// A purchase's panel leads with what it cost (#1183). An opening balance cost nothing and has no
// shipping, so that line would state something untrue; what the collector needs at a glance there is
// the **opening value**, or that there is none.
//
// Pure — no Prisma, no `server-only` — for the same reasons `purchase-spend.ts` is, whose conversion
// it reuses so the two panels cannot disagree about how an amount becomes the base currency. Two
// rules carry it:
//
//  1. **No value is never `0.00`** (#1184, ADR-0054 §3). A lot's price is null when it has no
//     opening value, and the sum skips it. When no lot carries one there is no figure at all —
//     `value` is null — whereas a lot valued at zero is a value and sums as one.
//  2. **The lots without a value are counted**, so a sum over some of them is never passed off as a
//     sum over all of them.

import { resolvePurchaseSpend } from "./purchase-spend";

/** The opening value of one scope, in both currencies (#1325). */
export interface OpeningValue {
  /** The whole opening balance, or one of its lots — the screen names the row by it. */
  scope: "order" | "lot";
  /**
   * The summed opening values, in the document's currency and at its frozen rate in the base one
   * (`base` null when the document is in another currency and carries no rate). **Null when no lot
   * in scope has a value** — the absence the screen states in words.
   */
  value: { tx: string; base: string | null } | null;
  /** The document's currency. */
  currency: string;
  /** The collection's base currency, stated even when nothing could be converted into it. */
  baseCurrency: string;
  /** Lots in scope: every lot of the document, or 1. */
  lotCount: number;
  /** Lots in scope with no opening value. */
  unvaluedLotCount: number;
}

export interface OpeningValueInput {
  scope: "order" | "lot";
  /** Each lot's opening value in the document's currency, null where it has none. */
  lotPrices: readonly (number | null)[];
  currency: string;
  baseCurrency: string;
  /** The rate frozen on the document, or null (which is also how "no conversion needed" is stored). */
  fxRateToBase: number | null;
}

/** Resolve the opening value of a scope. */
export function resolveOpeningValue(input: OpeningValueInput): OpeningValue {
  const valued = input.lotPrices.filter((p): p is number => p != null);
  const common = {
    scope: input.scope,
    currency: input.currency,
    baseCurrency: input.baseCurrency,
    lotCount: input.lotPrices.length,
    unvaluedLotCount: input.lotPrices.length - valued.length,
  };
  if (valued.length === 0) return { ...common, value: null };

  // Summed in whole cents, then converted as a purchase total is: one multiplication over the whole,
  // never a sum of per-lot conversions each rounding its own way. Nothing was shipped, so the
  // spend's shipping half is zero and its total is the sum.
  const cents = valued.reduce((sum, p) => sum + Math.round(p * 100), 0);
  const spend = resolvePurchaseSpend({
    scope: input.scope,
    priceTx: cents / 100,
    shippingTx: 0,
    currency: input.currency,
    baseCurrency: input.baseCurrency,
    fxRateToBase: input.fxRateToBase,
  });
  return { ...common, value: { tx: spend.tx.total, base: spend.base?.total ?? null } };
}
