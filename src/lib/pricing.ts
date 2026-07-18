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
  pricedCount: number; // required members that had a main-catalog price
  requiredCount: number; // total required members
}

/** Raw catalog price shape needed to pick the main-catalog price. */
export interface RawCatalogPrice {
  price: Decimal;
  currency: string;
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

/** Latest catalog edition (by year) that has a recorded price for the primary catalog name. */
export function pickMainCatalogPrice(
  prices: RawCatalogPrice[],
  primaryCatalogNameId: string | null
): { amount: number; currency: string } | null {
  if (!primaryCatalogNameId) return null;
  let best: RawCatalogPrice | null = null;
  for (const p of prices) {
    if (p.catalogEdition.catalogNameId !== primaryCatalogNameId) continue;
    if (!best || p.catalogEdition.year > best.catalogEdition.year) best = p;
  }
  if (!best) return null;
  return { amount: Number(best.price), currency: best.currency };
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

/** Collection base currency (small dedicated query for list endpoints). */
export async function getCollectionBaseCurrency(collectionId: string): Promise<string> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { baseCurrency: true },
  });
  return col?.baseCurrency ?? "EUR";
}
