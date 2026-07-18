import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";
import {
  type MoneyDisplay,
  type RawCatalogPrice,
  buildEffectivePrimaryCatalogMap,
  pickMainCatalogPrice,
  safeRateMap,
  applyConversion,
  getCollectionBaseCurrency,
} from "./pricing";

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
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  createdAt: string;
  catalogNumbers: StampCatalogNumberData[];
  areaId: string | null;
  issues: StampIssueMembership[];
  mainCatalogPrice: MoneyDisplay | null;
}

export interface PaginatedStampsResult {
  items: StampListItem[];
  nextCursor: string | null;
}

const STAMP_LIST_SELECT = {
  id: true,
  collectionId: true,
  parentId: true,
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
  baseCurrency: string
): StampListItem {
  const primaryLink = stamp.stampAreaLinks.find((l) => l.isPrimary);
  const areaId = primaryLink?.collectionAreaId ?? stamp.stampAreaLinks[0]?.collectionAreaId ?? null;
  const primaryNameId = areaId ? (primaryCatalogByArea.get(areaId) ?? null) : null;
  const main = pickMainCatalogPrice(stamp.catalogPrices, primaryNameId);
  return {
    id: stamp.id,
    collectionId: stamp.collectionId,
    parentId: stamp.parentId,
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
  };
}

/** Map stamps to list items and attach base-currency conversions in one batched rate fetch. */
async function buildStampListItems(
  stamps: Parameters<typeof toStampListItem>[0][],
  collectionId: string,
  primaryCatalogByArea: Map<string, string | null>,
  baseCurrency: string
): Promise<StampListItem[]> {
  const items = stamps.map((s) => toStampListItem(s, primaryCatalogByArea, baseCurrency));
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
  const [primaryCatalogByArea, baseCurrency] = await Promise.all([
    buildEffectivePrimaryCatalogMap(collectionId),
    getCollectionBaseCurrency(collectionId),
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

    const items = await buildStampListItems(stamps, collectionId, primaryCatalogByArea, baseCurrency);
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
    baseCurrency
  );
  const nextCursor = hasMore ? String(offset + pageSize) : null;

  return { items, nextCursor };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export interface CatalogPriceInput {
  catalogEditionId: string;
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
  }
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction(async (tx) => {
    await tx.stamp.update({
      where: { id: stampId },
      data: {
        name: data.name ?? null,
        issuedDay: data.issuedDay ?? null,
        issuedMonth: data.issuedMonth ?? null,
        issuedYear: data.issuedYear ?? null,
      },
    });
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
            price: cp.price,
            currency: cp.currency,
          })),
          skipDuplicates: true,
        });
      }
    }
  });
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
  price: string;
  currency: string;
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
      price: true,
      currency: true,
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
  return prices.map((p) => ({
    catalogEditionId: p.catalogEditionId,
    price: p.price.toString(),
    currency: p.currency,
    editionYear: p.catalogEdition.year,
    catalogNameId: p.catalogEdition.catalogNameId,
    catalogName: p.catalogEdition.catalogName.name,
    vendorAbbreviation: p.catalogEdition.catalogName.vendor.abbreviation,
    catalogNameCurrency: p.catalogEdition.catalogName.currency,
  }));
}

export async function upsertStampCatalogPrice(
  ownerId: string,
  stampId: string,
  catalogEditionId: string,
  price: string,
  currency: string
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampCatalogPrice.upsert({
    where: { stampId_catalogEditionId: { stampId, catalogEditionId } },
    create: { stampId, catalogEditionId, price, currency },
    update: { price, currency },
  });
}

export async function deleteStampCatalogPrice(
  ownerId: string,
  stampId: string,
  catalogEditionId: string
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampCatalogPrice.delete({
    where: { stampId_catalogEditionId: { stampId, catalogEditionId } },
  });
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
