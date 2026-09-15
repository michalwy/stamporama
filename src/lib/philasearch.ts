import "server-only";
import { prisma } from "./db";
import { getModulePlatform, setModulePlatform } from "./module-platform";
import { PHILASEARCH_PLATFORM_MODULE } from "./platform-modules";

// Which platform contact **is** Philasearch (#742) — the one setting the Assistant's lot capture from
// philasearch.com rides on, and the whole of Settings → Philasearch.
//
// A thin file on purpose, exactly as `allegro.ts` and `delcampe.ts` are: the exclusivity rule is
// `module-platform.ts`'s, and everything a capture then does is `auctions.ts`'s. A lot page names the
// house selling it and the house's sale; which `Contact` of this collection the aggregator itself is,
// it cannot say.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The platform contact currently marked as Philasearch, or null when none is. */
export async function getPhilasearchPlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, PHILASEARCH_PLATFORM_MODULE);
}

/** Mark one platform contact as Philasearch, or clear the setting with null. Exclusive, and refuses
 *  a contact that is not a platform of this collection — see {@link setModulePlatform}. */
export async function setPhilasearchPlatform(
  ownerId: string,
  collectionId: string,
  contactId: string | null
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await setModulePlatform(collectionId, PHILASEARCH_PLATFORM_MODULE, contactId);
}
