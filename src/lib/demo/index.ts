import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { seedCatalog } from "./seed-catalog";
import { seedAreas } from "./seed-areas";
import { seedStamps } from "./seed-stamps";
import { seedInventory } from "./seed-inventory";

export async function seedDemoData(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  const catalog = await seedCatalog(collectionId, tx);
  const areas = await seedAreas(collectionId, tx, catalog);
  await seedStamps(collectionId, tx, catalog, areas);
  await seedInventory(collectionId, tx);
}

export async function wipeDemoData(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  // Inventory first: variant history and items cascade from stamp deletion, but
  // deleting them explicitly keeps the intent clear. Contacts and certificate
  // statuses are not reachable from stamps, so they must be removed here.
  await tx.itemVariantHistory.deleteMany({
    where: { item: { collectionId } },
  });
  await tx.item.deleteMany({ where: { collectionId } });
  await tx.contact.deleteMany({ where: { collectionId } });
  await tx.certificateStatus.deleteMany({ where: { collectionId } });
  await tx.exchangeRate.deleteMany({ where: { collectionId } });

  await tx.stamp.deleteMany({
    where: { collectionId, parentId: { not: null } },
  });
  await tx.stamp.deleteMany({ where: { collectionId } });

  await tx.issue.deleteMany({ where: { collectionId } });

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
