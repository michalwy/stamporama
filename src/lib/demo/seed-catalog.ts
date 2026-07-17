import "server-only";
import { PrismaClient } from "@/generated/prisma/client";

export interface DemoCatalog {
  fischerVendorId: string;
  michelVendorId: string;
  fischerNameId: string;
  michelOsteuropaNameId: string;
  michelDeutschlandNameId: string;
  fischerEditionId: string;
  michelOsteuropaEditionId: string;
  michelDeutschlandEditionId: string;
}

export async function seedCatalog(
  collectionId: string,
  tx: PrismaClient
): Promise<DemoCatalog> {
  const fischer = await tx.catalogVendor.create({
    data: { collectionId, name: "Fischer", abbreviation: "Fi" },
  });
  const fischerName = await tx.catalogName.create({
    data: { vendorId: fischer.id, name: "Fischer", currency: "PLN" },
  });
  const fischerEdition = await tx.catalogEdition.create({
    data: { catalogNameId: fischerName.id, year: 2023 },
  });

  const michel = await tx.catalogVendor.create({
    data: { collectionId, name: "Michel", abbreviation: "Mi" },
  });
  const michelOsteuropa = await tx.catalogName.create({
    data: { vendorId: michel.id, name: "Michel Osteuropa", currency: "EUR" },
  });
  const michelOsteuropaEdition = await tx.catalogEdition.create({
    data: { catalogNameId: michelOsteuropa.id, year: 2023 },
  });
  const michelDeutschland = await tx.catalogName.create({
    data: { vendorId: michel.id, name: "Michel Deutschland", currency: "EUR" },
  });
  const michelDeutschlandEdition = await tx.catalogEdition.create({
    data: { catalogNameId: michelDeutschland.id, year: 2023 },
  });

  return {
    fischerVendorId: fischer.id,
    michelVendorId: michel.id,
    fischerNameId: fischerName.id,
    michelOsteuropaNameId: michelOsteuropa.id,
    michelDeutschlandNameId: michelDeutschland.id,
    fischerEditionId: fischerEdition.id,
    michelOsteuropaEditionId: michelOsteuropaEdition.id,
    michelDeutschlandEditionId: michelDeutschlandEdition.id,
  };
}
