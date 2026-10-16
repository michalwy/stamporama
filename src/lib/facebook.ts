import "server-only";
import { prisma } from "./db";
import { getModulePlatform } from "./module-platform";
import { FACEBOOK_PLATFORM_MODULE } from "./platform-modules";

// The Facebook platform (#1543; ADR-0061; #1955) — what the groups hang off. Since #1955 it is the
// collection's one Facebook module platform, switched on or off on Settings → Facebook. It switches
// no Assistant handoff on — a group post is a kit posted by hand (#1544) — and asks none of Colnect's
// preconditions.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The Facebook platform while it is switched on, or null. */
export async function getFacebookPlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, FACEBOOK_PLATFORM_MODULE);
}
