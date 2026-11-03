import "server-only";
import { prisma } from "./db";
import type { ValuationMethod } from "./piece-valuation";
import {
  methodReadsRole,
  methodRolesOf,
  type MethodRole,
  type ValuationMethodRoles,
} from "./valuation-method-roles";

// Where a piece's valuation method is set (#2359; ADR-0076): the collection's default, and an area's
// own, inherited downwards. A copy's own is written with the copy (`updateItem`, `setPieceValuation`).
// The rule that reads them is `resolveMethod` in `piece-valuation.ts`. And which condition plays each
// role of each method (#2375; ADR-0077), set on Settings → Valuation methods.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

export async function setCollectionValuationMethod(
  ownerId: string,
  collectionId: string,
  method: ValuationMethod
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await prisma.collection.update({ where: { id: collectionId }, data: { valuationMethod: method } });
}

/** An area's own method, or null to follow its parent. */
export async function setAreaValuationMethod(
  ownerId: string,
  areaId: string,
  method: ValuationMethod | null
): Promise<void> {
  const area = await prisma.collectionArea.findUnique({
    where: { id: areaId },
    select: { collectionId: true },
  });
  if (!area) throw new Error("Area not found.");
  await assertCollectionOwner(ownerId, area.collectionId);
  await prisma.collectionArea.update({ where: { id: areaId }, data: { valuationMethod: method } });
}

/** Which condition plays each role of each method (#2375) — a role absent is not set up. */
export async function getValuationMethodRoles(
  ownerId: string,
  collectionId: string
): Promise<ValuationMethodRoles> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.valuationMethodRole.findMany({
    where: { collectionId },
    select: { method: true, role: true, conditionId: true },
  });
  return methodRolesOf(rows);
}

/**
 * Map one role of a method to a condition, or unmap it with null (#2375). Any of the collection's
 * conditions may be mapped — a price column only (#2374) or not — and one condition may play roles in
 * several methods. A role the method does not read is refused.
 */
export async function setValuationMethodRole(
  ownerId: string,
  collectionId: string,
  input: { method: ValuationMethod; role: MethodRole; conditionId: string | null }
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  if (!methodReadsRole(input.method, input.role)) {
    throw new Error("That method does not read that price.");
  }
  const key = { collectionId, method: input.method, role: input.role };
  if (input.conditionId === null) {
    await prisma.valuationMethodRole.deleteMany({ where: key });
    return;
  }
  const condition = await prisma.stampCondition.findFirst({
    where: { id: input.conditionId, collectionId },
    select: { id: true },
  });
  if (!condition) throw new Error("Condition not found in this collection.");
  await prisma.valuationMethodRole.upsert({
    where: { collectionId_method_role: key },
    create: { ...key, conditionId: input.conditionId },
    update: { conditionId: input.conditionId },
  });
}
