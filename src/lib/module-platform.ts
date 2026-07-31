import "server-only";
import { prisma } from "./db";

// Which platform `Contact` **is** a given marketplace (#406, extended by #355) — one question asked
// once per module id, and the only place `Contact.platformModule` is written.
//
// It lived inside `colnect.ts` while Colnect was the only marketplace the Assistant knew. Allegro
// (#355) asks the identical question on its own Settings tab, and an exclusive setter written twice
// is a rule that drifts: the whole point is that "which platform is X" always has exactly one
// answer, which only holds if one statement clears the previous holder.
//
// Deliberately neutral about what the marker *switches on*. For Colnect it gates the listing
// preconditions (#406); for Allegro it names the platform a captured auction lot belongs to (#355).
// Neither is knowledge this module has, and adding a third marketplace should not need it.

/** The platform contact currently marked as `moduleId`, or null when none is. */
export async function getModulePlatform(
  collectionId: string,
  moduleId: string
): Promise<{ id: string; name: string } | null> {
  return prisma.contact.findFirst({
    where: { collectionId, platformModule: moduleId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/** Every platform contact of the collection, for the pickers — a platform is the only kind of
 *  contact a marketplace marker means anything on. */
export async function listPlatformContactRows(
  collectionId: string
): Promise<{ id: string; name: string }[]> {
  return prisma.contact.findMany({
    where: { collectionId, platform: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

/**
 * Mark one platform contact as `moduleId`, or clear the setting with null. **Exclusive**: whoever
 * held this id before is cleared in the same transaction, so the collection can never have two
 * Colnects (or two Allegros) and "which one is it" always has one answer. Other modules' markers are
 * untouched — they are separate questions — but a contact only carries one, so pointing Allegro at a
 * contact that was Colnect moves it rather than adding to it, which is the truthful outcome: one
 * `Contact` is one marketplace.
 *
 * Passing a contact that is not a platform of this collection is refused.
 */
export async function setModulePlatform(
  collectionId: string,
  moduleId: string,
  contactId: string | null
): Promise<void> {
  if (contactId) {
    const contact = await prisma.contact.findFirst({
      where: { id: contactId, collectionId, platform: true },
      select: { id: true },
    });
    if (!contact) throw new Error("Platform not found in this collection.");
  }
  await prisma.$transaction([
    prisma.contact.updateMany({
      where: { collectionId, platformModule: moduleId },
      data: { platformModule: null },
    }),
    ...(contactId
      ? [prisma.contact.update({ where: { id: contactId }, data: { platformModule: moduleId } })]
      : []),
  ]);
}
