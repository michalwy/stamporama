import "server-only";
import { prisma } from "./db";

/**
 * The areas the Overview breaks the collection down by (#1330), chosen by the collector on the
 * Overview itself and saved for the collection. No rows is the default — the top-level areas — so a
 * collection that never opens the control sees no change. How a choice is resolved against the tree
 * (tree order, a chosen area since deleted, the areas left outside) is `resolveAreaBreakdown` in
 * `overview-rules.ts`; Value over time and Progress both go through it, so the two never break down
 * by different areas.
 */

async function assertOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** The chosen area ids, unordered — no ownership check; the Overview reads assert it first. */
export async function readOverviewAreaIds(collectionId: string): Promise<string[]> {
  const rows = await prisma.collectionOverviewArea.findMany({
    where: { collectionId },
    select: { collectionAreaId: true },
  });
  return rows.map((row) => row.collectionAreaId);
}

export async function getOverviewAreaIds(ownerId: string, collectionId: string): Promise<string[]> {
  await assertOwner(ownerId, collectionId);
  return readOverviewAreaIds(collectionId);
}

export class OverviewAreaError extends Error {}

/**
 * Replace the choice whole. An empty list returns the Overview to top-level areas. Every id must be
 * an area of this collection — a foreign or unknown id refuses the save rather than being dropped,
 * since the collector would otherwise see a choice other than the one they made.
 */
export async function saveOverviewAreaIds(
  ownerId: string,
  collectionId: string,
  areaIds: string[]
): Promise<string[]> {
  await assertOwner(ownerId, collectionId);
  const unique = [...new Set(areaIds)];
  if (unique.length > 0) {
    const found = await prisma.collectionArea.count({
      where: { collectionId, id: { in: unique } },
    });
    if (found !== unique.length) {
      throw new OverviewAreaError("An area was not found in this collection.");
    }
  }
  await prisma.$transaction([
    prisma.collectionOverviewArea.deleteMany({ where: { collectionId } }),
    prisma.collectionOverviewArea.createMany({
      data: unique.map((collectionAreaId) => ({ collectionId, collectionAreaId })),
    }),
  ]);
  return unique;
}
