import "server-only";
import { prisma } from "./db";
import { getModulePlatform, setModulePlatform } from "./module-platform";
import { FACEBOOK_PLATFORM_MODULE } from "./platform-modules";

// Which platform contact **is** Facebook (#1543; ADR-0061) — the setting the groups hang off.
//
// A thin file on purpose, as `delcampe.ts` is: the exclusivity rule is `module-platform.ts`'s, shared
// with every other marketplace page. Naming a platform as Facebook switches no Assistant handoff on —
// a group post is a kit posted by hand (#1544) — and asks none of Colnect's preconditions.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The platform contact currently marked as Facebook, or null when none is. */
export async function getFacebookPlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, FACEBOOK_PLATFORM_MODULE);
}

/** Mark one platform contact as Facebook, or clear the setting with null. Exclusive, and refuses a
 *  contact that is not a platform of this collection — see {@link setModulePlatform}. */
export async function setFacebookPlatform(
  ownerId: string,
  collectionId: string,
  contactId: string | null
): Promise<void> {
  await assertCollectionOwner(ownerId, collectionId);
  const before = await getModulePlatform(collectionId, FACEBOOK_PLATFORM_MODULE);
  await setModulePlatform(collectionId, FACEBOOK_PLATFORM_MODULE, contactId);
  // Facebook's rules are why covering symbols exists (#1665), so a platform **newly** named as
  // Facebook starts needing covers. Only at that moment and only ever on: naming the same platform
  // again must not undo a collector who turned it off on the contact.
  if (contactId && before?.id !== contactId) {
    await prisma.contact.update({ where: { id: contactId }, data: { coverSymbols: true } });
  }
}
