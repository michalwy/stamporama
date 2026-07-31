import "server-only";
import { prisma } from "./db";
import { getModulePlatform, listPlatformContactRows, setModulePlatform } from "./module-platform";
import { ALLEGRO_PLATFORM_MODULE } from "./platform-modules";

// Which platform contact **is** Allegro (#355) — the one setting the Assistant's lot capture rides
// on, and the whole of Settings → Allegro.
//
// It is a setting rather than a field on the capture, because a listing page cannot state it: the
// page knows it is Allegro, and what the capture needs to know is which `Contact` of *this*
// collection that marketplace is. Asked once here, it is never asked again on a capture — which is
// the point, since the gesture is one click on a listing.
//
// Deliberately a thin file. The exclusivity rule is `module-platform.ts`'s, shared with Colnect's
// identical question, and everything a capture then does is `auctions.ts`'s.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The platform contact currently marked as Allegro, or null when none is. */
export async function getAllegroPlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE);
}

/** Every platform contact of the collection, for the picker. */
export async function listAllegroPlatformCandidates(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string }[]> {
  await assertCollectionOwner(ownerId, collectionId);
  return listPlatformContactRows(collectionId);
}

/** Mark one platform contact as Allegro, or clear the setting with null. Exclusive, and refuses a
 *  contact that is not a platform of this collection — see {@link setModulePlatform}. */
export async function setAllegroPlatform(
  ownerId: string,
  collectionId: string,
  contactId: string | null
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await setModulePlatform(collectionId, ALLEGRO_PLATFORM_MODULE, contactId);
}
