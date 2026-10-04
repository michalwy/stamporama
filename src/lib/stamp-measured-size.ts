import "server-only";
import { prisma } from "./db";
import {
  listStampCopyPhotos,
  measureFrameOf,
  PHOTO_FRAME_SELECT,
  sortPhotos,
  type PhotoSummary,
} from "./photos";
import {
  MAX_SIZE_MM,
  MIN_SIZE_MM,
  measuredSizeWrite,
  roundSizeMm,
  sizeProfileAfterWrite,
  type StampSize,
  type StampSizeFields,
} from "./stamp-size";
import {
  assertCollectionProfile,
  SCANNING_SETUP_SELECT,
  ScanningProfileError,
  toScanningSetup,
} from "./scanning-profiles";
import type { ScanningSetup } from "./scanning-profile";
import { photoMeasureStampId, type MeasureFrame } from "./photo-measure-frame";

// A size measured on a photo, written onto the stamp (#1290) — so measuring and setting the size is
// one act rather than reading a figure off the viewer and typing it somewhere else.
//
// It is the same two columns #763 put on `Stamp`, and there is still no *measured* flag: a size is
// either stated or absent (#763). What is recorded beside it since #1443 is the scanning profile it
// was measured with, when it was measured with one (`Stamp.sizeScanningProfileId`); a size written
// here without one — the page editor's typed or preset figure, a resolution typed for the sitting,
// the assistant's write — records none, and clears whatever an earlier measurement recorded.
//
// **A stated size is never replaced silently** (`measuredSizeWrite`). The rule is read here, on the
// server, so the question the collector is asked is a gate and not a hint a caller could skip.

export class StampMeasuredSizeError extends Error {}

export type MeasuredSizeWriteResult =
  | { status: "saved"; size: StampSize }
  | { status: "same"; size: StampSize }
  /** The stamp states a different size; nothing was written. `current` is what it states, for the
   * question the collector is asked before replacing it. */
  | { status: "confirm"; size: StampSize; current: StampSizeFields };

export async function writeMeasuredStampSize(
  ownerId: string,
  stampId: string,
  measured: StampSize,
  replace: boolean,
  /** The scanning profile the figures were measured with (#1443), or null when they were not
   * measured with one. */
  measuredWith: string | null = null
): Promise<MeasuredSizeWriteResult> {
  const size = {
    widthMm: roundSizeMm(measured.widthMm),
    heightMm: roundSizeMm(measured.heightMm),
  };
  for (const mm of [size.widthMm, size.heightMm]) {
    if (!Number.isFinite(mm) || mm < MIN_SIZE_MM || mm > MAX_SIZE_MM) {
      throw new StampMeasuredSizeError("That is not a size a stamp can have.");
    }
  }

  return prisma.$transaction(async (tx) => {
    const stamp = await tx.stamp.findUnique({
      where: { id: stampId },
      select: {
        widthMm: true,
        heightMm: true,
        sizeScanningProfileId: true,
        collectionId: true,
        collection: { select: { ownerId: true } },
      },
    });
    if (!stamp || stamp.collection.ownerId !== ownerId) {
      throw new StampMeasuredSizeError("Stamp not found.");
    }
    const current = {
      widthMm: stamp.widthMm === null ? null : stamp.widthMm.toNumber(),
      heightMm: stamp.heightMm === null ? null : stamp.heightMm.toNumber(),
    };
    const decision = measuredSizeWrite(current, size, replace);
    if (decision === "same") return { status: "same", size };
    if (decision === "confirm") return { status: "confirm", size, current };
    if (measuredWith) {
      try {
        await assertCollectionProfile(tx, stamp.collectionId, measuredWith);
      } catch (err) {
        if (err instanceof ScanningProfileError) throw new StampMeasuredSizeError(err.message);
        throw err;
      }
    }
    await tx.stamp.update({
      where: { id: stampId },
      data: {
        ...size,
        sizeScanningProfileId: sizeProfileAfterWrite(
          { ...current, profileId: stamp.sizeScanningProfileId },
          size,
          measuredWith
        ),
      },
    });
    return { status: "saved", size };
  });
}

/**
 * What the page editor offers for setting one stamp's size from a box (#1309): the size it states,
 * the scanning profiles its photos can be read at (#1443), and the photos a size can be measured on.
 *
 * The photos are the ones the stamp's own screen offers the tools on (#1290) — its own pictures, then
 * its copies' — and only those whose frame is known: a picture with no measuring frame opens in the
 * viewer without tools, and a box's panel offering it for measuring would promise a scale nobody can
 * state. `unmeasurable` counts the rest, so the panel can say *why* nothing is offered rather than
 * reading as a stamp with no photo.
 */
export interface StampSizeSources {
  size: StampSizeFields;
  scanning: ScanningSetup;
  photos: PhotoSummary[];
  unmeasurable: number;
}

export async function getStampSizeSources(
  ownerId: string,
  stampId: string
): Promise<StampSizeSources> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: {
      widthMm: true,
      heightMm: true,
      collection: { select: { ownerId: true, ...SCANNING_SETUP_SELECT } },
      photos: {
        select: { id: true, role: true, title: true, sortOrder: true, ...PHOTO_FRAME_SELECT },
      },
    },
  });
  if (!stamp || stamp.collection.ownerId !== ownerId) {
    throw new StampMeasuredSizeError("Stamp not found.");
  }
  const own: PhotoSummary[] = stamp.photos
    .map((p) => ({
      id: p.id,
      role: (p.role === "main" || p.role === "front" || p.role === "back" ? p.role : null) as
        | "main"
        | "front"
        | "back"
        | null,
      title: p.title,
      sortOrder: p.sortOrder,
      measureFrame: measureFrameOf(p),
    }))
    .sort(sortPhotos);
  const copies = await listStampCopyPhotos(ownerId, stampId);
  const all = [...own, ...copies.photos];
  const photos = all.filter((p) => p.measureFrame);
  return {
    size: {
      widthMm: stamp.widthMm === null ? null : stamp.widthMm.toNumber(),
      heightMm: stamp.heightMm === null ? null : stamp.heightMm.toNumber(),
    },
    scanning: toScanningSetup(stamp.collection),
    photos,
    // Copies past the strip's cap are not looked at, and are not counted here either: this says why
    // nothing listed can be measured, not how many pictures exist.
    unmeasurable: all.length - photos.length,
  };
}

/**
 * What the measuring viewer needs about one photo, opened from whichever lightbox enlarged it
 * (#1592): the frame it is measured in, the stamp a reading sets the size of, and the collection's
 * scanning profiles (#1443) to read it at.
 *
 * Asked when *Measure* is pressed rather than carried by every list that draws a thumbnail: a dozen
 * readers build photo summaries and none of them shows a frame, and the stamp a reading belongs to is
 * the photo's owner's business (`photoMeasureStampId`), not the screen's.
 */
export interface PhotoMeasureTarget {
  /** Null where the photo cannot be measured honestly — the viewer then opens without its tools. */
  frame: MeasureFrame | null;
  /** Null where the picture is of no one stamp: it measures, and sets nothing. */
  stampId: string | null;
  scanning: ScanningSetup;
}

export async function getPhotoMeasureTarget(
  ownerId: string,
  collectionId: string,
  photoId: string
): Promise<PhotoMeasureTarget> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: {
      ...PHOTO_FRAME_SELECT,
      stampId: true,
      // Exactly one owner is set (#137, #311, #566) — any of them answers which collection it is in.
      item: { select: { collectionId: true, stampId: true, stampCount: true } },
      stamp: { select: { collectionId: true } },
      offer: { select: { collectionId: true } },
      tile: { select: { collectionId: true } },
    },
  });
  const owner = photo && (photo.item ?? photo.stamp ?? photo.offer ?? photo.tile);
  if (!photo || !owner || owner.collectionId !== collectionId) {
    throw new StampMeasuredSizeError("Photo not found.");
  }
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, ...SCANNING_SETUP_SELECT },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new StampMeasuredSizeError("Photo not found.");
  }
  return {
    frame: measureFrameOf(photo),
    stampId: photoMeasureStampId({ stampId: photo.stampId, item: photo.item }),
    scanning: toScanningSetup(collection),
  };
}
