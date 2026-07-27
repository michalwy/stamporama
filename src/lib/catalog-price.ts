import type { Decimal } from "@prisma/client/runtime/client";
import { deriveFormatPrice } from "./format-factor";

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
  // Counted members whose price was derived from the single's by a format multiplier rather than
  // recorded for the displayed format (#343) — the other way a total becomes an estimate.
  derivedCount: number;
}

/** Raw catalog price shape needed to pick the main-catalog price. */
export interface RawCatalogPrice {
  price: Decimal;
  currency: string;
  conditionId: string;
  certificateStatusId: string | null;
  /** Physical format (ADR-0020); null = single. Required rather than optional on purpose: a
   *  producer that forgot to select it would silently pass block prices off as singles. */
  formatId: string | null;
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
 * name, at the given condition, certificate status and format. When `certificateStatusId`
 * is `null` the match is the no-certificate price; otherwise an exact certificate
 * match is required (no fall-back across certificate levels). `formatId` defaults to null —
 * the single — and matches exactly for the same reason: a block's price is a different figure,
 * not a variation of the single's, and must never stand in for it (ADR-0020). Returns null when
 * no condition/catalog is given or no matching price exists.
 */
export function pickCatalogPriceFor(
  prices: RawCatalogPrice[],
  primaryCatalogNameId: string | null,
  conditionId: string | null,
  certificateStatusId: string | null,
  formatId: string | null = null
): PickedPrice | null {
  if (!primaryCatalogNameId || !conditionId) return null;
  let best: RawCatalogPrice | null = null;
  for (const p of prices) {
    if (p.catalogEdition.catalogNameId !== primaryCatalogNameId) continue;
    if (p.conditionId !== conditionId) continue;
    if (p.certificateStatusId !== certificateStatusId) continue;
    if (p.formatId !== formatId) continue;
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
  displayConditionId: string | null,
  displayFormatId: string | null = null
): PickedPrice | null {
  return pickCatalogPriceFor(prices, primaryCatalogNameId, displayConditionId, null, displayFormatId);
}

/** A price for a format, and whether it had to be **derived** from the single's (#343). */
export interface FormatPricePick {
  picked: PickedPrice | null;
  /** True when no explicit row existed for the format and the single's price was multiplied by a
   * {@link https://github.com/michalwy/stamporama/issues/343 StampFormatFactor}. */
  derived: boolean;
}

/**
 * A format's price: **explicit or derived** (ADR-0020). An explicit `StampCatalogPrice` recorded
 * for the format always wins; only in its absence is the single's price multiplied by the resolved
 * factor. Null format short-circuits to the plain pick — the single *is* the null case, and there
 * is nothing to derive it from.
 *
 * Derivation needs both halves: with no single price to scale, or no factor to scale it by, there
 * is nothing to show. A derived figure keeps the single's currency and edition — a factor is a pure
 * multiplier, and the value is still "what that edition says", read through a rule.
 */
export function pickFormatCatalogPrice(
  prices: RawCatalogPrice[],
  primaryCatalogNameId: string | null,
  conditionId: string | null,
  certificateStatusId: string | null,
  formatId: string | null,
  factor: number | null
): FormatPricePick {
  const pick = (fmt: string | null) =>
    pickCatalogPriceFor(prices, primaryCatalogNameId, conditionId, certificateStatusId, fmt);
  if (!formatId) return { picked: pick(null), derived: false };
  const explicit = pick(formatId);
  if (explicit) return { picked: explicit, derived: false };
  if (factor === null) return { picked: null, derived: false };
  const single = pick(null);
  if (!single) return { picked: null, derived: false };
  return {
    picked: { ...single, amount: deriveFormatPrice(single.amount, factor) },
    derived: true,
  };
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
  /** The format the list is showing (#343); null — the default — is the single. */
  displayFormatId?: string | null;
  /** The multiplier resolved for `displayFormatId` on this stamp, or null when none applies. Used
   *  for the variant candidates too: a variant child sits in the same issue and area as its
   *  umbrella, so the umbrella's factor is the one a catalog would print for it. */
  formatFactor?: number | null;
  baseCurrency: string;
  rates: Map<string, number | null>;
}): { picked: PickedPrice | null; uncertain: boolean; derived: boolean } {
  const pick = (prices: RawCatalogPrice[]) =>
    pickFormatCatalogPrice(
      prices,
      input.primaryCatalogNameId,
      input.displayConditionId,
      null,
      input.displayFormatId ?? null,
      input.formatFactor ?? null
    );
  const own = pick(input.ownPrices);
  if (own.picked || !input.isUmbrella) {
    return { picked: own.picked, uncertain: false, derived: own.derived };
  }
  const candidates = (input.variantPrices ?? [])
    .map(pick)
    .filter((p): p is FormatPricePick & { picked: PickedPrice } => p.picked !== null);
  const lowest = pickLowestByBase(
    candidates.map((c) => c.picked),
    input.baseCurrency,
    input.rates
  );
  return {
    picked: lowest,
    uncertain: lowest !== null,
    derived: lowest !== null && (candidates.find((c) => c.picked === lowest)?.derived ?? false),
  };
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
