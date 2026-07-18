import "server-only";
import { prisma } from "./db";
import { getOrFetchRate } from "./exchange-rates";

// Pure catalog-price helpers moved to `./catalog-price` (no Prisma / server-only)
// so they can be shared with unit-tested domain modules. Re-exported here so this
// module's existing importers keep working unchanged.
export {
  pickMainCatalogPrice,
  pickCatalogPriceFor,
  baseValueOf,
  averageOf,
  applyConversion,
} from "./catalog-price";
export type {
  MoneyDisplay,
  IssuePriceTotal,
  RawCatalogPrice,
  PickedPrice,
} from "./catalog-price";

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
