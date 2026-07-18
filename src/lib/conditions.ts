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

async function resolveConditionCollection(conditionId: string): Promise<string> {
  const condition = await prisma.stampCondition.findUnique({
    where: { id: conditionId },
    select: { collectionId: true },
  });
  if (!condition) throw new Error("Stamp condition not found.");
  return condition.collectionId;
}

export interface StampConditionData {
  id: string;
  name: string;
  abbreviation: string;
  sortOrder: number;
}

/**
 * Default conditions seeded into every new collection, in display order.
 * See #93. Users can add, edit, reorder, and delete these afterwards.
 */
export const DEFAULT_CONDITIONS: ReadonlyArray<{
  name: string;
  abbreviation: string;
}> = [
  { name: "Mint Never Hinged", abbreviation: "MNH" },
  { name: "Mint Hinged", abbreviation: "MH" },
  { name: "Mint No Gum", abbreviation: "MNG" },
  { name: "Used", abbreviation: "U" },
  { name: "Cancelled to Order", abbreviation: "CTO" },
  { name: "First Day Cover", abbreviation: "FDC" },
];

/**
 * Seeds the default condition set for a freshly created collection. Runs inside
 * the collection-creation transaction, so it receives the transactional client.
 */
export async function seedDefaultConditions(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  await tx.stampCondition.createMany({
    data: DEFAULT_CONDITIONS.map((c, i) => ({
      collectionId,
      name: c.name,
      abbreviation: c.abbreviation,
      sortOrder: i,
    })),
  });
}

export async function getStampConditions(
  ownerId: string,
  collectionId: string
): Promise<StampConditionData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return prisma.stampCondition.findMany({
    where: { collectionId },
    orderBy: { sortOrder: "asc" },
    select: { id: true, name: true, abbreviation: true, sortOrder: true },
  });
}

export async function createStampCondition(
  ownerId: string,
  collectionId: string,
  data: { name: string; abbreviation: string }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const last = await prisma.stampCondition.findFirst({
    where: { collectionId },
    orderBy: { sortOrder: "desc" },
    select: { sortOrder: true },
  });
  const sortOrder = last ? last.sortOrder + 1 : 0;
  await prisma.stampCondition.create({
    data: { collectionId, name: data.name, abbreviation: data.abbreviation, sortOrder },
  });
}

export async function updateStampCondition(
  ownerId: string,
  conditionId: string,
  data: { name: string; abbreviation: string }
): Promise<void> {
  const collectionId = await resolveConditionCollection(conditionId);
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.stampCondition.update({
    where: { id: conditionId },
    data: { name: data.name, abbreviation: data.abbreviation },
  });
}

/**
 * Whether a condition is referenced by catalog prices and therefore cannot be
 * deleted. The catalog-price ↔ condition relation is introduced by #91; until
 * then no price references a condition, so this always reports "not in use".
 * Once #91 lands, count `stampCatalogPrice` rows referencing the condition here.
 */
export async function isConditionInUse(conditionId: string): Promise<boolean> {
  void conditionId;
  return false;
}

export async function deleteStampCondition(
  ownerId: string,
  conditionId: string
): Promise<void> {
  const collectionId = await resolveConditionCollection(conditionId);
  await assertCollectionOwner(ownerId, collectionId);
  if (await isConditionInUse(conditionId)) {
    throw new ConditionInUseError();
  }
  await prisma.stampCondition.delete({ where: { id: conditionId } });
}

export class ConditionInUseError extends Error {
  constructor() {
    super("Condition is in use by catalog prices.");
    this.name = "ConditionInUseError";
  }
}

/**
 * Persists a new display order. `orderedIds` must contain exactly the collection's
 * condition ids. Rewrites `sortOrder` to match array position.
 */
export async function reorderStampConditions(
  ownerId: string,
  collectionId: string,
  orderedIds: string[]
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const existing = await prisma.stampCondition.findMany({
    where: { collectionId },
    select: { id: true },
  });
  const existingIds = new Set(existing.map((c) => c.id));
  if (
    orderedIds.length !== existingIds.size ||
    !orderedIds.every((id) => existingIds.has(id))
  ) {
    throw new Error("Reorder list does not match the collection's conditions.");
  }
  await prisma.$transaction(
    orderedIds.map((id, i) =>
      prisma.stampCondition.update({ where: { id }, data: { sortOrder: i } })
    )
  );
}
