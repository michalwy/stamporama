import "server-only";
import { prisma } from "./db";

// Per-collection Colnect catalog-abbreviation → local `CatalogVendor` mapping (#248, part of
// #155). Colnect catalog pages print numbers under Colnect's own abbreviations (Mi, Sn, Yt, Sg,
// AFA, Pol…); matching them to our stamps needs a translation to our local vendors, because some
// abbreviations differ — notably Colnect `Pol` is Fischer, which we abbreviate `Fi`. Only the
// mismatches need an explicit row; see {@link resolveColnectAbbreviation} for the fallback.

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

async function resolveMappingCollection(mappingId: string): Promise<string> {
  const mapping = await prisma.colnectCatalogMapping.findUnique({
    where: { id: mappingId },
    select: { collectionId: true },
  });
  if (!mapping) throw new Error("Colnect mapping not found.");
  return mapping.collectionId;
}

/** Raised when a mapping would reuse a Colnect abbreviation already mapped in the collection
 *  (case-insensitive). The action layer turns it into a user-facing message. */
export class ColnectAbbrevTakenError extends Error {
  constructor(abbrev: string) {
    super(`Colnect abbreviation "${abbrev}" is already mapped.`);
    this.name = "ColnectAbbrevTakenError";
  }
}

export interface ColnectMappingData {
  id: string;
  colnectAbbrev: string;
  catalogVendorId: string;
  vendorName: string;
  vendorAbbreviation: string;
}

/** The explicit mapping rows for a collection, each joined with its local vendor, ordered by the
 *  Colnect abbreviation. Implicit exact-abbreviation matches (see {@link resolveColnectAbbreviation})
 *  are not rows and are not listed here. */
export async function getColnectMappings(
  ownerId: string,
  collectionId: string
): Promise<ColnectMappingData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.colnectCatalogMapping.findMany({
    where: { collectionId },
    orderBy: { colnectAbbrev: "asc" },
    select: {
      id: true,
      colnectAbbrev: true,
      catalogVendorId: true,
      catalogVendor: { select: { name: true, abbreviation: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id,
    colnectAbbrev: r.colnectAbbrev,
    catalogVendorId: r.catalogVendorId,
    vendorName: r.catalogVendor.name,
    vendorAbbreviation: r.catalogVendor.abbreviation,
  }));
}

/** Assert the vendor exists and belongs to `collectionId` (guards against mapping to a vendor
 *  from another collection). */
async function assertVendorInCollection(
  collectionId: string,
  catalogVendorId: string
): Promise<void> {
  const vendor = await prisma.catalogVendor.findFirst({
    where: { id: catalogVendorId, collectionId },
    select: { id: true },
  });
  if (!vendor) throw new Error("Catalog vendor not found in this collection.");
}

/** Reject a Colnect abbreviation that already has a mapping row in the collection, compared
 *  case-insensitively so "Pol" and "pol" can't both exist. `exceptId` skips the row being edited. */
async function assertAbbrevFree(
  collectionId: string,
  colnectAbbrev: string,
  exceptId?: string
): Promise<void> {
  const existing = await prisma.colnectCatalogMapping.findFirst({
    where: {
      collectionId,
      colnectAbbrev: { equals: colnectAbbrev, mode: "insensitive" },
      ...(exceptId ? { id: { not: exceptId } } : {}),
    },
    select: { id: true },
  });
  if (existing) throw new ColnectAbbrevTakenError(colnectAbbrev);
}

export async function createColnectMapping(
  ownerId: string,
  collectionId: string,
  data: { colnectAbbrev: string; catalogVendorId: string }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await assertVendorInCollection(collectionId, data.catalogVendorId);
  await assertAbbrevFree(collectionId, data.colnectAbbrev);
  await prisma.colnectCatalogMapping.create({
    data: {
      collectionId,
      colnectAbbrev: data.colnectAbbrev,
      catalogVendorId: data.catalogVendorId,
    },
  });
}

export async function updateColnectMapping(
  ownerId: string,
  mappingId: string,
  data: { colnectAbbrev: string; catalogVendorId: string }
): Promise<void> {
  const collectionId = await resolveMappingCollection(mappingId);
  await assertCollectionOwner(ownerId, collectionId);
  await assertVendorInCollection(collectionId, data.catalogVendorId);
  await assertAbbrevFree(collectionId, data.colnectAbbrev, mappingId);
  await prisma.colnectCatalogMapping.update({
    where: { id: mappingId },
    data: { colnectAbbrev: data.colnectAbbrev, catalogVendorId: data.catalogVendorId },
  });
}

export async function deleteColnectMapping(
  ownerId: string,
  mappingId: string
): Promise<void> {
  const collectionId = await resolveMappingCollection(mappingId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.colnectCatalogMapping.delete({ where: { id: mappingId } });
}

/** Resolution of a Colnect abbreviation to a local vendor, plus where it came from:
 *  `explicit` = a mapping row, `exact` = fell back to a local vendor with the same abbreviation. */
export interface ColnectResolution {
  catalogVendorId: string;
  source: "explicit" | "exact";
}

/**
 * Resolve a single Colnect catalog abbreviation to a local `CatalogVendor` for `collectionId`:
 *   1. an explicit mapping row (case-insensitive on the Colnect abbreviation) wins;
 *   2. else a local vendor whose own `abbreviation` equals it (case-insensitive);
 *   3. else `null` — unmapped, ignored by the matcher (not an error).
 * Owner-authorized. This is the read primitive the number-matcher (#155) builds on.
 */
export async function resolveColnectAbbreviation(
  ownerId: string,
  collectionId: string,
  colnectAbbrev: string
): Promise<ColnectResolution | null> {
  await assertCollectionOwner(ownerId, collectionId);
  const abbrev = colnectAbbrev.trim();
  if (!abbrev) return null;

  const explicit = await prisma.colnectCatalogMapping.findFirst({
    where: { collectionId, colnectAbbrev: { equals: abbrev, mode: "insensitive" } },
    select: { catalogVendorId: true },
  });
  if (explicit) return { catalogVendorId: explicit.catalogVendorId, source: "explicit" };

  const exact = await prisma.catalogVendor.findFirst({
    where: { collectionId, abbreviation: { equals: abbrev, mode: "insensitive" } },
    select: { id: true },
  });
  if (exact) return { catalogVendorId: exact.id, source: "exact" };

  return null;
}
