import "server-only";
import { prisma } from "./db";
import { FULL_MAX_EDGE } from "./photos/process";
import { photoMeasureFrame } from "./photo-measure-frame";
import { assertCollectionProfiles } from "./photos";
import {
  hasPhotoScale,
  parsePhotoScaleInput,
  photoScaleColumns,
  photoScaleOf,
  type PhotoScaleInput,
} from "./photo-scale";
import { getScanningSetup } from "./scanning-profiles";
import type { ScanningSetup } from "./scanning-profile";

// The reads and writes of a copy photo's scale (#2061) — the arithmetic is `photo-scale.ts`.
//
// A scale is given to a copy's photo when it is added (the change-set, `photos.ts`), one photo at a
// time from the copy's Photos card, and in bulk from the Copies list to the ticked copies' photos
// that have none. **The bulk write never replaces a scale**: it is for the photos nobody has said
// anything about, and overwriting a profile someone chose — or one a card scan gave its tiles — would
// be the one silent mistake this exists to prevent.

export class PhotoScaleError extends Error {}

/** One of a copy's photos as its Photos card shows the scale. */
export interface CopyPhotoScale {
  photoId: string;
  scale: PhotoScaleInput;
  /** False where no scale can be reckoned whatever is chosen: a picture stored at the size cap from
   *  before the upload's own size was recorded (`photo-measure-frame.ts`). */
  reckonable: boolean;
}

export interface CopyPhotoScales {
  scanning: ScanningSetup;
  photos: CopyPhotoScale[];
}

async function assertOwnedCollection(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new PhotoScaleError("Collection not found or access denied.");
}

/** A collection's scanning profiles, owner-checked — what a dialog that picks a scale offers. */
export async function readScanningSetup(ownerId: string, collectionId: string): Promise<ScanningSetup> {
  await assertOwnedCollection(ownerId, collectionId);
  return getScanningSetup(collectionId);
}

/** A copy's photos with what each was scanned with, and the collection's profiles to choose from. */
export async function readCopyPhotoScales(ownerId: string, itemId: string): Promise<CopyPhotoScales> {
  const item = await prisma.item.findFirst({
    where: { id: itemId, collection: { ownerId } },
    select: {
      collectionId: true,
      photos: {
        select: {
          id: true,
          scanningProfileId: true,
          scanDpi: true,
          width: true,
          height: true,
          originalWidth: true,
          originalHeight: true,
        },
      },
    },
  });
  if (!item) throw new PhotoScaleError("Copy not found.");
  return {
    scanning: await getScanningSetup(item.collectionId),
    photos: item.photos.map((p) => ({
      photoId: p.id,
      scale: photoScaleOf(p),
      reckonable: photoMeasureFrame(p, FULL_MAX_EDGE) !== null,
    })),
  };
}

/** Give some of a copy's photos a scale each — any of the three, *none* included. Every photo named
 *  must be this copy's. */
export async function setCopyPhotoScales(
  ownerId: string,
  itemId: string,
  changes: readonly { photoId: string; scale: unknown }[]
): Promise<void> {
  const item = await prisma.item.findFirst({
    where: { id: itemId, collection: { ownerId } },
    select: { collectionId: true, photos: { select: { id: true } } },
  });
  if (!item) throw new PhotoScaleError("Copy not found.");
  const own = new Set(item.photos.map((p) => p.id));
  const parsed = changes.map((change) => {
    if (!own.has(change.photoId)) throw new PhotoScaleError("That photo is not this copy's.");
    const scale = parsePhotoScaleInput(change.scale);
    if (!scale) throw new PhotoScaleError("That is not a scale a photo can be given.");
    return { photoId: change.photoId, columns: photoScaleColumns(scale) };
  });
  await assertCollectionProfiles(
    item.collectionId,
    parsed.flatMap((p) => (p.columns.scanningProfileId ? [p.columns.scanningProfileId] : []))
  );
  await prisma.$transaction(
    parsed.map((p) => prisma.photo.update({ where: { id: p.photoId }, data: p.columns }))
  );
}

/**
 * Give the photos of the ticked copies that have **no scale** this one (#2061), in one write, and
 * say how many were given it. A photo that already names a profile or a resolution is left alone.
 * Copies outside the collection are passed over, as a list's bulk action passes over what it cannot
 * reach.
 */
export async function giveUnscaledCopyPhotosScale(
  ownerId: string,
  collectionId: string,
  itemIds: readonly string[],
  scale: unknown
): Promise<number> {
  await assertOwnedCollection(ownerId, collectionId);
  const parsed = parsePhotoScaleInput(scale);
  if (!parsed || parsed.kind === "none") {
    throw new PhotoScaleError("Pick the scanning profile or type the resolution to give the photos.");
  }
  const columns = photoScaleColumns(parsed);
  if (!hasPhotoScale(columns)) throw new PhotoScaleError("Pick a scale.");
  if (columns.scanningProfileId) await assertCollectionProfiles(collectionId, [columns.scanningProfileId]);
  if (itemIds.length === 0) return 0;
  const { count } = await prisma.photo.updateMany({
    where: {
      itemId: { in: [...itemIds] },
      item: { collectionId },
      scanningProfileId: null,
      scanDpi: null,
    },
    data: columns,
  });
  return count;
}

/** How many photos of the ticked copies have no scale — what the bulk dialog says it will reach. */
export async function countUnscaledCopyPhotos(
  ownerId: string,
  collectionId: string,
  itemIds: readonly string[]
): Promise<number> {
  await assertOwnedCollection(ownerId, collectionId);
  if (itemIds.length === 0) return 0;
  return prisma.photo.count({
    where: { itemId: { in: [...itemIds] }, item: { collectionId }, scanningProfileId: null, scanDpi: null },
  });
}
