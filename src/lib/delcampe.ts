import "server-only";
import { prisma } from "./db";
import { getModulePlatform, setModulePlatform } from "./module-platform";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";

// Which platform contact **is** Delcampe (#608) — the one setting everything else in the Delcampe
// chain reads: its listing profiles here, its learned categories (#609), its Easy Uploader export
// (#610) and the reconciliation that follows (#611).
//
// A thin file on purpose, exactly as `allegro.ts` is: the exclusivity rule is `module-platform.ts`'s,
// shared with the identical question Colnect and Allegro each ask on their own tab, and nothing in
// it knows what the marker switches on. What is worth saying here is what it does **not** switch on:
// Delcampe has no Assistant module (`platform-modules.ts` leaves it out of the listing rules), so
// marking a platform as Delcampe offers no handoff and asks none of Colnect's preconditions of its
// offers. Listing there is a file upload, and the file is built by this app.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The platform contact currently marked as Delcampe, or null when none is. */
export async function getDelcampePlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, DELCAMPE_PLATFORM_MODULE);
}

/** Mark one platform contact as Delcampe, or clear the setting with null. Exclusive, and refuses a
 *  contact that is not a platform of this collection — see {@link setModulePlatform}. */
export async function setDelcampePlatform(
  ownerId: string,
  collectionId: string,
  contactId: string | null
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  await setModulePlatform(collectionId, DELCAMPE_PLATFORM_MODULE, contactId);
}
