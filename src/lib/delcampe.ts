import "server-only";
import { prisma } from "./db";
import { getModulePlatform } from "./module-platform";
import { DELCAMPE_PLATFORM_MODULE } from "./platform-modules";

// The Delcampe platform (#608; #1955) — what everything else in the Delcampe chain reads: its
// listing profiles here, its learned categories (#609), its Easy Uploader export (#610) and the
// reconciliation that follows (#611). Since #1955 it is the collection's one Delcampe module platform,
// switched on or off on Settings → Delcampe.
//
// A thin file on purpose, as `allegro.ts` is. What is worth saying here is what the module does
// **not** switch on: Delcampe has no Assistant module (`platform-modules.ts` leaves it out of the
// listing rules), so its offers get no handoff and none of Colnect's preconditions. Listing there is
// a file upload, and the file is built by this app.

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

/** The Delcampe platform while it is switched on, or null. */
export async function getDelcampePlatform(
  ownerId: string,
  collectionId: string
): Promise<{ id: string; name: string } | null> {
  await assertCollectionOwner(ownerId, collectionId);
  return getModulePlatform(collectionId, DELCAMPE_PLATFORM_MODULE);
}
