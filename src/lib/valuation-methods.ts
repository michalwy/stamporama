import "server-only";
import { prisma } from "./db";
import type { ValuationMethod } from "./piece-valuation";

// Where a piece's valuation method is set (#2359; ADR-0076): the collection's default, and an area's
// own, inherited downwards. A copy's own is written with the copy (`updateItem`, `setPieceValuation`).
// The rule that reads them is `resolveMethod` in `piece-valuation.ts`.

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
