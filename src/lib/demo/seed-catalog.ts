import "server-only";
import { PrismaClient } from "@/generated/prisma/client";

export async function seedCatalog(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  const michel = await tx.catalogVendor.create({
    data: { collectionId, name: "Michel", abbreviation: "Mi" },
  });
  await tx.catalogName.create({
    data: { vendorId: michel.id, name: "Michel Deutschland", currency: "EUR" },
  });

  const scott = await tx.catalogVendor.create({
    data: { collectionId, name: "Scott", abbreviation: "Sc" },
  });
  await tx.catalogName.create({
    data: { vendorId: scott.id, name: "Scott US", currency: "USD" },
  });
}
