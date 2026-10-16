import "server-only";
import { prisma } from "./db";
import { getModulePlatform } from "./module-platform";
import { PHILASEARCH_PLATFORM_MODULE } from "./platform-modules";

// The Philasearch platform (#742; #1955) — what a lot captured from philasearch.com lands on. Since
// #1955 it is the collection's one Philasearch module platform, switched on or off on Settings →
// Philasearch. A lot page names the house selling it and the house's sale; the aggregator itself is
// this platform.
//
// A thin file on purpose, as `allegro.ts` is: everything a capture does is `auctions.ts`'s.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The Philasearch platform while it is switched on, or null. */
export async function getPhilasearchPlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, PHILASEARCH_PLATFORM_MODULE);
}
