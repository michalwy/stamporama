import type { Decimal } from "@prisma/client/runtime/client";

// Pure catalog-price helpers — no Prisma, no `server-only`, so they are safe to
// import from unit-tested domain modules (see `valuation.ts`). Server-side pricing
// orchestration (rate fetching, primary-catalog resolution) lives in `pricing.ts`,
// which re-exports everything here for its existing callers.

/** A price shown in its catalog currency and, when different, the collection base currency. */
export interface MoneyDisplay {
  amount: string; // catalog-currency amount, 2 decimals
  currency: string;
  convertedAmount: string | null; // base-currency amount, or null when same currency / no rate
  baseCurrency: string;
}

/** Aggregate price for the required members of an issue. */
export interface IssuePriceTotal extends MoneyDisplay {
  pricedCount: number; // required members contributing to the sum
  requiredCount: number; // total required members
  // True when the sum falls back to older-edition prices because no required member
  // is priced on the current (latest) edition of the primary catalog.
  usesOlderEdition: boolean;
  // Required members priced only on an older edition, excluded from a current-edition sum.
  olderEditionExcludedCount: number;
  // Counted members whose price was rolled up from the lowest variant child because they
  // are unknown-variant umbrellas with no own price (#238) — the total is then an estimate.
  estimatedCount: number;
}

/** Raw catalog price shape needed to pick the main-catalog price. */
export interface RawCatalogPrice {
  price: Decimal;
  currency: string;
  conditionId: string;
  certificateStatusId: string | null;
  catalogEdition: { year: number; catalogNameId: string };
}

/** A concrete picked price: amount + currency + the edition it came from. */
export interface PickedPrice {
  amount: number;
  currency: string;
  catalogNameId: string;
  editionYear: number;
}

/**
 * Latest catalog edition (by year) with a recorded price for the primary catalog
 * name, at the given condition and certificate status. When `certificateStatusId`
 * is `null` the match is the no-certificate price; otherwise an exact certificate
 * match is required (no fall-back across certificate levels). Returns null when no
 * condition/catalog is given or no matching price exists.
 */
export function pickCatalogPriceFor(
  prices: RawCatalogPrice[],
  primaryCatalogNameId: string | null,
  conditionId: string | null,
  certificateStatusId: string | null
): PickedPrice | null {
  if (!primaryCatalogNameId || !conditionId) return null;
  let best: RawCatalogPrice | null = null;
  for (const p of prices) {
    if (p.catalogEdition.catalogNameId !== primaryCatalogNameId) continue;
    if (p.conditionId !== conditionId) continue;
    if (p.certificateStatusId !== certificateStatusId) continue;
    if (!best || p.catalogEdition.year > best.catalogEdition.year) best = p;
  }
  if (!best) return null;
  return {
    amount: Number(best.price),
    currency: best.currency,
    catalogNameId: best.catalogEdition.catalogNameId,
    editionYear: best.catalogEdition.year,
  };
}

/**
 * Latest edition of the primary catalog name for the given display condition with
 * no certificate status (the "headline" price shown in lists and summed for issue
 * totals). Thin wrapper over `pickCatalogPriceFor` with certificate = none.
 */
export function pickMainCatalogPrice(
  prices: RawCatalogPrice[],
  primaryCatalogNameId: string | null,
  displayConditionId: string | null
): PickedPrice | null {
  return pickCatalogPriceFor(prices, primaryCatalogNameId, displayConditionId, null);
}

/** The candidate with the lowest base-currency value. Unconvertible candidates (no rate)
 * cannot be compared, so they are skipped; if every candidate is unconvertible the first is
 * returned (amount known, base value unknown). Null when there are no candidates. Shared by
 * the copy valuation (unknown-variant rule) and the issue-list headline rollup. */
export function pickLowestByBase(
  candidates: PickedPrice[],
  baseCurrency: string,
  rates: Map<string, number | null>
): PickedPrice | null {
  if (candidates.length === 0) return null;
  let best: PickedPrice | null = null;
  let bestBase: number | null = null;
  for (const c of candidates) {
    const bv = baseValueOf(c.amount, c.currency, baseCurrency, rates);
    if (bv === null) continue;
    if (bestBase === null || bv < bestBase) {
      best = c;
      bestBase = bv;
    }
  }
  return best ?? candidates[0];
}

/**
 * Headline catalog price for a stamp, applying the unknown-variant rule (ADR-0007 §7) to
 * the primary catalog at the display condition (certificate = none): the stamp's own price
 * when it has one, otherwise — when it is an unknown-variant umbrella — the **lowest**
 * descendant-variant price compared in the base currency (#238). `uncertain` is true only
 * when the value was rolled up from a variant (the stamp has no own price of its own); an
 * umbrella that carries its own recorded price is a definite figure and stays certain.
 * Non-umbrella stamps never roll up.
 */
export function pickHeadlineCatalogPrice(input: {
  ownPrices: RawCatalogPrice[];
  /** Per variant-child descendant: that variant's prices. Only consulted for an umbrella
   *  with no own price. Each inner array is one descendant variant. */
  variantPrices?: RawCatalogPrice[][];
  isUmbrella: boolean;
  primaryCatalogNameId: string | null;
  displayConditionId: string | null;
  baseCurrency: string;
  rates: Map<string, number | null>;
}): { picked: PickedPrice | null; uncertain: boolean } {
  const pick = (prices: RawCatalogPrice[]) =>
    pickMainCatalogPrice(prices, input.primaryCatalogNameId, input.displayConditionId);
  const own = pick(input.ownPrices);
  if (own || !input.isUmbrella) return { picked: own, uncertain: false };
  const candidates = (input.variantPrices ?? [])
    .map(pick)
    .filter((p): p is PickedPrice => p !== null);
  const lowest = pickLowestByBase(candidates, input.baseCurrency, input.rates);
  return { picked: lowest, uncertain: lowest !== null };
}

/**
 * Value of an amount expressed in the collection base currency, or null when it
 * cannot be expressed there (non-base currency with no available rate). Amounts
 * already in the base currency return unchanged. Used to make catalog prices in
 * different currencies comparable so they can be averaged or minimised.
 */
export function baseValueOf(
  amount: number,
  currency: string,
  baseCurrency: string,
  rates: Map<string, number | null>
): number | null {
  if (currency === baseCurrency) return amount;
  const rate = rates.get(currency) ?? null;
  return rate != null ? amount * rate : null;
}

/** Arithmetic mean of the given values, or null when the list is empty. */
export function averageOf(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((s, v) => s + v, 0) / values.length;
}

/** Convert an amount to the base currency using a rate map; null when same currency or no rate. */
export function applyConversion(
  amount: number,
  currency: string,
  baseCurrency: string,
  rates: Map<string, number | null>
): string | null {
  if (currency === baseCurrency) return null;
  const rate = rates.get(currency) ?? null;
  return rate != null ? (amount * rate).toFixed(2) : null;
}
