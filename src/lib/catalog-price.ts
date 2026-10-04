import type { Decimal } from "@prisma/client/runtime/client";
import { deriveFormatPrice } from "./format-factor";
import {
  catalogPriceMarkOf,
  combineCatalogPriceMarks,
  type CatalogPriceMark,
} from "./catalog-price-mark";

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
  // Required members left out because their catalogue gives no price on purpose — *does not exist*
  // or *not determinable* (#1615). Not missing prices: there is nothing to enter for them.
  markedCount: number;
}

/** Raw catalog price shape needed to pick the main-catalog price. */
export interface RawCatalogPrice {
  /** Null exactly when {@link mark} is set (#1615). */
  price: Decimal | null;
  /** The catalogue gives no price on purpose — `nonexistent` (—) or `undeterminable` (?). Required
   *  rather than optional for the reason `formatId` is: a producer that forgot to select it would
   *  read a marked row as a missing price. */
  mark: string | null;
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

/** What one cell holds on the edition that answers for it: a price, or a mark (#1615). */
export interface PickedCell {
  picked: PickedPrice | null;
  /** Set when that edition's row says the catalogue gives no price; `picked` is then null. */
  mark: CatalogPriceMark | null;
}

/**
 * The cell a catalogue answers for: the row of the **latest edition** that records anything at the
 * given key — a price or a mark (#1615). The newest edition is the catalogue's current word, so a
 * mark there outranks a price an older edition printed, and the other way round. Matching is
 * {@link pickCatalogPriceFor}'s.
 */
export function pickCatalogCellFor(
  prices: RawCatalogPrice[],
  primaryCatalogNameId: string | null,
  conditionId: string | null,
  certificateStatusId: string | null,
  formatId: string | null = null
): PickedCell {
  if (!primaryCatalogNameId || !conditionId) return { picked: null, mark: null };
  let best: RawCatalogPrice | null = null;
  for (const p of prices) {
    if (p.catalogEdition.catalogNameId !== primaryCatalogNameId) continue;
    if (p.conditionId !== conditionId) continue;
    if (p.certificateStatusId !== certificateStatusId) continue;
    if (p.formatId !== formatId) continue;
    if (!best || p.catalogEdition.year > best.catalogEdition.year) best = p;
  }
  if (!best) return { picked: null, mark: null };
  const mark = catalogPriceMarkOf(best.mark);
  if (mark || best.price === null) return { picked: null, mark };
  return {
    picked: {
      amount: Number(best.price),
      currency: best.currency,
      catalogNameId: best.catalogEdition.catalogNameId,
      editionYear: best.catalogEdition.year,
    },
    mark: null,
  };
}

/**
 * Latest catalog edition (by year) with a recorded price for the primary catalog
 * name, at the given condition, certificate status and format. When `certificateStatusId`
 * is `null` the match is the no-certificate price; otherwise an exact certificate
 * match is required (no fall-back across certificate levels). A cell whose latest edition is
 * marked (#1615) has no price — see {@link pickCatalogCellFor}. `formatId` defaults to null —
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
  return pickCatalogCellFor(
    prices,
    primaryCatalogNameId,
    conditionId,
    certificateStatusId,
    formatId
  ).picked;
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
  /** The catalogue gives no price here (#1615): the format's own row is marked, or — with no row of
   *  its own — the single's is, since a multiple of a stamp that does not exist does not exist
   *  either, and one of an unpriceable stamp cannot be priced. */
  mark: CatalogPriceMark | null;
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
    pickCatalogCellFor(prices, primaryCatalogNameId, conditionId, certificateStatusId, fmt);
  if (!formatId) return { ...pick(null), derived: false };
  const explicit = pick(formatId);
  if (explicit.picked || explicit.mark) return { ...explicit, derived: false };
  const single = pick(null);
  if (single.mark) return { picked: null, mark: single.mark, derived: false };
  if (factor === null || !single.picked) return { picked: null, mark: null, derived: false };
  return {
    picked: { ...single.picked, amount: deriveFormatPrice(single.picked.amount, factor) },
    mark: null,
    derived: true,
  };
}

/** The candidate with the lowest base-currency value. Unconvertible candidates (no rate)
 * cannot be compared, so they are skipped; if every candidate is unconvertible the first is
 * returned (amount known, base value unknown). Null when there are no candidates. Shared by
 * the copy valuation (unknown-variant rule) and the issue-list headline rollup.
 *
 * Generic over the candidate, and returning the candidate **itself** rather than a fresh price, so a
 * caller that tagged its candidates can read the tag back off the winner — which is how a rolled-up
 * copy valuation reports *which* variant it took its figure from (#616). Comparison needs nothing
 * but the amount and the currency. */
export function pickLowestByBase<T extends { amount: number; currency: string }>(
  candidates: readonly T[],
  baseCurrency: string,
  rates: Map<string, number | null>
): T | null {
  if (candidates.length === 0) return null;
  let best: T | null = null;
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
   *  with no own price. One entry is one descendant variant; `identified` is false for one with
   *  variant children of its own (#617), which is valued by them and is never a gap itself. */
  variantPrices?: { prices: RawCatalogPrice[]; identified: boolean }[];
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
}): HeadlineCatalogPrice {
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
  if (own.picked || own.mark || !input.isUmbrella) {
    return { picked: own.picked, mark: own.mark, uncertain: false, derived: own.derived };
  }
  const variants = (input.variantPrices ?? []).map((v) => ({ ...pick(v.prices), identified: v.identified }));
  const candidates = variants.filter(
    (p): p is (typeof variants)[number] & { picked: PickedPrice } => p.picked !== null
  );
  const lowest = pickLowestByBase(
    candidates.map((c) => c.picked),
    input.baseCurrency,
    input.rates
  );
  if (lowest) {
    return {
      picked: lowest,
      mark: null,
      uncertain: true,
      derived: candidates.find((c) => c.picked === lowest)?.derived ?? false,
    };
  }
  const mark = rolledUpCatalogPriceMark(variants);
  return { picked: null, mark, uncertain: mark !== null, derived: false };
}

/** A stamp's headline cell: a figure, a mark, or neither — see {@link pickHeadlineCatalogPrice}. */
export interface HeadlineCatalogPrice {
  picked: PickedPrice | null;
  /** The catalogue gives no price (#1615) — the stamp's own cell, or every variant of an umbrella. */
  mark: CatalogPriceMark | null;
  /** The value — figure or mark — was rolled up from the variants rather than recorded on the stamp. */
  uncertain: boolean;
  derived: boolean;
}

/**
 * The state an umbrella with **no priced variant** takes from its variants' marks (#1615): only when
 * every fully identified variant is marked — one that is merely not entered yet leaves the umbrella
 * not entered too. An intermediate umbrella (`identified: false`) is valued by its own children,
 * which are in the list themselves, so it is skipped unless it carries a mark of its own. Null when
 * there is no identified variant at all.
 */
export function rolledUpCatalogPriceMark(
  variants: readonly { mark: CatalogPriceMark | null; identified: boolean }[]
): CatalogPriceMark | null {
  const marks: CatalogPriceMark[] = [];
  let identifiedCount = 0;
  for (const v of variants) {
    if (v.identified) {
      identifiedCount++;
      if (!v.mark) return null;
    }
    if (v.mark) marks.push(v.mark);
  }
  return identifiedCount === 0 ? null : combineCatalogPriceMarks(marks);
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
/** One stamp's headline price as a checklist total counts it — see {@link foldChecklistPrices}. */
export interface ChecklistPricePick {
  amount: number;
  currency: string;
  /** Priced only on an older edition of its catalogue than the newest one known. */
  older: boolean;
  /** Rolled up from the lowest variant child (#238). */
  estimated: boolean;
  /** Derived from the single by a format multiplier (#343). */
  derived: boolean;
}

/**
 * A checklist's catalogue value, summed from its stamps' picked prices.
 *
 * **Editions**: when any stamp is priced on its catalogue's current edition, the total counts only
 * those and says how many older-only ones it left out; otherwise it falls back to the older prices
 * and says so. That is the issue list's rule, unchanged.
 *
 * **Currencies**: an issue's checklist is read through one leading catalogue, so its prices share
 * one currency and the total is stated in it, converted beside it. A checklist spanning issues
 * (#1416) may reach areas led by different catalogues — Michel in euros beside Fischer in złoty — and
 * adding those amounts as they stand would be a number in no currency at all. So when the counted
 * prices are in more than one currency, each is converted and the total is stated **in the base
 * currency**; a price with no rate to convert it by is left out of the count rather than added in
 * the wrong unit, and `pricedCount` says so.
 */
export function foldChecklistPrices(
  picks: readonly ChecklistPricePick[],
  requiredCount: number,
  baseCurrency: string,
  rates: Map<string, number | null>,
  /** Required stamps whose catalogue gives no price on purpose (#1615) — left out, and said so. */
  markedCount = 0
): IssuePriceTotal | null {
  const current = picks.filter((p) => !p.older);
  const usesOlderEdition = current.length === 0;
  let counted = usesOlderEdition ? picks.filter((p) => p.older) : current;
  if (counted.length === 0) return null;

  let currency = counted[counted.length - 1].currency;
  let amount: number;
  if (counted.every((p) => p.currency === currency)) {
    amount = counted.reduce((sum, p) => sum + p.amount, 0);
  } else {
    currency = baseCurrency;
    const rateOf = (c: string) => (c === baseCurrency ? 1 : (rates.get(c) ?? null));
    counted = counted.filter((p) => rateOf(p.currency) !== null);
    if (counted.length === 0) return null;
    amount = counted.reduce((sum, p) => sum + p.amount * rateOf(p.currency)!, 0);
  }

  return {
    amount: amount.toFixed(2),
    currency,
    convertedAmount: applyConversion(amount, currency, baseCurrency, rates),
    baseCurrency,
    pricedCount: counted.length,
    requiredCount,
    usesOlderEdition,
    olderEditionExcludedCount: usesOlderEdition ? 0 : picks.length - current.length,
    estimatedCount: counted.filter((p) => p.estimated).length,
    derivedCount: counted.filter((p) => p.derived).length,
    markedCount,
  };
}

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
