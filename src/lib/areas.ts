import "server-only";
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

async function resolveAreaCollection(areaId: string): Promise<string> {
  const area = await prisma.collectionArea.findUnique({
    where: { id: areaId },
    select: { collectionId: true },
  });
  if (!area) throw new Error("Collection area not found.");
  return area.collectionId;
}

async function assertEffectivePrimaryCatalog(
  primaryCatalogNameId: string | null | undefined,
  parentId: string | null | undefined
): Promise<void> {
  if (primaryCatalogNameId) return;
  let currentId = parentId ?? null;
  let depth = 0;
  while (currentId && depth < 50) {
    const ancestor = await prisma.collectionArea.findUnique({
      where: { id: currentId },
      select: { primaryCatalogNameId: true, parentId: true },
    });
    if (!ancestor) break;
    if (ancestor.primaryCatalogNameId) return;
    currentId = ancestor.parentId;
    depth++;
  }
  throw new Error(
    "A primary catalog is required. Set one on this area or on a parent area."
  );
}

export interface AreaCatalogEntry {
  catalogNameId: string;
  catalogVendorId: string;
  vendorName: string;
  catalogName: string;
  vendorAbbreviation: string;
  prefix: string | null;
}

export interface CollectionAreaData {
  id: string;
  name: string;
  parentId: string | null;
  description: string | null;
  primaryCatalogNameId: string | null;
  stampCount: number;
  childCount: number;
  catalogEntries: AreaCatalogEntry[];
}

export async function getCollectionAreas(
  ownerId: string,
  collectionId: string
): Promise<CollectionAreaData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const areas = await prisma.collectionArea.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      parentId: true,
      description: true,
      primaryCatalogNameId: true,
      _count: { select: { stampAreaLinks: true, children: true } },
      collectionAreaCatalogs: {
        orderBy: [
          { catalogName: { vendor: { name: "asc" } } },
          { catalogName: { name: "asc" } },
        ],
        select: {
          catalogNameId: true,
          catalogName: {
            select: {
              name: true,
              vendorId: true,
              vendor: { select: { name: true, abbreviation: true } },
            },
          },
        },
      },
      collectionAreaVendors: {
        select: { catalogVendorId: true, areaPrefix: true },
      },
    },
  });
  return areas.map((a) => ({
    id: a.id,
    name: a.name,
    parentId: a.parentId,
    description: a.description,
    primaryCatalogNameId: a.primaryCatalogNameId,
    stampCount: a._count.stampAreaLinks,
    childCount: a._count.children,
    catalogEntries: (() => {
      const vendorPrefixMap = new Map(
        a.collectionAreaVendors.map((v) => [v.catalogVendorId, v.areaPrefix])
      );
      return a.collectionAreaCatalogs.map((c) => ({
        catalogNameId: c.catalogNameId,
        catalogVendorId: c.catalogName.vendorId,
        vendorName: c.catalogName.vendor.name,
        catalogName: c.catalogName.name,
        vendorAbbreviation: c.catalogName.vendor.abbreviation,
        prefix: vendorPrefixMap.get(c.catalogName.vendorId) ?? null,
      }));
    })(),
  }));
}

export async function createCollectionArea(
  ownerId: string,
  collectionId: string,
  data: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    primaryCatalogNameId?: string | null;
  }
): Promise<{ id: string }> {
  await assertCollectionOwner(ownerId, collectionId);
  if (data.parentId) {
    const parent = await prisma.collectionArea.findUnique({
      where: { id: data.parentId },
      select: { collectionId: true },
    });
    if (!parent || parent.collectionId !== collectionId) {
      throw new Error("Parent area not found.");
    }
  }
  await assertEffectivePrimaryCatalog(
    data.primaryCatalogNameId,
    data.parentId
  );
  const created = await prisma.collectionArea.create({
    data: {
      collectionId,
      name: data.name,
      parentId: data.parentId ?? null,
      description: data.description ?? null,
      primaryCatalogNameId: data.primaryCatalogNameId ?? null,
    },
    select: { id: true },
  });
  return { id: created.id };
}

export async function updateCollectionArea(
  ownerId: string,
  areaId: string,
  data: {
    name: string;
    parentId?: string | null;
    description?: string | null;
    primaryCatalogNameId?: string | null;
  }
): Promise<void> {
  const collectionId = await resolveAreaCollection(areaId);
  await assertCollectionOwner(ownerId, collectionId);

  if (data.parentId) {
    const parent = await prisma.collectionArea.findUnique({
      where: { id: data.parentId },
      select: { collectionId: true },
    });
    if (!parent || parent.collectionId !== collectionId) {
      throw new Error("Parent area not found.");
    }
    let currentId: string | null = data.parentId;
    let depth = 0;
    while (currentId !== null && depth < 50) {
      if (currentId === areaId) {
        throw new Error("Cannot set an area as its own ancestor.");
      }
      const current: { parentId: string | null } | null =
        await prisma.collectionArea.findUnique({
          where: { id: currentId },
          select: { parentId: true },
        });
      currentId = current?.parentId ?? null;
      depth++;
    }
  }

  await assertEffectivePrimaryCatalog(
    data.primaryCatalogNameId,
    data.parentId
  );
  await prisma.collectionArea.update({
    where: { id: areaId },
    data: {
      name: data.name,
      parentId: data.parentId ?? null,
      description: data.description ?? null,
      primaryCatalogNameId: data.primaryCatalogNameId ?? null,
    },
  });
}

export async function deleteCollectionArea(
  ownerId: string,
  areaId: string
): Promise<void> {
  const collectionId = await resolveAreaCollection(areaId);
  await assertCollectionOwner(ownerId, collectionId);

  const counts = await prisma.collectionArea.findUniqueOrThrow({
    where: { id: areaId },
    select: { _count: { select: { children: true, stampAreaLinks: true } } },
  });

  if (counts._count.children > 0) {
    throw new Error(
      "Cannot delete an area that has child areas. Move or delete them first."
    );
  }
  if (counts._count.stampAreaLinks > 0) {
    throw new Error(
      "Cannot delete an area that has assigned stamps. Unassign them first."
    );
  }

  await prisma.collectionArea.delete({ where: { id: areaId } });
}

export async function syncAreaCatalogEntries(
  ownerId: string,
  areaId: string,
  entries: { catalogNameId: string; prefix: string | null }[]
): Promise<void> {
  const collectionId = await resolveAreaCollection(areaId);
  await assertCollectionOwner(ownerId, collectionId);

  const vendorPrefixes: Map<string, string | null> = new Map();

  if (entries.length > 0) {
    const ids = entries.map((e) => e.catalogNameId);
    const valid = await prisma.catalogName.findMany({
      where: { id: { in: ids }, vendor: { collectionId } },
      select: { id: true, vendorId: true },
    });
    const validIds = new Set(valid.map((v) => v.id));
    const invalid = ids.find((id) => !validIds.has(id));
    if (invalid) {
      throw new Error("Catalog name not found in this collection.");
    }

    // Derive vendor-level prefixes: non-null prefix wins; last entry for a vendor wins otherwise
    const vendorIdMap = new Map(valid.map((v) => [v.id, v.vendorId]));
    for (const e of entries) {
      const vendorId = vendorIdMap.get(e.catalogNameId)!;
      if (!vendorPrefixes.has(vendorId) || e.prefix !== null) {
        vendorPrefixes.set(vendorId, e.prefix);
      }
    }
  }

  await prisma.$transaction([
    prisma.collectionAreaCatalog.deleteMany({ where: { collectionAreaId: areaId } }),
    prisma.collectionAreaVendor.deleteMany({ where: { collectionAreaId: areaId } }),
    prisma.collectionAreaCatalog.createMany({
      data: entries.map((e) => ({
        collectionAreaId: areaId,
        catalogNameId: e.catalogNameId,
      })),
    }),
    prisma.collectionAreaVendor.createMany({
      data: Array.from(vendorPrefixes.entries()).map(([catalogVendorId, areaPrefix]) => ({
        collectionAreaId: areaId,
        catalogVendorId,
        areaPrefix,
      })),
    }),
  ]);
}
