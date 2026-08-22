import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getOrFetchRate } from "./exchange-rates";

// Pure catalog-price helpers moved to `./catalog-price` (no Prisma / server-only)
// so they can be shared with unit-tested domain modules. Re-exported here so this
// module's existing importers keep working unchanged.
export {
  pickMainCatalogPrice,
  pickCatalogPriceFor,
  pickFormatCatalogPrice,
  pickHeadlineCatalogPrice,
  pickLowestByBase,
  baseValueOf,
  averageOf,
  applyConversion,
} from "./catalog-price";
export type {
  MoneyDisplay,
  IssuePriceTotal,
  RawCatalogPrice,
  PickedPrice,
  FormatPricePick,
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
 * The catalog **books** that price each area, inheriting down the tree: the `CollectionAreaCatalog`
 * links of the nearest ancestor that attaches any, or the area's own when it does (#675).
 *
 * One rule for every reader. The three server paths that resolve an area's price sources used to
 * disagree — the trade's agreed catalog walked the tree, while the variant price grid and the stamp
 * catalog-prices tab read own rows only and so offered nothing on a leaf whose books sit on its
 * parent, which is why the same books had to be re-attached at every leaf area.
 *
 * The unit that inherits is the **whole list**, not one book at a time: the nearest ancestor that
 * says anything about price sources answers for all of them, which is the same shape the prefix
 * resolution has (ADR-0020's *where* outranks *for which*). So an area attaching a single Michel
 * volume states its price sources completely, and does not silently keep an ancestor's Fischer.
 *
 * Ordering is pinned — vendor name, then catalog name, then id — because callers turn it into an
 * answer: {@link buildVendorCatalogMap} takes the first book of the vendor it was asked about, and a
 * line may not be valued from one volume today and another tomorrow.
 *
 * Returns Map<areaId, catalogNameId[]>; an area with no books anywhere up its chain maps to `[]`.
 */
export async function buildEffectiveAreaCatalogMap(
  collectionId: string
): Promise<Map<string, string[]>> {
  const [areas, links] = await Promise.all([
    prisma.collectionArea.findMany({
      where: { collectionId },
      select: { id: true, parentId: true },
    }),
    prisma.collectionAreaCatalog.findMany({
      where: {
        collectionArea: { collectionId },
        catalogName: { vendor: { collectionId } },
      },
      select: { collectionAreaId: true, catalogNameId: true },
      orderBy: [
        { catalogName: { vendor: { name: "asc" } } },
        { catalogName: { name: "asc" } },
        { catalogNameId: "asc" },
      ],
    }),
  ]);

  const own = new Map<string, string[]>();
  for (const l of links) {
    const list = own.get(l.collectionAreaId);
    if (list) list.push(l.catalogNameId);
    else own.set(l.collectionAreaId, [l.catalogNameId]);
  }

  const byId = new Map(areas.map((a) => [a.id, a]));
  const result = new Map<string, string[]>();
  for (const a of areas) {
    let current: (typeof areas)[number] | undefined = a;
    let depth = 0;
    let found: string[] | null = null;
    while (current && depth < 50) {
      const list = own.get(current.id);
      if (list && list.length > 0) {
        found = list;
        break;
      }
      current = current.parentId ? byId.get(current.parentId) : undefined;
      depth++;
    }
    result.set(a.id, found ?? []);
  }
  return result;
}

/**
 * Effective catalog **name** per area for one named vendor, inheriting from ancestors exactly as
 * {@link buildEffectivePrimaryCatalogMap} does.
 *
 * The area → book resolution for a catalog the collector has *named* rather than the one the area
 * calls primary — which is what a trade's agreed catalog is (#638; ADR-0039 §7). Two collectors
 * agree on a publisher ("we go by Michel"), never on one of its books: *Michel Deutschland* prices
 * nothing Polish, and a trade routinely spans several areas. So the vendor is the agreed fact and
 * the volume each line is read in follows from its stamp's area, through the same
 * `CollectionAreaCatalog` links every other valuation already walks.
 *
 * An area declaring several of one vendor's books resolves to the first by name — deterministic, so
 * that a line cannot be valued from one volume today and another tomorrow. Areas whose effective
 * book list holds nothing of this vendor map to null, and a line under one of them has no agreed
 * valuation rather than a wrong one.
 *
 * The tree walk itself is {@link buildEffectiveAreaCatalogMap}'s since #675, so this answers off the
 * same book list the variant price grid and the stamp prices tab offer. The one behavioural
 * consequence: an area that attaches books of its own states its price sources *completely*, so a
 * vendor missing from that list is missing here too rather than falling through to an ancestor.
 */
export async function buildVendorCatalogMap(
  collectionId: string,
  vendorId: string
): Promise<Map<string, string | null>> {
  const booksByArea = await buildEffectiveAreaCatalogMap(collectionId);
  const allIds = [...new Set([...booksByArea.values()].flat())];
  const ofVendor = new Set<string>();
  if (allIds.length > 0) {
    const names = await prisma.catalogName.findMany({
      where: { id: { in: allIds }, vendorId, vendor: { collectionId } },
      select: { id: true },
    });
    for (const n of names) ofVendor.add(n.id);
  }
  const result = new Map<string, string | null>();
  for (const [areaId, ids] of booksByArea) {
    result.set(areaId, ids.find((id) => ofVendor.has(id)) ?? null);
  }
  return result;
}

/**
 * Effective primary *vendor* per area — the vendor that **leads numbering** here: the catalog sort
 * key (#181), the leading catalog label and the primary chip. Read from `primaryCatalogVendorId`,
 * inherited from the nearest ancestor that sets one exactly as {@link
 * buildEffectivePrimaryCatalogMap} resolves the primary book.
 *
 * It used to be derived from the primary catalog *name*, which made one column answer two unrelated
 * questions (#675): which book gives a copy its catalogue value (`item-valuation.ts`, still
 * `primaryCatalogNameId`'s job and now its only one) and which vendor leads the numbering. They are
 * separable and must be, or a vendor recorded on an area without any of its books — an ordinary
 * situation — could never lead.
 *
 * Returns Map<areaId, primaryVendorId | null>; areas that declare no leading vendor anywhere up
 * their chain map to null.
 */
export async function buildPrimaryVendorByAreaMap(
  collectionId: string
): Promise<Map<string, string | null>> {
  const areas = await prisma.collectionArea.findMany({
    where: { collectionId },
    select: { id: true, parentId: true, primaryCatalogVendorId: true },
  });
  const byId = new Map(areas.map((a) => [a.id, a]));
  const result = new Map<string, string | null>();
  for (const a of areas) {
    let current: (typeof areas)[number] | undefined = a;
    let depth = 0;
    let found: string | null = null;
    while (current && depth < 50) {
      if (current.primaryCatalogVendorId) {
        found = current.primaryCatalogVendorId;
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

/**
 * For each ancestor stamp id, the set of all descendant stamp ids (children,
 * grandchildren, …), so unknown-variant valuation and the issue-list headline rollup can
 * gather every child's prices. Empty when no ancestors.
 *
 * Scoped to the subtrees under `ancestorIds` via a recursive CTE rather than a flat read
 * of the whole collection, so the cost scales with the descendants actually needed, not
 * the size of the collection (#171).
 *
 * Each set is in a **pinned order** — catalog sort key (#181, nulls last), then name, then id — and
 * that is load-bearing rather than tidy (#617). Two readers turn this order into an answer: a tie in
 * the lowest-price rollup is broken by whichever candidate came first (`pickLowestByBase`), so the
 * variant a copy is valued and *listed* under would otherwise be whichever row Postgres handed back;
 * and the listing preconditions print the unpriced variants in this order for the collector to go and
 * price. An unordered `SELECT` is not stable across runs, which is exactly how CI caught it. It is
 * the general rule stated in `offers.md` for `assertAddableCopies`: an order that is used has to be
 * written down, because `orderBy` at the point of use cannot recover one the source never had.
 */
export async function buildDescendantMap(
  collectionId: string,
  ancestorIds: Set<string>
): Promise<Map<string, Set<string>>> {
  const result = new Map<string, Set<string>>();
  if (ancestorIds.size === 0) return result;

  // Walk each root's subtree, carrying the originating root id down every edge so a
  // single CTE resolves all ancestors at once. `collectionId` guards the tenancy
  // boundary; the parentId join keeps the walk inside it regardless.
  const rows = await prisma.$queryRaw<Array<{ root: string; id: string }>>`
    WITH RECURSIVE subtree AS (
      SELECT s."id" AS root, s."id" AS id
      FROM "stamp" s
      WHERE s."id" IN (${Prisma.join([...ancestorIds])})
        AND s."collectionId" = ${collectionId}
      UNION ALL
      SELECT st.root, c."id"
      FROM "stamp" c
      JOIN subtree st ON c."parentId" = st.id
      WHERE c."collectionId" = ${collectionId}
    )
    SELECT st.root, st.id
    FROM subtree st
    JOIN "stamp" s ON s."id" = st.id
    WHERE st.id <> st.root
    ORDER BY s."primaryCatalogSortKey" ASC NULLS LAST, s."name" ASC, s."id" ASC
  `;

  for (const { root, id } of rows) {
    let set = result.get(root);
    if (!set) {
      set = new Set<string>();
      result.set(root, set);
    }
    set.add(id);
  }
  return result;
}

/** Collection base currency (small dedicated query for list endpoints). */
export async function getCollectionBaseCurrency(collectionId: string): Promise<string> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { baseCurrency: true },
  });
  return col?.baseCurrency ?? "EUR";
}
