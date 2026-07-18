import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import { getOrFetchRate } from "./exchange-rates";

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
}

/** Raw catalog price shape needed to pick the main-catalog price. */
export interface RawCatalogPrice {
  price: Decimal;
  currency: string;
  conditionId: string;
  certificateStatusId: string | null;
  catalogEdition: { year: number; catalogNameId: string };
}

/**
 * Effective primary catalog name per area, inheriting from ancestors.
 * Returns Map<areaId, primaryCatalogNameId | null>.
 */
export async function buildEffectivePrimaryCatalogMap(
  collectionId: string
): Promise<Map<string, string | null>> {
  const areas = await prisma.collectionArea.findMany({
    where: { collectionId },
    select: { id: true, parentId: true, primaryCatalogNameId: true },
  });
  const byId = new Map(areas.map((a) => [a.id, a]));
  const result = new Map<string, string | null>();
  for (const a of areas) {
    let current: (typeof areas)[number] | undefined = a;
    let depth = 0;
    let found: string | null = null;
    while (current && depth < 50) {
      if (current.primaryCatalogNameId) {
        found = current.primaryCatalogNameId;
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
      depth++;
    }
    result.set(a.id, found);
  }
  return result;
}

/**
 * Latest catalog edition (by year) that has a recorded price for the primary
 * catalog name, in the given display condition with no certificate status
 * (the "headline" price shown in lists and summed for issue totals).
 * Returns null when no condition is selected or no matching price exists.
 */
export function pickMainCatalogPrice(
  prices: RawCatalogPrice[],
  primaryCatalogNameId: string | null,
  displayConditionId: string | null
): { amount: number; currency: string; catalogNameId: string; editionYear: number } | null {
  if (!primaryCatalogNameId || !displayConditionId) return null;
  let best: RawCatalogPrice | null = null;
  for (const p of prices) {
    if (p.catalogEdition.catalogNameId !== primaryCatalogNameId) continue;
    if (p.conditionId !== displayConditionId) continue;
    if (p.certificateStatusId !== null) continue;
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
 * Latest edition year per catalog name in a collection.
 * Used to detect stale prices (a price whose edition is not the newest for its catalog name).
 */
export async function getLatestEditionYearByName(
  collectionId: string
): Promise<Map<string, number>> {
  const editions = await prisma.catalogEdition.findMany({
    where: { catalogName: { vendor: { collectionId } } },
    select: { catalogNameId: true, year: true },
  });
  const map = new Map<string, number>();
  for (const e of editions) {
    const cur = map.get(e.catalogNameId);
    if (cur === undefined || e.year > cur) map.set(e.catalogNameId, e.year);
  }
  return map;
}

/**
 * Fetch conversion rates (fromCurrency → base) for the given currencies.
 * Per-currency try/catch so a single failing pair never breaks the whole list.
 */
export async function safeRateMap(
  collectionId: string,
  baseCurrency: string,
  currencies: string[]
): Promise<Map<string, number | null>> {
  const unique = [...new Set(currencies)].filter((c) => c && c !== baseCurrency);
  const map = new Map<string, number | null>();
  for (const c of unique) {
    try {
      const r = await getOrFetchRate(collectionId, c, baseCurrency);
      map.set(c, r.rate);
    } catch {
      map.set(c, null);
    }
  }
  return map;
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

/**
 * The condition a list's price column values by: the caller's explicit choice,
 * else the collection's first condition by sortOrder, else null when the
 * collection has no conditions. Certificate status for the headline price is
 * always "none". See #95.
 */
export async function resolveDisplayConditionId(
  collectionId: string,
  requested: string | null | undefined
): Promise<string | null> {
  if (requested) return requested;
  const first = await prisma.stampCondition.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: { id: true },
  });
  return first?.id ?? null;
}

/** Collection base currency (small dedicated query for list endpoints). */
export async function getCollectionBaseCurrency(collectionId: string): Promise<string> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { baseCurrency: true },
  });
  return col?.baseCurrency ?? "EUR";
}
