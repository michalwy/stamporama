import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { seedCatalog } from "./seed-catalog";
import { seedAreas } from "./seed-areas";
import type { SeederContribution } from "./registry";

const contributions: SeederContribution[] = [seedCatalog, seedAreas];

export async function seedDemoData(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  for (const contribute of contributions) {
    await contribute(collectionId, tx);
  }
}

export async function wipeDemoData(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  const areaIds = await tx.collectionArea
    .findMany({ where: { collectionId }, select: { id: true } })
    .then((rows) => rows.map((r) => r.id));

  await tx.stampCollectionArea.deleteMany({
    where: { collectionAreaId: { in: areaIds } },
  });
  await tx.collectionArea.deleteMany({
    where: { collectionId, parentId: { not: null } },
  });
  await tx.collectionArea.deleteMany({ where: { collectionId } });

  const vendorIds = await tx.catalogVendor
    .findMany({ where: { collectionId }, select: { id: true } })
    .then((rows) => rows.map((r) => r.id));

  const nameIds = await tx.catalogName
    .findMany({ where: { vendorId: { in: vendorIds } }, select: { id: true } })
    .then((rows) => rows.map((r) => r.id));

  await tx.catalogEdition.deleteMany({
    where: { catalogNameId: { in: nameIds } },
  });
  await tx.catalogName.deleteMany({ where: { vendorId: { in: vendorIds } } });
  await tx.catalogVendor.deleteMany({ where: { collectionId } });
}
