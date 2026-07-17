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

async function resolveVendorCollection(vendorId: string): Promise<string> {
  const vendor = await prisma.catalogVendor.findUnique({
    where: { id: vendorId },
    select: { collectionId: true },
  });
  if (!vendor) throw new Error("Catalog vendor not found.");
  return vendor.collectionId;
}

async function resolveNameCollection(nameId: string): Promise<string> {
  const name = await prisma.catalogName.findUnique({
    where: { id: nameId },
    select: { vendor: { select: { collectionId: true } } },
  });
  if (!name) throw new Error("Catalog name not found.");
  return name.vendor.collectionId;
}

async function resolveEditionCollection(editionId: string): Promise<string> {
  const edition = await prisma.catalogEdition.findUnique({
    where: { id: editionId },
    select: {
      catalogName: { select: { vendor: { select: { collectionId: true } } } },
    },
  });
  if (!edition) throw new Error("Catalog edition not found.");
  return edition.catalogName.vendor.collectionId;
}

export interface CatalogNameFlat {
  id: string;
  name: string;
  abbreviation: string | null;
  vendorName: string;
  vendorAbbreviation: string;
}

export interface CatalogEditionData {
  id: string;
  year: number;
}

export interface CatalogNameData {
  id: string;
  name: string;
  currency: string;
  abbreviation: string | null;
  catalogEditions: CatalogEditionData[];
}

export interface CatalogVendorData {
  id: string;
  name: string;
  abbreviation: string;
  catalogNames: CatalogNameData[];
}

export async function getCatalogNames(
  ownerId: string,
  collectionId: string
): Promise<CatalogNameFlat[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const names = await prisma.catalogName.findMany({
    where: { vendor: { collectionId } },
    orderBy: [{ vendor: { name: "asc" } }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      abbreviation: true,
      vendor: { select: { name: true, abbreviation: true } },
    },
  });
  return names.map((n) => ({
    id: n.id,
    name: n.name,
    abbreviation: n.abbreviation,
    vendorName: n.vendor.name,
    vendorAbbreviation: n.vendor.abbreviation,
  }));
}

export async function getCatalogTree(
  ownerId: string,
  collectionId: string
): Promise<CatalogVendorData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.catalogVendor.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      abbreviation: true,
      catalogNames: {
        orderBy: { name: "asc" },
        select: {
          id: true,
          name: true,
          currency: true,
          abbreviation: true,
          catalogEditions: {
            orderBy: { year: "asc" },
            select: { id: true, year: true },
          },
        },
      },
    },
  });
}

export async function createCatalogVendor(
  ownerId: string,
  collectionId: string,
  data: { name: string; abbreviation: string }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogVendor.create({ data: { collectionId, ...data } });
}

export async function updateCatalogVendor(
  ownerId: string,
  vendorId: string,
  data: { name: string; abbreviation: string }
): Promise<void> {
  const collectionId = await resolveVendorCollection(vendorId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogVendor.update({ where: { id: vendorId }, data });
}

export async function deleteCatalogVendor(
  ownerId: string,
  vendorId: string
): Promise<void> {
  const collectionId = await resolveVendorCollection(vendorId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogVendor.delete({ where: { id: vendorId } });
}

export async function createCatalogName(
  ownerId: string,
  vendorId: string,
  data: { name: string; currency: string; abbreviation?: string }
): Promise<void> {
  const collectionId = await resolveVendorCollection(vendorId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogName.create({
    data: { vendorId, name: data.name, currency: data.currency, abbreviation: data.abbreviation || null },
  });
}

export async function updateCatalogName(
  ownerId: string,
  nameId: string,
  data: { name: string; currency: string; abbreviation?: string }
): Promise<void> {
  const collectionId = await resolveNameCollection(nameId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogName.update({
    where: { id: nameId },
    data: { name: data.name, currency: data.currency, abbreviation: data.abbreviation || null },
  });
}

export async function deleteCatalogName(
  ownerId: string,
  nameId: string
): Promise<void> {
  const collectionId = await resolveNameCollection(nameId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogName.delete({ where: { id: nameId } });
}

export async function createCatalogEdition(
  ownerId: string,
  catalogNameId: string,
  data: { year: number }
): Promise<void> {
  const collectionId = await resolveNameCollection(catalogNameId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogEdition.create({ data: { catalogNameId, year: data.year } });
}

export async function updateCatalogEdition(
  ownerId: string,
  editionId: string,
  data: { year: number }
): Promise<void> {
  const collectionId = await resolveEditionCollection(editionId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogEdition.update({ where: { id: editionId }, data });
}

export async function deleteCatalogEdition(
  ownerId: string,
  editionId: string
): Promise<void> {
  const collectionId = await resolveEditionCollection(editionId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.catalogEdition.delete({ where: { id: editionId } });
}
