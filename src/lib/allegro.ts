import "server-only";
import { prisma } from "./db";
import { getModulePlatform } from "./module-platform";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";

// The Allegro platform (#355; #1955) — what the Assistant's lot capture lands on. Since #1955 it is
// the collection's one Allegro module platform, switched on or off on Settings → Allegro, so a
// capture never asks which marketplace it is on.
//
// Deliberately a thin file: the module rule is `module-platform.ts`'s, and everything a capture then
// does is `auctions.ts`'s.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The Allegro platform while it is switched on, or null. */
export async function getAllegroPlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE);
}
