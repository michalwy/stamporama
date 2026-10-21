import "server-only";
import { prisma } from "./db";
import { FULL_MAX_EDGE } from "./photos/process";
import { photoMeasureFrame } from "./photo-measure-frame";
import { assertCollectionProfiles } from "./photos";
import { makeOfferLabeller, STAMP_LABEL_SELECT } from "./offer-labels";
import { formatItemNo } from "./item-number";
import {
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
// time from the copy's Photos card, from an offer's Photos card or a one-off collage to the photos
// marked *No scale* that keep its images from one scale (#2067), and in bulk from the Copies list to
// the ticked copies' photos never given one. **The bulk write never replaces a choice**: it is for the
// photos nobody has said anything about — taking the collection's default since #2066 — and
// overwriting a profile someone chose, one a card scan gave its tiles, or a *No scale* someone marked
// would be the one silent mistake this exists to prevent.

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
          noScale: true,
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

/** A photo nobody has said anything about (#2066) — taken at the collection's default. */
const NEVER_GIVEN_A_SCALE = { scanningProfileId: null, scanDpi: null, noScale: false } as const;

/**
 * Give the photos of the ticked copies that were **never given a scale** this one (#2061), in one
 * write, and say how many were given it. A photo that names a profile or a resolution, or is marked
 * *No scale*, is left alone (#2066).
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
  if (!parsed || parsed.kind === "none" || parsed.kind === "default") {
    throw new PhotoScaleError("Pick the scanning profile or type the resolution to give the photos.");
  }
  const columns = photoScaleColumns(parsed);
  if (columns.scanningProfileId) await assertCollectionProfiles(collectionId, [columns.scanningProfileId]);
  if (itemIds.length === 0) return 0;
  const { count } = await prisma.photo.updateMany({
    where: {
      itemId: { in: [...itemIds] },
      item: { collectionId },
      ...NEVER_GIVEN_A_SCALE,
    },
    data: columns,
  });
  return count;
}

/** How many photos of the ticked copies were never given a scale — what the bulk dialog says it will
 *  reach. */
export async function countUnscaledCopyPhotos(
  ownerId: string,
  collectionId: string,
  itemIds: readonly string[]
): Promise<number> {
  await assertOwnedCollection(ownerId, collectionId);
  if (itemIds.length === 0) return 0;
  return prisma.photo.count({
    where: { itemId: { in: [...itemIds] }, item: { collectionId }, ...NEVER_GIVEN_A_SCALE },
  });
}

// ## The photos an offer's images lack a scale for (#2067)
//
// The offer's Photos card and the one-off collage's preview know *which* photos keep an image from
// one scale (the generator's `unscaledPhotoIds`); this names them — copy number, catalogue number,
// side — and gives them a scale there. **The scale is the photo's**, written exactly as from the
// copy's own Photos card, so it holds for every offer the photo is on.

/** One photo the list names, with its copy. */
export interface ScaleListPhoto {
  photoId: string;
  itemId: string;
  /** `#00012 · Mi 123` — the copy's number, then its leading catalogue number (else its stamp). */
  copyLabel: string;
  /** `front` / `back`, or null for an extra. */
  role: string | null;
  scale: PhotoScaleInput;
}

export interface ScaleListPhotos {
  scanning: ScanningSetup;
  photos: ScaleListPhoto[];
}

/** The named photos that are copies' photos in this collection, in the order asked; any other id is
 *  passed over, as a list passes over what it cannot reach. */
export async function readScaleListPhotos(
  ownerId: string,
  collectionId: string,
  photoIds: readonly string[]
): Promise<ScaleListPhotos> {
  await assertOwnedCollection(ownerId, collectionId);
  const [rows, labeller, scanning] = await Promise.all([
    prisma.photo.findMany({
      where: { id: { in: [...new Set(photoIds)] }, item: { collectionId } },
      select: {
        id: true,
        role: true,
        scanningProfileId: true,
        scanDpi: true,
        noScale: true,
        item: { select: { id: true, itemNo: true, stamp: { select: STAMP_LABEL_SELECT.stamp.select } } },
      },
    }),
    makeOfferLabeller(collectionId),
    getScanningSetup(collectionId),
  ]);
  const byId = new Map(rows.map((r) => [r.id, r]));
  const photos = photoIds.flatMap((id): ScaleListPhoto[] => {
    const row = byId.get(id);
    if (!row?.item) return [];
    return [
      {
        photoId: row.id,
        itemId: row.item.id,
        copyLabel: `${formatItemNo(row.item.itemNo)} · ${labeller.copy(row.item.stamp)}`,
        role: row.role,
        scale: photoScaleOf(row),
      },
    ];
  });
  return { scanning, photos };
}

/** Give some copies' photos in this collection a scale each — any of the four. Every photo named must
 *  be the photo of a copy in this collection. */
export async function setCollectionPhotoScales(
  ownerId: string,
  collectionId: string,
  changes: readonly { photoId: string; scale: unknown }[]
): Promise<number> {
  await assertOwnedCollection(ownerId, collectionId);
  const ids = [...new Set(changes.map((c) => c.photoId))];
  const own = new Set(
    (await prisma.photo.findMany({ where: { id: { in: ids }, item: { collectionId } }, select: { id: true } })).map(
      (p) => p.id
    )
  );
  const parsed = changes.map((change) => {
    if (!own.has(change.photoId)) throw new PhotoScaleError("That photo is not a copy's photo in this collection.");
    const scale = parsePhotoScaleInput(change.scale);
    if (!scale) throw new PhotoScaleError("That is not a scale a photo can be given.");
    return { photoId: change.photoId, columns: photoScaleColumns(scale) };
  });
  await assertCollectionProfiles(
    collectionId,
    parsed.flatMap((p) => (p.columns.scanningProfileId ? [p.columns.scanningProfileId] : []))
  );
  await prisma.$transaction(
    parsed.map((p) => prisma.photo.update({ where: { id: p.photoId }, data: p.columns }))
  );
  return parsed.length;
}
