import "server-only";
import type { Decimal } from "@prisma/client/runtime/client";
import { prisma } from "./db";

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

async function deleteStampTree(stampId: string): Promise<void> {
  const children = await prisma.stamp.findMany({
    where: { parentId: stampId },
    select: { id: true },
  });
  for (const child of children) {
    await deleteStampTree(child.id);
  }
  await prisma.stamp.delete({ where: { id: stampId } });
}

export async function deleteStamp(
  ownerId: string,
  stampId: string
): Promise<void> {
  const collectionId = await resolveStampCollection(stampId);
  await assertCollectionOwner(ownerId, collectionId);
  await deleteStampTree(stampId);
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

function toStampListItem(stamp: {
  id: string;
  collectionId: string;
  parentId: string | null;
  name: string | null;
  issuedDay: number | null;
  issuedMonth: number | null;
  issuedYear: number | null;
  createdAt: Date;
  catalogNumbers: { catalogVendorId: string; number: string }[];
  stampAreaLinks: { collectionAreaId: string; isPrimary: boolean }[];
  issueMemberships: {
    issueId: string;
    requiredForCompleteness: boolean;
    issue: { name: string | null; year: number | null };
  }[];
}): StampListItem {
  const primaryLink = stamp.stampAreaLinks.find((l) => l.isPrimary);
  const areaId = primaryLink?.collectionAreaId ?? stamp.stampAreaLinks[0]?.collectionAreaId ?? null;
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
  };
}

export async function listStampsPaginated(
  ownerId: string,
  collectionId: string,
  opts: {
    areaIds?: string[];
    cursor?: string;
    pageSize?: number;
  }
): Promise<PaginatedStampsResult> {
  await assertCollectionOwner(ownerId, collectionId);
  const pageSize = opts.pageSize ?? 50;
  const stamps = await prisma.stamp.findMany({
    where: {
      collectionId,
      ...(opts.areaIds && opts.areaIds.length > 0
        ? { stampAreaLinks: { some: { collectionAreaId: { in: opts.areaIds } } } }
        : {}),
    },
    orderBy: [{ createdAt: "asc" }],
    select: STAMP_LIST_SELECT,
    take: pageSize + 1,
    ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
  });

  const hasMore = stamps.length > pageSize;
  const items = (hasMore ? stamps.slice(0, pageSize) : stamps).map(toStampListItem);
  const nextCursor = hasMore ? items[items.length - 1].id : null;

  return { items, nextCursor };
}

// ── Mutations ──────────────────────────────────────────────────────────────

export async function updateStampWithCatalog(
  ownerId: string,
  stampId: string,
  data: {
    name?: string | null;
    issuedDay?: number | null;
    issuedMonth?: number | null;
    issuedYear?: number | null;
    catalogNumbers: { catalogVendorId: string; number: string }[];
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
