import "server-only";
import { PrismaClient } from "@/generated/prisma/client";

export async function seedAreas(
  collectionId: string,
  tx: PrismaClient
): Promise<void> {
  const europe = await tx.collectionArea.create({
    data: { collectionId, name: "Europe" },
  });
  await tx.collectionArea.createMany({
    data: [
      { collectionId, name: "Germany", parentId: europe.id },
      { collectionId, name: "France", parentId: europe.id },
    ],
  });
}
