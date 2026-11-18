// The collection the phone opens on its next start (#2574; ADR-0072 §3, amended).
//
// Kept on the account (`User.phoneCollectionId`), not on the device, so it holds across signing in
// again and on another phone. Set only from a phone screen; the desk never touches it. Where `/phone`
// goes with it is `phoneStart` (`phone.ts`, pure).

import { prisma } from "./db";

/** The collection the collector last opened on the phone, or null when none is remembered. */
export async function getPhoneCollectionId(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { phoneCollectionId: true },
  });
  return user?.phoneCollectionId ?? null;
}

/**
 * Remember the collection a phone screen was opened in, when it is the collector's own. A no-op when
 * it is already the remembered one, so opening the next screen of the same collection writes nothing.
 */
export async function rememberPhoneCollection(userId: string, collectionSlug: string): Promise<void> {
  const collection = await prisma.collection.findUnique({
    where: { ownerId_slug: { ownerId: userId, slug: collectionSlug } },
    select: { id: true },
  });
  if (!collection) return;
  await prisma.user.updateMany({
    where: {
      id: userId,
      OR: [{ phoneCollectionId: null }, { phoneCollectionId: { not: collection.id } }],
    },
    data: { phoneCollectionId: collection.id },
  });
}
