import "server-only";
import { prisma } from "./db";
import {
  cleanPhotoCovers,
  isPhotoCoverShape,
  isPhotoCoverStyle,
  PhotoCoverValidationError,
  type PhotoCover,
} from "./photo-cover-rules";

// Covers on a copy's photo (#1665; ADR-0066) — the writes, and the read the copy's page shows them
// from. Which photos an *offer* needs checked is the photo plan's question and is answered in
// `offer-photo-generation.ts`, beside the plan it is derived from.
//
// A cover belongs to the copy's photo and nothing else: it is never applied to that photo, only to
// the offer images rendered from it, and saving one is what marks the photo checked — so a photo
// with nothing to hide is saved with an empty list and never asked about again.

export { PhotoCoverValidationError };

/** A copy photo's covers and whether it has been checked. */
export interface PhotoCoverState {
  photoId: string;
  checked: boolean;
  covers: PhotoCover[];
}

function storedCovers(
  rows: readonly { shape: string; style: string; x: number; y: number; width: number; height: number }[]
): PhotoCover[] {
  return rows.flatMap((c) =>
    isPhotoCoverShape(c.shape) && isPhotoCoverStyle(c.style)
      ? [{ shape: c.shape, style: c.style, x: c.x, y: c.y, width: c.width, height: c.height }]
      : []
  );
}

const COVER_ROWS = {
  orderBy: { sortOrder: "asc" },
  select: { shape: true, style: true, x: true, y: true, width: true, height: true },
} as const;

/**
 * Replace a copy photo's covers with `raw` and mark it checked (#1665). An empty list is *nothing to
 * cover* — a decision, recorded like any other. Owner-checked through the copy the photo belongs
 * to; a stamp's photo or an offer's image is refused, since neither is ever covered.
 *
 * @throws {PhotoCoverValidationError} when the photo is not the owner's copy photo or a cover is
 *   unusable.
 */
export async function savePhotoCovers(
  ownerId: string,
  photoId: string,
  raw: unknown
): Promise<PhotoCoverState> {
  const covers = cleanPhotoCovers(raw);
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: { item: { select: { collection: { select: { ownerId: true } } } } },
  });
  if (!photo?.item || photo.item.collection.ownerId !== ownerId) {
    throw new PhotoCoverValidationError("Photo not found, or not a copy's photo.");
  }
  await prisma.$transaction([
    prisma.photoCover.deleteMany({ where: { photoId } }),
    prisma.photoCover.createMany({
      data: covers.map((cover, sortOrder) => ({ photoId, sortOrder, ...cover })),
    }),
    prisma.photo.update({ where: { id: photoId }, data: { coversCheckedAt: new Date() } }),
  ]);
  return { photoId, checked: true, covers };
}

/** Every photo of one copy with its covers, for the copy's page — owner-checked, empty for a copy
 *  that is not the owner's. */
export async function listItemPhotoCovers(
  ownerId: string,
  itemId: string
): Promise<PhotoCoverState[]> {
  const rows = await prisma.photo.findMany({
    where: { itemId, item: { collection: { ownerId } } },
    select: { id: true, coversCheckedAt: true, covers: COVER_ROWS },
  });
  return rows.map((row) => ({
    photoId: row.id,
    checked: row.coversCheckedAt != null,
    covers: storedCovers(row.covers),
  }));
}
