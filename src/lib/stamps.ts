import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import {
  catalogDigits,
  catalogKeyMatches,
  catalogMatchKey,
  formatCatalogNumber,
} from "./catalog-number";
import {
  type MoneyDisplay,
  type RawCatalogPrice,
  buildEffectivePrimaryCatalogMap,
  pickMainCatalogPrice,
  getLatestEditionYearByName,
  safeRateMap,
  applyConversion,
  baseValueOf,
  averageOf,
  getCollectionBaseCurrency,
  resolveDisplayConditionId,
} from "./pricing";
import { childIsVariant, VARIANT_FLAG_SELECT } from "./variant-classification";

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function resolveStampCollection(stampId: string): Promise<string> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { collectionId: true },
  });
  if (!stamp) throw new Error("Stamp not found.");
  return stamp.collectionId;
}

export interface StampCatalogNumberData {
  catalogVendorId: string;
  number: string;
}

export interface StampVariantData {
  id: string;
  collectionId: string;
  parentId: string | null;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  createdAt: Date;
  catalogNumbers: StampCatalogNumberData[];
}

export interface StampData extends StampVariantData {
  variants: StampVariantData[];
}

const VARIANT_SELECT = {
  id: true,
  collectionId: true,
  parentId: true,
  name: true,
  issuedDay: true,
  issuedMonth: true,
  issuedYear: true,
  createdAt: true,
  catalogNumbers: {
    select: { catalogVendorId: true, number: true },
  },
} as const;

const STAMP_SELECT = {
  ...VARIANT_SELECT,
  variants: { select: VARIANT_SELECT },
} as const;

export async function createStamp(
  ownerId: string,
  collectionId: string,
  data: { name?: string; issuedDay?: number; issuedMonth?: number; issuedYear?: number }
): Promise<StampData> {
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.create({
    data: {
      collectionId,
      name: data.name ?? null,
      issuedDay: data.issuedDay ?? null,
      issuedMonth: data.issuedMonth ?? null,
      issuedYear: data.issuedYear ?? null,
    },
    select: { ...STAMP_SELECT, variants: { select: STAMP_SELECT } },
  });
  return stamp;
}

export async function createVariant(
  ownerId: string,
  parentId: string,
  data: { name?: string; issuedDay?: number; issuedMonth?: number; issuedYear?: number }
): Promise<StampData> {
  const collectionId = await resolveStampCollection(parentId);
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.create({
    data: {
      collectionId,
      parentId,
      name: data.name ?? null,
      issuedDay: data.issuedDay ?? null,
      issuedMonth: data.issuedMonth ?? null,
      issuedYear: data.issuedYear ?? null,
    },
    select: { ...STAMP_SELECT, variants: { select: STAMP_SELECT } },
  });
  return stamp;
}

export async function updateStamp(
  ownerId: string,
  stampId: string,
  data: { name?: string | null; issuedDay?: number | null; issuedMonth?: number | null; issuedYear?: number | null }
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stamp.update({ where: { id: stampId }, data });
}

async function deleteStampTreeTx(
  tx: Parameters<Parameters<typeof prisma.$transaction>[0]>[0],
  stampId: string
): Promise<void> {
  const children = await tx.stamp.findMany({
    where: { parentId: stampId },
    select: { id: true },
  });
  for (const child of children) {
    await deleteStampTreeTx(tx, child.id);
  }
  await tx.stamp.delete({ where: { id: stampId } });
}

export async function deleteStamp(
  ownerId: string,
  stampId: string,
  mode: "cascade" | "reparent" = "cascade"
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);

  if (mode === "reparent") {
    await prisma.$transaction(async (tx) => {
      const stamp = await tx.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { parentId: true },
      });
      await tx.stamp.updateMany({
        where: { parentId: stampId },
        data: { parentId: stamp.parentId },
      });
      await tx.stamp.delete({ where: { id: stampId } });
    });
  } else {
    await prisma.$transaction(async (tx) => {
      await deleteStampTreeTx(tx, stampId);
    });
  }
}

export async function getStampChildCount(
  ownerId: string,
  stampId: string
): Promise<number> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stamp.count({ where: { parentId: stampId } });
}

export interface StampSubtypeAssignment {
  parentId: string | null;
  subtypeId: string | null;
  actsAsVariantOverride: boolean | null;
}

/** The subtype classification of a single stamp, for prefilling the edit form. */
export async function getStampSubtypeAssignment(
  ownerId: string,
  stampId: string
): Promise<StampSubtypeAssignment> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stamp.findUniqueOrThrow({
    where: { id: stampId },
    select: { parentId: true, subtypeId: true, actsAsVariantOverride: true },
  });
}

export async function getStamp(
  ownerId: string,
  stampId: string
): Promise<StampData> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const stamp = await prisma.stamp.findUniqueOrThrow({
    where: { id: stampId },
    select: { ...STAMP_SELECT, variants: { select: STAMP_SELECT } },
  });
  return stamp;
}

export async function listStamps(
  ownerId: string,
  collectionId: string,
  filters?: { collectionAreaId?: string }
): Promise<StampData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stamp.findMany({
    where: {
      collectionId,
      parentId: null,
      ...(filters?.collectionAreaId
        ? { stampAreaLinks: { some: { collectionAreaId: filters.collectionAreaId } } }
        : {}),
    },
    select: { ...STAMP_SELECT, variants: { select: STAMP_SELECT } },
    orderBy: { createdAt: "asc" },
  });
}

// ── Paginated queries (used by API routes) ─────────────────────────────────

export interface StampIssueMembership {
  issueId: string;
  issueName: string | null;
  issueYear: number | null;
  requiredForCompleteness: boolean;
}

export interface StampListItem {
  id: string;
  collectionId: string;
  parentId: string | null;
  subtypeId: string | null;
  actsAsVariantOverride: boolean | null;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  createdAt: string;
  catalogNumbers: StampCatalogNumberData[];
  areaId: string | null;
  issues: StampIssueMembership[];
  mainCatalogPrice: MoneyDisplay | null;
  /** True when the displayed main price is on a non-latest edition of its catalog name. */
  mainCatalogPriceStale: boolean;
}

export interface PaginatedStampsResult {
  items: StampListItem[];
  nextCursor: string | null;
}

const STAMP_LIST_SELECT = {
  id: true,
  collectionId: true,
  parentId: true,
  subtypeId: true,
  actsAsVariantOverride: true,
  name: true,
  issuedDay: true,
  issuedMonth: true,
  issuedYear: true,
  createdAt: true,
  catalogNumbers: { select: { catalogVendorId: true, number: true } },
  catalogPrices: {
    select: {
      price: true,
      currency: true,
      conditionId: true,
      certificateStatusId: true,
      catalogEdition: { select: { year: true, catalogNameId: true } },
    },
  },
  stampAreaLinks: {
    select: { collectionAreaId: true, isPrimary: true },
  },
  issueMemberships: {
    select: {
      issueId: true,
      requiredForCompleteness: true,
      issue: { select: { name: true, year: true } },
    },
  },
} as const;

function toStampListItem(
  stamp: {
    id: string;
    collectionId: string;
    parentId: string | null;
    subtypeId: string | null;
    actsAsVariantOverride: boolean | null;
    name: string | null;
    issuedDay: number | null;
    issuedMonth: number | null;
    issuedYear: number | null;
    createdAt: Date;
    catalogNumbers: { catalogVendorId: string; number: string }[];
    catalogPrices: RawCatalogPrice[];
    stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
    issueMemberships: {
      issueId: string;
      requiredForCompleteness: boolean;
      issue: { name: string | null; year: number | null };
    }[];
  },
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  latestYearByName: Map<string, number>,
  displayConditionId: string | null
): StampListItem {
  const primaryLink = stamp.stampAreaLinks.find((l) => l.isPrimary);
  const areaId = primaryLink?.collectionAreaId ?? stamp.stampAreaLinks[0]?.collectionAreaId ?? null;
  const primaryNameId = areaId ? (primaryCatalogByArea.get(areaId) ?? null) : null;
  const main = pickMainCatalogPrice(stamp.catalogPrices, primaryNameId, displayConditionId);
  const mainCatalogPriceStale = main
    ? (latestYearByName.get(main.catalogNameId) ?? main.editionYear) > main.editionYear
    : false;
  return {
    id: stamp.id,
    collectionId: stamp.collectionId,
    parentId: stamp.parentId,
    subtypeId: stamp.subtypeId,
    actsAsVariantOverride: stamp.actsAsVariantOverride,
    name: stamp.name,
    issuedDay: stamp.issuedDay,
    issuedMonth: stamp.issuedMonth,
    issuedYear: stamp.issuedYear,
    createdAt: stamp.createdAt.toISOString(),
    catalogNumbers: stamp.catalogNumbers,
    areaId,
    issues: stamp.issueMemberships.map((m) => ({
      issueId: m.issueId,
      issueName: m.issue.name,
      issueYear: m.issue.year,
      requiredForCompleteness: m.requiredForCompleteness,
    })),
    // convertedAmount filled by buildStampListItems after rates are fetched
    mainCatalogPrice: main
      ? { amount: main.amount.toFixed(2), currency: main.currency, convertedAmount: null, baseCurrency }
      : null,
    mainCatalogPriceStale,
  };
}

/** Map stamps to list items and attach base-currency conversions in one batched rate fetch. */
async function buildStampListItems(
  stamps: Parameters<typeof toStampListItem>[0][],
  collectionId: string,
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string,
  displayConditionId: string | null
): Promise<StampListItem[]> {
  const latestYearByName = await getLatestEditionYearByName(collectionId);
  const items = stamps.map((s) =>
    toStampListItem(s, primaryCatalogByArea, baseCurrency, latestYearByName, displayConditionId)
  );
  const currencies = items
    .map((i) => i.mainCatalogPrice?.currency)
    .filter((c): c is string => !!c);
  const rates = await safeRateMap(collectionId, baseCurrency, currencies);
  for (const it of items) {
    const mp = it.mainCatalogPrice;
    if (mp) {
      mp.convertedAmount = applyConversion(Number(mp.amount), mp.currency, baseCurrency, rates);
    }
  }
  return items;
}

export type StampSortBy = "issueDate" | "catalogNumber" | "name" | "issueName";

export interface StampListFilterOpts {
  areaIds?: string[];
  offset?: number;
  pageSize?: number;
  search?: string;
  catalogVendorId?: string;
  catalogNumber?: string;
  issueId?: string;
  sortBy?: StampSortBy;
  sortDir?: "asc" | "desc";
  /** Condition whose price fills the list price column. When omitted, defaults
   *  to the collection's first condition by sortOrder. */
  displayConditionId?: string | null;
}

function parseNumericCatalog(val: string | null | undefined): number {
  if (!val) return Number.MAX_SAFE_INTEGER;
  const n = parseInt(val, 10);
  return Number.isNaN(n) ? Number.MAX_SAFE_INTEGER : n;
}

export async function listStampsPaginated(
  ownerId: string,
  collectionId: string,
  opts: StampListFilterOpts
): Promise<PaginatedStampsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = opts.pageSize ?? 50;
  const offset = opts.offset ?? 0;
  const dir = opts.sortDir ?? "asc";
  const [primaryCatalogByArea, baseCurrency, displayConditionId] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
    resolveDisplayConditionId(collectionId, opts.displayConditionId),
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const conditions: any[] = [];

  if (opts.areaIds && opts.areaIds.length > 0) {
    conditions.push({ stampAreaLinks: { some: { collectionAreaId: { in: opts.areaIds } } } });
  }

  if (opts.issueId) {
    conditions.push({ issueMemberships: { some: { issueId: opts.issueId } } });
  }

  if (opts.search) {
    const s = opts.search;
    conditions.push({
      OR: [
        { name: { contains: s, mode: "insensitive" } },
        { issueMemberships: { some: { issue: { name: { contains: s, mode: "insensitive" } } } } },
        { catalogNumbers: { some: { number: { contains: s, mode: "insensitive" } } } },
      ],
    });
  }

  if (opts.catalogVendorId && opts.catalogNumber) {
    conditions.push({
      catalogNumbers: { some: { catalogVendorId: opts.catalogVendorId, number: opts.catalogNumber } },
    });
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const where: any = {
    collectionId,
    ...(conditions.length === 1 ? conditions[0] : conditions.length > 1 ? { AND: conditions } : {}),
  };

  if (opts.sortBy === "catalogNumber" || opts.sortBy === "issueName") {
    const selectForSort =
      opts.sortBy === "catalogNumber"
        ? { id: true, catalogNumbers: { select: { number: true } } }
        : { id: true, issueMemberships: { select: { issue: { select: { name: true } } }, take: 1 } };

    const allIds = await prisma.stamp.findMany({
      where,
      select: selectForSort as { id: true },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    allIds.sort((a: any, b: any) => {
      let cmp: number;
      if (opts.sortBy === "catalogNumber") {
        const aNum = parseNumericCatalog(a.catalogNumbers?.[0]?.number);
        const bNum = parseNumericCatalog(b.catalogNumbers?.[0]?.number);
        cmp = aNum - bNum;
      } else {
        const aName: string = a.issueMemberships?.[0]?.issue?.name ?? "";
        const bName: string = b.issueMemberships?.[0]?.issue?.name ?? "";
        cmp = aName.localeCompare(bName);
      }
      return dir === "desc" ? -cmp : cmp;
    });

    const pageIds = allIds.slice(offset, offset + pageSize + 1).map((r) => r.id);
    const hasMore = pageIds.length > pageSize;
    const finalIds = hasMore ? pageIds.slice(0, pageSize) : pageIds;

    const stamps = await prisma.stamp.findMany({
      where: { id: { in: finalIds } },
      select: STAMP_LIST_SELECT,
    });
    const idOrder = new Map(finalIds.map((id, i) => [id, i]));
    stamps.sort((a, b) => (idOrder.get(a.id) ?? 0) - (idOrder.get(b.id) ?? 0));

    const items = await buildStampListItems(stamps, collectionId, primaryCatalogByArea, baseCurrency, displayConditionId);
    const nextCursor = hasMore ? String(offset + pageSize) : null;
    return { items, nextCursor };
  }

  const orderBy =
    opts.sortBy === "name"
      ? [{ name: dir }, { id: "asc" as const }]
      : opts.sortBy === "issueDate"
        ? [{ issuedYear: dir }, { issuedMonth: dir }, { issuedDay: dir }, { id: "asc" as const }]
        : [{ createdAt: dir }];

  const stamps = await prisma.stamp.findMany({
    where,
    orderBy,
    select: STAMP_LIST_SELECT,
    take: pageSize + 1,
    skip: offset,
  });

  const hasMore = stamps.length > pageSize;
  const items = await buildStampListItems(
    hasMore ? stamps.slice(0, pageSize) : stamps,
    collectionId,
    primaryCatalogByArea,
    baseCurrency,
    displayConditionId
  );
  const nextCursor = hasMore ? String(offset + pageSize) : null;

  return { items, nextCursor };
}

// ── Stamp picker search (inventory item dialog, #104) ──────────────────────

/** One suggestion row for the inventory stamp/variant picker, carrying enough
 * identity to disambiguate a stamp: catalog labels, name, year, area, and the
 * issue it belongs to. A base stamp with variants is selectable as the
 * "unknown variant" (ADR-0007 §2); `isVariant` marks an identified variant. */
export interface StampSearchItem {
  stampId: string;
  parentId: string | null;
  isVariant: boolean;
  /** True for a base stamp that has variants — selecting it means the specific
   * variant is unknown (ADR-0007 §2). */
  hasVariants: boolean;
  name: string | null;
  issuedYear: number | null;
  areaId: string | null;
  areaName: string | null;
  issueId: string | null;
  issueName: string | null;
  issueYear: number | null;
  /** Formatted catalog labels, e.g. ["Mi·PL 200"]. */
  catalogNumbers: string[];
}

interface AreaPrefixNode {
  parentId: string | null;
  name: string;
  /** Per-vendor prefix rows set directly on this area (value may be null). */
  vendorPrefix: Map<string, string | null>;
}

/** Resolve the effective per-vendor area prefix, inheriting from the nearest
 * ancestor area that sets one (mirrors `effectiveVendorsForArea` on the client). */
function resolveEffectivePrefix(
  areaId: string,
  vendorId: string,
  nodes: Map<string, AreaPrefixNode>
): string | null {
  let current: string | null = areaId;
  let depth = 0;
  while (current && depth < 50) {
    const node: AreaPrefixNode | undefined = nodes.get(current);
    if (!node) break;
    if (node.vendorPrefix.has(vendorId)) return node.vendorPrefix.get(vendorId) ?? null;
    current = node.parentId;
    depth++;
  }
  return null;
}

const PICKER_LIMIT = 20;

/**
 * Search a collection's stamps for the inventory picker autocomplete (#104).
 *
 * The database query is a broad *recall* net — name / issue-name substring plus a
 * catalog-number-digits `contains` — and the JS pass is *precision*: a candidate
 * survives only if the query matches its name/issue text or, via
 * {@link catalogKeyMatches}, its normalized catalog keys (vendor abbreviation +
 * effective area prefix + number). That normalization is what lets `Mi PL200`,
 * `MiPL200`, and `200` all resolve to the same stamp. Returns ≤20 rows, catalog
 * matches first, then by newest issue year.
 */
export async function searchStampsForPicker(
  ownerId: string,
  collectionId: string,
  query: string
): Promise<StampSearchItem[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const text = query.trim();
  if (!text) return [];
  const digits = catalogDigits(text);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const or: any[] = [
    { name: { contains: text, mode: "insensitive" } },
    { issueMemberships: { some: { issue: { name: { contains: text, mode: "insensitive" } } } } },
  ];
  if (digits) {
    or.push({ catalogNumbers: { some: { number: { contains: digits } } } });
  }

  const [candidates, vendors, areaRows] = await Promise.all([
    prisma.stamp.findMany({
      where: { collectionId, OR: or },
      select: {
        id: true,
        parentId: true,
        name: true,
        issuedYear: true,
        catalogNumbers: { select: { catalogVendorId: true, number: true } },
        stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
        issueMemberships: {
          select: { issueId: true, issue: { select: { name: true, year: true } } },
          take: 1,
        },
        variants: { select: VARIANT_FLAG_SELECT },
      },
      // Cap recall generously; precision + ranking narrow to PICKER_LIMIT below.
      take: 200,
    }),
    prisma.catalogVendor.findMany({
      where: { collectionId },
      select: { id: true, abbreviation: true },
    }),
    prisma.collectionArea.findMany({
      where: { collectionId },
      select: {
        id: true,
        name: true,
        parentId: true,
        collectionAreaVendors: { select: { catalogVendorId: true, areaPrefix: true } },
      },
    }),
  ]);

  const vendorAbbr = new Map(vendors.map((v) => [v.id, v.abbreviation]));
  const areaNames = new Map(areaRows.map((a) => [a.id, a.name]));
  const areaNodes = new Map<string, AreaPrefixNode>(
    areaRows.map((a) => [
      a.id,
      {
        parentId: a.parentId,
        name: a.name,
        vendorPrefix: new Map(
          a.collectionAreaVendors.map((v) => [v.catalogVendorId, v.areaPrefix])
        ),
      },
    ])
  );

  interface Scored {
    item: StampSearchItem;
    exactCatalog: boolean;
  }
  const scored: Scored[] = [];

  for (const s of candidates) {
    const primaryLink = s.stampAreaLinks.find((l) => l.isPrimary) ?? s.stampAreaLinks[0];
    const areaId = primaryLink?.collectionAreaId ?? null;

    const labels: string[] = [];
    const keys: string[] = [];
    for (const cn of s.catalogNumbers) {
      const abbr = vendorAbbr.get(cn.catalogVendorId) ?? "";
      const prefix = areaId ? resolveEffectivePrefix(areaId, cn.catalogVendorId, areaNodes) : null;
      labels.push(formatCatalogNumber(abbr, prefix, cn.number));
      keys.push(catalogMatchKey(abbr, prefix, cn.number));
    }

    const membership = s.issueMemberships[0];
    const lower = text.toLowerCase();
    const nameHit = !!s.name && s.name.toLowerCase().includes(lower);
    const issueName = membership?.issue.name ?? null;
    const issueHit = !!issueName && issueName.toLowerCase().includes(lower);
    const catalogHit = catalogKeyMatches(text, keys);

    if (!nameHit && !issueHit && !catalogHit) continue;

    scored.push({
      // Catalog-number matches are the most specific intent, so rank them first.
      exactCatalog: catalogHit,
      item: {
        stampId: s.id,
        parentId: s.parentId,
        isVariant: s.parentId !== null,
        hasVariants: s.variants.some(childIsVariant),
        name: s.name,
        issuedYear: s.issuedYear,
        areaId,
        areaName: areaId ? (areaNames.get(areaId) ?? null) : null,
        issueId: membership?.issueId ?? null,
        issueName,
        issueYear: membership?.issue.year ?? null,
        catalogNumbers: labels,
      },
    });
  }

  scored.sort((a, b) => {
    if (a.exactCatalog !== b.exactCatalog) return a.exactCatalog ? -1 : 1;
    return (b.item.issueYear ?? 0) - (a.item.issueYear ?? 0);
  });

  return scored.slice(0, PICKER_LIMIT).map((x) => x.item);
}

// ── Mutations ──────────────────────────────────────────────────────────────

export interface CatalogPriceInput {
  catalogEditionId: string;
  conditionId: string;
  certificateStatusId: string | null;
  price: string;
  currency: string;
}

export async function updateStampWithCatalog(
  ownerId: string,
  stampId: string,
  data: {
    name?: string | null;
    issuedDay?: number | null;
    issuedMonth?: number | null;
    issuedYear?: number | null;
    catalogNumbers: { catalogVendorId: string; number: string }[];
    catalogPrices?: CatalogPriceInput[];
    requiredForCompleteness?: boolean;
    // Child-only subtype classification (ADR-0010). `undefined` leaves the current
    // value untouched; for a child, `subtypeId: null` falls back to the collection
    // default. Top-level stamps are always forced back to null on both fields.
    subtypeId?: string | null;
    actsAsVariantOverride?: boolean | null;
  }
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction(async (tx) => {
    const managesSubtype =
      data.subtypeId !== undefined || data.actsAsVariantOverride !== undefined;
    const subtypeData: { subtypeId?: string | null; actsAsVariantOverride?: boolean | null } = {};
    if (managesSubtype) {
      const current = await tx.stamp.findUniqueOrThrow({
        where: { id: stampId },
        select: { parentId: true },
      });
      if (current.parentId === null) {
        // Top-level stamps are never classified.
        subtypeData.subtypeId = null;
        subtypeData.actsAsVariantOverride = null;
      } else {
        if (data.subtypeId !== undefined) {
          let sid = data.subtypeId;
          if (sid) {
            const sub = await tx.stampSubtype.findFirst({
              where: { id: sid, collectionId },
              select: { id: true },
            });
            if (!sub) throw new Error("Subtype not found in this collection.");
          } else {
            const def = await tx.stampSubtype.findFirst({
              where: { collectionId, isDefault: true },
              select: { id: true },
            });
            sid = def?.id ?? null;
          }
          subtypeData.subtypeId = sid;
        }
        if (data.actsAsVariantOverride !== undefined) {
          subtypeData.actsAsVariantOverride = data.actsAsVariantOverride;
        }
      }
    }
    await tx.stamp.update({
      where: { id: stampId },
      data: {
        name: data.name ?? null,
        issuedDay: data.issuedDay ?? null,
        issuedMonth: data.issuedMonth ?? null,
        issuedYear: data.issuedYear ?? null,
        ...subtypeData,
      },
    });
    if (data.requiredForCompleteness !== undefined) {
      await tx.issueMember.updateMany({
        where: { stampId },
        data: { requiredForCompleteness: data.requiredForCompleteness },
      });
    }
    await tx.stampCatalogNumber.deleteMany({ where: { stampId } });
    if (data.catalogNumbers.length > 0) {
      await tx.stampCatalogNumber.createMany({
        data: data.catalogNumbers.map((cn) => ({
          stampId,
          catalogVendorId: cn.catalogVendorId,
          number: cn.number,
        })),
        skipDuplicates: true,
      });
    }
    if (data.catalogPrices !== undefined) {
      await tx.stampCatalogPrice.deleteMany({ where: { stampId } });
      if (data.catalogPrices.length > 0) {
        await tx.stampCatalogPrice.createMany({
          data: data.catalogPrices.map((cp) => ({
            stampId,
            catalogEditionId: cp.catalogEditionId,
            conditionId: cp.conditionId,
            certificateStatusId: cp.certificateStatusId,
            price: cp.price,
            currency: cp.currency,
          })),
          skipDuplicates: true,
        });
      }
    }
  });
}

/** Resolve where a quick single-price edit lands: the latest edition of the stamp's
 * effective **primary** catalog (ADR-0006), plus that catalog's currency. Throws a
 * user-facing message when the stamp has no area, no primary catalog, or the catalog has
 * no editions yet. */
async function resolvePrimaryCatalogTarget(
  collectionId: string,
  stampId: string
): Promise<{ catalogLabel: string; currency: string; editionId: string; editionYear: number }> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } } },
  });
  const link = stamp?.stampAreaLinks.find((l) => l.isPrimary) ?? stamp?.stampAreaLinks[0];
  const areaId = link?.collectionAreaId ?? null;
  if (!areaId) {
    throw new Error("This stamp isn't linked to an area, so it has no primary catalog.");
  }
  const primaryByArea = await buildEffectivePrimaryCatalogMap(collectionId);
  const catalogNameId = primaryByArea.get(areaId) ?? null;
  if (!catalogNameId) {
    throw new Error("No primary catalog is configured for this stamp's area.");
  }
  const cat = await prisma.catalogName.findUnique({
    where: { id: catalogNameId },
    select: {
      name: true,
      currency: true,
      catalogEditions: { select: { id: true, year: true }, orderBy: { year: "desc" }, take: 1 },
    },
  });
  const edition = cat?.catalogEditions[0];
  if (!cat || !edition) {
    throw new Error(
      `The primary catalog (${cat?.name ?? "?"}) has no editions yet. Add one on the Catalog screen.`
    );
  }
  return {
    catalogLabel: cat.name,
    currency: cat.currency,
    editionId: edition.id,
    editionYear: edition.year,
  };
}

/** Context for the quick catalog-price editor: which catalog/edition/currency the value
 * will land in, and the amount already recorded there for this condition × certificate (if
 * any) so the field can prefill. */
export interface QuickCatalogPriceContext {
  catalogLabel: string;
  currency: string;
  editionYear: number;
  amount: string | null;
}

export async function getQuickCatalogPriceContext(
  ownerId: string,
  stampId: string,
  conditionId: string,
  certificateStatusId: string | null
): Promise<QuickCatalogPriceContext> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const target = await resolvePrimaryCatalogTarget(collectionId, stampId);
  const existing = await prisma.stampCatalogPrice.findFirst({
    where: {
      stampId,
      catalogEditionId: target.editionId,
      conditionId,
      certificateStatusId: certificateStatusId ?? null,
    },
    select: { price: true },
  });
  return {
    catalogLabel: target.catalogLabel,
    currency: target.currency,
    editionYear: target.editionYear,
    amount: existing ? existing.price.toFixed(2) : null,
  };
}

/** Quickly set (or overwrite) a single catalog value: the given amount for this stamp at
 * `conditionId × certificateStatusId` on the latest edition of its **primary** catalog
 * (ADR-0006), in that catalog's currency. Used by the lot intake screen to price a copy
 * inline without opening the full stamp editor (#121). */
export async function quickSetCatalogPrice(
  ownerId: string,
  stampId: string,
  conditionId: string,
  certificateStatusId: string | null,
  amount: number
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  if (!Number.isFinite(amount) || amount < 0) {
    throw new Error("Enter a valid non-negative amount.");
  }
  const cond = await prisma.stampCondition.findFirst({
    where: { id: conditionId, collectionId },
    select: { id: true },
  });
  if (!cond) throw new Error("Condition not found in this collection.");
  if (certificateStatusId) {
    const cert = await prisma.certificateStatus.findFirst({
      where: { id: certificateStatusId, collectionId },
      select: { id: true },
    });
    if (!cert) throw new Error("Certificate status not found in this collection.");
  }
  const target = await resolvePrimaryCatalogTarget(collectionId, stampId);
  const priceStr = amount.toFixed(2);
  // The (stamp, edition, condition, cert) uniqueness uses NULLS NOT DISTINCT, which Prisma
  // can't target in `upsert`; find-then-write instead.
  const existing = await prisma.stampCatalogPrice.findFirst({
    where: {
      stampId,
      catalogEditionId: target.editionId,
      conditionId,
      certificateStatusId: certificateStatusId ?? null,
    },
    select: { id: true },
  });
  if (existing) {
    await prisma.stampCatalogPrice.update({
      where: { id: existing.id },
      data: { price: priceStr, currency: target.currency },
    });
  } else {
    await prisma.stampCatalogPrice.create({
      data: {
        stampId,
        catalogEditionId: target.editionId,
        conditionId,
        certificateStatusId: certificateStatusId ?? null,
        price: priceStr,
        currency: target.currency,
      },
    });
  }
}

export async function upsertStampCatalogNumber(
  ownerId: string,
  stampId: string,
  catalogVendorId: string,
  number: string
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampCatalogNumber.upsert({
    where: { stampId_catalogVendorId: { stampId, catalogVendorId } },
    create: { stampId, catalogVendorId, number },
    update: { number },
  });
}

export async function deleteStampCatalogNumber(
  ownerId: string,
  stampId: string,
  catalogVendorId: string
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampCatalogNumber.delete({
    where: { stampId_catalogVendorId: { stampId, catalogVendorId } },
  });
}

export interface StampCatalogPriceData {
  catalogEditionId: string;
  price: Decimal;
  currency: string;
}

export interface StampCatalogPriceDisplay {
  catalogEditionId: string;
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  price: string;
  currency: string;
  /** Price converted to the collection base currency, or null when same currency / no rate. */
  convertedAmount: string | null;
  baseCurrency: string;
  editionYear: number;
  catalogNameId: string;
  catalogName: string;
  vendorAbbreviation: string;
  catalogNameCurrency: string;
}

export async function getStampCatalogPrices(
  ownerId: string,
  stampId: string
): Promise<StampCatalogPriceDisplay[]> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const prices = await prisma.stampCatalogPrice.findMany({
    where: { stampId },
    select: {
      catalogEditionId: true,
      conditionId: true,
      certificateStatusId: true,
      price: true,
      currency: true,
      condition: { select: { name: true, abbreviation: true } },
      certificateStatus: { select: { name: true, abbreviation: true } },
      catalogEdition: {
        select: {
          year: true,
          catalogNameId: true,
          catalogName: {
            select: {
              name: true,
              currency: true,
              vendor: { select: { abbreviation: true } },
            },
          },
        },
      },
    },
    orderBy: { catalogEdition: { year: "desc" } },
  });

  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const rates = await safeRateMap(
    collectionId,
    baseCurrency,
    prices.map((p) => p.currency)
  );

  return prices.map((p) => ({
    catalogEditionId: p.catalogEditionId,
    conditionId: p.conditionId,
    conditionName: p.condition.name,
    conditionAbbreviation: p.condition.abbreviation,
    certificateStatusId: p.certificateStatusId,
    certificateStatusName: p.certificateStatus?.name ?? null,
    certificateStatusAbbreviation: p.certificateStatus?.abbreviation ?? null,
    price: Number(p.price).toFixed(2),
    currency: p.currency,
    convertedAmount: applyConversion(Number(p.price), p.currency, baseCurrency, rates),
    baseCurrency,
    editionYear: p.catalogEdition.year,
    catalogNameId: p.catalogEdition.catalogNameId,
    catalogName: p.catalogEdition.catalogName.name,
    vendorAbbreviation: p.catalogEdition.catalogName.vendor.abbreviation,
    catalogNameCurrency: p.catalogEdition.catalogName.currency,
  }));
}

/** Axes shared by every price/average cell so the dialog can lay them out as a matrix. */
interface StampCellAxes {
  conditionId: string;
  conditionName: string;
  conditionAbbreviation: string;
  conditionSortOrder: number;
  certificateStatusId: string | null;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  /** Certificate sort order; -1 for "None" so it always leads. */
  certificateSortOrder: number;
}

/** One averaged price across catalogs, for a (condition × certificate) intersection. */
export interface StampAverageCell extends StampCellAxes {
  /** Mean of the per-catalog prices in the collection base currency, 2 decimals; null when none convertible. */
  averageBase: string | null;
  baseCurrency: string;
  /** Catalogs that contributed to the average. */
  catalogCount: number;
  /** Catalogs that priced this intersection but whose currency could not be converted (excluded). */
  excludedNoRateCount: number;
}

/** One recorded price at a (condition × certificate) intersection of a single edition. */
export interface StampPriceCell extends StampCellAxes {
  price: string;
  currency: string;
  convertedAmount: string | null;
  baseCurrency: string;
}

/** One catalog edition — the collapsible unit in the dialog's catalog breakdown. */
export interface StampEditionGroup {
  catalogEditionId: string;
  editionYear: number;
  /** True for the newest edition (by year) of its catalog that has any price. */
  isNewest: boolean;
  catalogNameId: string;
  catalogName: string;
  vendorAbbreviation: string;
  catalogNameCurrency: string;
  cells: StampPriceCell[];
}

export interface StampPriceDetails {
  baseCurrency: string;
  /** Averages across catalogs, always in the collection base currency. */
  averageCells: StampAverageCell[];
  /** One entry per catalog edition, ordered by catalog name then newest year first. */
  editions: StampEditionGroup[];
}

/**
 * A stamp's recorded prices, shaped for the price-details dialog: the cross-catalog
 * average per (condition × certificate) plus the full per-edition breakdown. Averages
 * take, per catalog, the newest edition that prices a given combination, convert it to
 * the collection base currency, and mean those values; they are independent of the
 * dialog's latest/all toggle. Cells carry condition/certificate sort orders so the
 * dialog can render them as a conditions-as-rows × certificates-as-columns matrix.
 * See price-details dialog.
 */
export async function getStampPriceDetails(
  ownerId: string,
  stampId: string
): Promise<StampPriceDetails> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  const prices = await prisma.stampCatalogPrice.findMany({
    where: { stampId },
    select: {
      catalogEditionId: true,
      conditionId: true,
      certificateStatusId: true,
      price: true,
      currency: true,
      condition: { select: { name: true, abbreviation: true, sortOrder: true } },
      certificateStatus: { select: { name: true, abbreviation: true, sortOrder: true } },
      catalogEdition: {
        select: {
          year: true,
          catalogNameId: true,
          catalogName: {
            select: {
              name: true,
              currency: true,
              vendor: { select: { abbreviation: true } },
            },
          },
        },
      },
    },
    orderBy: { catalogEdition: { year: "desc" } },
  });

  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const rates = await safeRateMap(
    collectionId,
    baseCurrency,
    prices.map((p) => p.currency)
  );

  const axesOf = (p: (typeof prices)[number]): StampCellAxes => ({
    conditionId: p.conditionId,
    conditionName: p.condition.name,
    conditionAbbreviation: p.condition.abbreviation,
    conditionSortOrder: p.condition.sortOrder,
    certificateStatusId: p.certificateStatusId,
    certificateStatusName: p.certificateStatus?.name ?? null,
    certificateStatusAbbreviation: p.certificateStatus?.abbreviation ?? null,
    certificateSortOrder: p.certificateStatus?.sortOrder ?? -1,
  });

  // ── Averages: per catalog, the newest edition pricing each (condition × cert). ──
  const bestPerCatalogCombo = new Map<string, (typeof prices)[number]>();
  for (const p of prices) {
    const key = `${p.catalogEdition.catalogNameId}~${p.conditionId}~${p.certificateStatusId ?? ""}`;
    const cur = bestPerCatalogCombo.get(key);
    if (!cur || p.catalogEdition.year > cur.catalogEdition.year) bestPerCatalogCombo.set(key, p);
  }
  const comboGroups = new Map<
    string,
    { sample: (typeof prices)[number]; values: number[]; excluded: number }
  >();
  for (const p of bestPerCatalogCombo.values()) {
    const key = `${p.conditionId}~${p.certificateStatusId ?? ""}`;
    let g = comboGroups.get(key);
    if (!g) {
      g = { sample: p, values: [], excluded: 0 };
      comboGroups.set(key, g);
    }
    const bv = baseValueOf(Number(p.price), p.currency, baseCurrency, rates);
    if (bv == null) g.excluded += 1;
    else g.values.push(bv);
  }
  const averageCells: StampAverageCell[] = [...comboGroups.values()].map((g) => {
    const avg = averageOf(g.values);
    return {
      ...axesOf(g.sample),
      averageBase: avg == null ? null : avg.toFixed(2),
      baseCurrency,
      catalogCount: g.values.length,
      excludedNoRateCount: g.excluded,
    };
  });

  // ── Per-edition breakdown (each edition is a collapsible section). ──
  const edMap = new Map<string, StampEditionGroup>();
  for (const p of prices) {
    let ed = edMap.get(p.catalogEditionId);
    if (!ed) {
      ed = {
        catalogEditionId: p.catalogEditionId,
        editionYear: p.catalogEdition.year,
        isNewest: false,
        catalogNameId: p.catalogEdition.catalogNameId,
        catalogName: p.catalogEdition.catalogName.name,
        vendorAbbreviation: p.catalogEdition.catalogName.vendor.abbreviation,
        catalogNameCurrency: p.catalogEdition.catalogName.currency,
        cells: [],
      };
      edMap.set(p.catalogEditionId, ed);
    }
    ed.cells.push({
      ...axesOf(p),
      price: Number(p.price).toFixed(2),
      currency: p.currency,
      convertedAmount: applyConversion(Number(p.price), p.currency, baseCurrency, rates),
      baseCurrency,
    });
  }
  const newestByCatalog = new Map<string, number>();
  for (const ed of edMap.values()) {
    const cur = newestByCatalog.get(ed.catalogNameId);
    if (cur === undefined || ed.editionYear > cur) newestByCatalog.set(ed.catalogNameId, ed.editionYear);
  }
  const editions = [...edMap.values()]
    .map((ed) => ({ ...ed, isNewest: ed.editionYear === newestByCatalog.get(ed.catalogNameId) }))
    .sort((a, b) => a.catalogName.localeCompare(b.catalogName) || b.editionYear - a.editionYear);

  return { baseCurrency, averageCells, editions };
}

export interface StaleCatalogPrice {
  stampId: string;
  catalogEditionId: string;
  price: Decimal;
  currency: string;
  editionYear: number;
  catalogNameId: string;
  latestEditionId: string;
  latestEditionYear: number;
}

export async function findStaleCatalogPrices(
  ownerId: string,
  collectionId: string
): Promise<StaleCatalogPrice[]> {
  await assertCollectionOwner(ownerId, collectionId);

  const prices = await prisma.stampCatalogPrice.findMany({
    where: { stamp: { collectionId } },
    select: {
      stampId: true,
      catalogEditionId: true,
      price: true,
      currency: true,
      catalogEdition: {
        select: {
          year: true,
          catalogNameId: true,
          catalogName: {
            select: {
              catalogEditions: {
                select: { id: true, year: true },
                orderBy: { year: "desc" },
                take: 1,
              },
            },
          },
        },
      },
    },
  });

  const stale: StaleCatalogPrice[] = [];
  for (const p of prices) {
    const latest = p.catalogEdition.catalogName.catalogEditions[0];
    if (latest && latest.year > p.catalogEdition.year) {
      stale.push({
        stampId: p.stampId,
        catalogEditionId: p.catalogEditionId,
        price: p.price,
        currency: p.currency,
        editionYear: p.catalogEdition.year,
        catalogNameId: p.catalogEdition.catalogNameId,
        latestEditionId: latest.id,
        latestEditionYear: latest.year,
      });
    }
  }
  return stale;
}
