import "server-only";
import { prisma } from "./db";
import type { PrismaClient } from "@/generated/prisma/client";

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

async function resolveSubtypeCollection(subtypeId: string): Promise<string> {
  const subtype = await prisma.stampSubtype.findUnique({
    where: { id: subtypeId },
    select: { collectionId: true },
  });
  if (!subtype) throw new Error("Stamp subtype not found.");
  return subtype.collectionId;
}

export interface StampSubtypeData {
  id: string;
  name: string;
  actsAsVariant: boolean;
  isDefault: boolean;
  sortOrder: number;
}

/**
 * Default stamp subtypes seeded into every new collection, in display order.
 * See ADR-0010 (#127). Users can add, rename, reorder, and delete these afterwards.
 *
 * `actsAsVariant` is the behavioural switch: a child stamp of an `actsAsVariant`
 * subtype makes its parent an unknown-variant umbrella (lowest-child valuation,
 * any-variant completeness); a non-variant subtype leaves the parent untouched.
 * Exactly one row is `isDefault` — the type assigned to newly created children and
 * the backfill target for existing children.
 *
 * This list is REPLICATED BY HAND in the migration SQL
 * (prisma/migrations/20260719100000_add_stamp_subtype/migration.sql); the two must
 * be kept in sync.
 */
export const DEFAULT_STAMP_SUBTYPES: ReadonlyArray<{
  name: string;
  actsAsVariant: boolean;
  isDefault: boolean;
}> = [
  { name: "Variant", actsAsVariant: true, isDefault: true },
  { name: "Colour variety", actsAsVariant: true, isDefault: false },
  { name: "Perforation variety", actsAsVariant: true, isDefault: false },
  { name: "Paper variety", actsAsVariant: true, isDefault: false },
  { name: "Watermark variety", actsAsVariant: true, isDefault: false },
  { name: "Print variety", actsAsVariant: true, isDefault: false },
  { name: "Error", actsAsVariant: false, isDefault: false },
  { name: "Plate flaw", actsAsVariant: false, isDefault: false },
  { name: "Overprint", actsAsVariant: false, isDefault: false },
];

/**
 * Seeds the default subtype set for a freshly created collection. Runs inside the
 * collection-creation transaction, so it receives the transactional client. Mirrors
 * `seedDefaultConditions`.
 */
export async function seedDefaultSubtypes(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  await tx.stampSubtype.createMany({
    data: DEFAULT_STAMP_SUBTYPES.map((s, i) => ({
      collectionId,
      name: s.name,
      actsAsVariant: s.actsAsVariant,
      isDefault: s.isDefault,
      sortOrder: i,
    })),
  });
}

/** The collection's default subtype id, or null if none is set. */
export async function getDefaultSubtypeId(
  collectionId: string
): Promise<string | null> {
  const def = await prisma.stampSubtype.findFirst({
    where: { collectionId, isDefault: true },
    select: { id: true },
  });
  return def?.id ?? null;
}

export async function getStampSubtypes(
  ownerId: string,
  collectionId: string
): Promise<StampSubtypeData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stampSubtype.findMany({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      actsAsVariant: true,
      isDefault: true,
      sortOrder: true,
    },
  });
}

export async function createStampSubtype(
  ownerId: string,
  collectionId: string,
  data: { name: string; actsAsVariant: boolean }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const last = await prisma.stampSubtype.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  // New subtypes are never the default; the collection already has one. The
  // default is (re)assigned explicitly via setDefaultSubtype (radio semantics).
  await prisma.stampSubtype.create({
    data: {
      collectionId,
      name: data.name,
      actsAsVariant: data.actsAsVariant,
      isDefault: false,
      sortOrder,
    },
  });
}

/** Renames a subtype. */
export async function updateStampSubtype(
  ownerId: string,
  subtypeId: string,
  data: { name: string }
): Promise<void> {
  const collectionId = await resolveSubtypeCollection(subtypeId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampSubtype.update({
    where: { id: subtypeId },
    data: { name: data.name },
  });
}

/** Flips the behavioural `actsAsVariant` switch on a single subtype. */
export async function setSubtypeActsAsVariant(
  ownerId: string,
  subtypeId: string,
  actsAsVariant: boolean
): Promise<void> {
  const collectionId = await resolveSubtypeCollection(subtypeId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampSubtype.update({
    where: { id: subtypeId },
    data: { actsAsVariant },
  });
}

/**
 * Makes `subtypeId` the collection's default (radio semantics): clears the
 * previous default and sets the new one in one transaction. The two statements
 * never leave two defaults visible at once, so the partial unique index holds.
 */
export async function setDefaultSubtype(
  ownerId: string,
  subtypeId: string
): Promise<void> {
  const collectionId = await resolveSubtypeCollection(subtypeId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.$transaction(async (tx) => {
    await tx.stampSubtype.updateMany({
      where: { collectionId, isDefault: true },
      data: { isDefault: false },
    });
    await tx.stampSubtype.update({
      where: { id: subtypeId },
      data: { isDefault: true },
    });
  });
}

/**
 * Whether a subtype is referenced by any stamp and therefore cannot be deleted.
 * The database also enforces this via an onDelete: Restrict FK; this check
 * surfaces a friendly error before we hit that constraint.
 */
export async function isSubtypeInUse(subtypeId: string): Promise<boolean> {
  const count = await prisma.stamp.count({ where: { subtypeId } });
  return count > 0;
}

export async function deleteStampSubtype(
  ownerId: string,
  subtypeId: string
): Promise<void> {
  const collectionId = await resolveSubtypeCollection(subtypeId);
  await assertCollectionOwner(ownerId, collectionId);
  const subtype = await prisma.stampSubtype.findUnique({
    where: { id: subtypeId },
    select: { isDefault: true },
  });
  if (!subtype) throw new Error("Stamp subtype not found.");
  // The default must always exist; promote another subtype to default first.
  // (This also covers the last-remaining subtype, which is necessarily the default.)
  if (subtype.isDefault) throw new SubtypeIsDefaultError();
  if (await isSubtypeInUse(subtypeId)) throw new SubtypeInUseError();
  await prisma.stampSubtype.delete({ where: { id: subtypeId } });
}

export class SubtypeInUseError extends Error {
  constructor() {
    super("Subtype is in use by stamps.");
    this.name = "SubtypeInUseError";
  }
}

export class SubtypeIsDefaultError extends Error {
  constructor() {
    super("Subtype is the collection default.");
    this.name = "SubtypeIsDefaultError";
  }
}

/**
 * Persists a new display order. `orderedIds` must contain exactly the
 * collection's subtype ids. Rewrites `sortOrder` to match array position.
 */
export async function reorderStampSubtypes(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.stampSubtype.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((s) => s.id));
  if (
    orderedIds.length !== existingIds.size ||
    !orderedIds.every((id) => existingIds.has(id))
  ) {
    throw new Error("Reorder list does not match the collection's subtypes.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.stampSubtype.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}
