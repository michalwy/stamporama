import "server-only";
import { PrismaClient } from "@/generated/prisma/client";
import { seedCatalog } from "./seed-catalog";
import { seedAreas } from "./seed-areas";
import { seedStamps } from "./seed-stamps";
import { seedInventory } from "./seed-inventory";
import { seedLocations } from "./seed-locations";
import { seedAttributes } from "./seed-attributes";

export async function seedDemoData(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  const catalog = await seedCatalog(collectionId, tx);
  const areas = await seedAreas(collectionId, tx, catalog);
  // The attribute dictionaries (#72) come before the stamps that reference them.
  const attributes = await seedAttributes(collectionId, tx);
  await seedStamps(collectionId, tx, catalog, areas, attributes);
  await seedInventory(collectionId, tx);
  // Locations run last: they assign the seeded copies to physical storage (#56).
  await seedLocations(collectionId, tx);
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
  // Locations after items: `item.locationId` is ON DELETE RESTRICT, so the copies must
  // be gone first (#56). Children reference parents with SET NULL, so a single
  // deleteMany over the collection is safe.
  await tx.location.deleteMany({ where: { collectionId } });
  await tx.contact.deleteMany({ where: { collectionId } });
  await tx.certificateStatus.deleteMany({ where: { collectionId } });
  await tx.exchangeRate.deleteMany({ where: { collectionId } });

  await tx.stamp.deleteMany({
    where: { collectionId, parentId: { not: null } },
  });
  await tx.stamp.deleteMany({ where: { collectionId } });

  await tx.issue.deleteMany({ where: { collectionId } });

  // The attribute dictionaries after the stamps that reference them (#72): every reference is
  // ON DELETE RESTRICT, so this order is the only one that works.
  await tx.stampColor.deleteMany({ where: { collectionId } });
  await tx.stampWatermark.deleteMany({ where: { collectionId } });
  await tx.stampPaper.deleteMany({ where: { collectionId } });
  await tx.stampPrinting.deleteMany({ where: { collectionId } });

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
