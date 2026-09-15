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
  type StampSize,
  type StampSizeFields,
} from "./stamp-size";

// A size measured on a photo, written onto the stamp (#1290) — so measuring and setting the size is
// one act rather than reading a figure off the viewer and typing it somewhere else.
//
// It is the same two columns #763 put on `Stamp`, and there is still no *measured* flag and no stored
// scale: a size is either stated or absent (#763). What makes the figure a measurement is how it got
// there — taken with the size tool, against a scale the collector could see and correct beside it.
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
  replace: boolean
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
      select: { widthMm: true, heightMm: true, collection: { select: { ownerId: true } } },
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
    await tx.stamp.update({ where: { id: stampId }, data: size });
    return { status: "saved", size };
  });
}

/**
 * What the page editor offers for setting one stamp's size from a box (#1309): the size it states,
 * the scale its photos are read at, and the photos a size can be measured on.
 *
 * The photos are the ones the stamp's own screen offers the tools on (#1290) — its own pictures, then
 * its copies' — and only those whose frame is known: a picture with no measuring frame opens in the
 * viewer without tools, and a box's panel offering it for measuring would promise a scale nobody can
 * state. `unmeasurable` counts the rest, so the panel can say *why* nothing is offered rather than
 * reading as a stamp with no photo.
 */
export interface StampSizeSources {
  size: StampSizeFields;
  scanDpi: number;
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
      collection: { select: { ownerId: true, scanDpi: true } },
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
    scanDpi: stamp.collection.scanDpi,
    photos,
    // Copies past the strip's cap are not looked at, and are not counted here either: this says why
    // nothing listed can be measured, not how many pictures exist.
    unmeasurable: all.length - photos.length,
  };
}
