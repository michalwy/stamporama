import "server-only";
import { randomUUID } from "node:crypto";
import sharp from "sharp";
import { prisma } from "./db";
import {
  getActiveStorage,
  getStorage,
  permanentPrefix,
  sheetVariantKey,
  variantKey,
} from "./storage";
import { FULL_MAX_EDGE, processImage } from "./photos/process";
import { extractSheetRegion } from "./photos/sheet";
import { PhotoAuthError, PhotoValidationError, deletePhotoVariants } from "./photos";
import { photoMeasureFrame, type MeasureFrame } from "./photo-measure-frame";
import {
  MIN_SNAPSHOT_REGION,
  snapshotOutputSize,
  snapshotOverlaySvg,
  type SnapshotRequest,
} from "./annotations";
import type { Box } from "./scan-boxes";
import { asQuarterTurn, turnedSize, unturnBox, type QuarterTurn } from "./tile-turn";

// A marked-up detail kept as a photo (#674).
//
// ## Where it goes: to whoever owns the picture it was taken on
//
// Settled with the collector on 2026-09-14. A snapshot on a copy's photo is the copy's; on a stamp's
// photo, the stamp's; on a scan tile still being identified, the **tile's** — and a tile's photos all
// move onto the copy it becomes (`movePhotosToItem`, #567), so the snapshot arrives on the copy with
// the front and the back rather than being lost to the identification that has not happened yet. It
// is always an extra (`role: null`): a detail is not a front, and must never displace one.
//
// ## It is rendered here, not in the browser
//
// The viewer could draw a canvas and upload it, and would get it wrong in the two ways that matter:
// the photo route may answer with a redirect to another origin, which taints any canvas it is drawn
// into (#614's trap), and the browser only holds the pixels it happens to be showing. The server
// holds the stored picture — and, for a tile whose card is still retained, the **card itself** — so
// the snapshot is cut from the best source there is, at that source's own resolution, with the marks
// drawn into it by the same shapes the viewer drew (`annotations.ts`).
//
// ## The frame
//
// The request's region and marks are in the picture's own pixels, the frame every measurement is
// taken in: a tile side's box on the card (turned, #1006), or a photo's upload (`photo-measure-frame.ts`).
// This module re-derives that frame from the row rather than trusting one sent with the request, so
// a region is clamped against the picture the server actually has.

export type SnapshotOwner = "item" | "stamp" | "tile";

const SHEET_SELECT = {
  storageBackend: true,
  storageKey: true,
  mime: true,
  width: true,
  height: true,
  purgedAt: true,
} as const;

/**
 * Cut the region out of the picture, draw the marks into it, and save it as a new photo beside the
 * one it was taken on. The original picture is not touched.
 */
export async function saveAnnotatedSnapshot(
  ownerId: string,
  collectionId: string,
  request: SnapshotRequest
): Promise<{ photoId: string; owner: SnapshotOwner }> {
  const photo = await prisma.photo.findUnique({
    where: { id: request.photoId },
    select: {
      itemId: true,
      stampId: true,
      tileId: true,
      role: true,
      storageBackend: true,
      storageKey: true,
      mime: true,
      width: true,
      height: true,
      originalWidth: true,
      originalHeight: true,
      item: { select: { collectionId: true, collection: { select: { ownerId: true } } } },
      stamp: { select: { collectionId: true, collection: { select: { ownerId: true } } } },
      tile: {
        select: {
          collectionId: true,
          collection: { select: { ownerId: true } },
          frontX: true,
          frontY: true,
          frontW: true,
          frontH: true,
          backX: true,
          backY: true,
          backW: true,
          backH: true,
          frontTurn: true,
          backTurn: true,
          frontSheet: { select: SHEET_SELECT },
          backSheet: { select: SHEET_SELECT },
        },
      },
    },
  });
  const owningCollection = photo?.item ?? photo?.stamp ?? photo?.tile ?? null;
  if (
    !photo ||
    !owningCollection ||
    owningCollection.collectionId !== collectionId ||
    owningCollection.collection.ownerId !== ownerId
  ) {
    // An offer's generated image has no owner a detail could belong to, and is not found here.
    throw new PhotoAuthError("Photo not found or access denied.");
  }

  const owner: SnapshotOwner = photo.itemId ? "item" : photo.stampId ? "stamp" : "tile";
  const side = tileSide(photo);
  const frame = side ? turnedSize({ width: side.box.w, height: side.box.h }, side.turn) : null;
  const pictureFrame: MeasureFrame =
    frame ?? photoMeasureFrame(photo, FULL_MAX_EDGE) ?? { width: photo.width, height: photo.height };

  const region = clampRegion(request.region, pictureFrame);
  if (!region) {
    throw new PhotoValidationError("The part of the picture to keep is outside it.");
  }

  const source =
    (side?.sheet ? await cropFromSheet(side, region).catch(() => null) : null) ??
    (await cropFromPhoto(photo, pictureFrame, region));

  const out = snapshotOutputSize(region, source.size, FULL_MAX_EDGE);
  const resized = await sharp(source.buffer, { failOn: "error" })
    .resize(out.width, out.height, { fit: "fill" })
    .flatten({ background: "#ffffff" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  const composed = await sharp(resized.data, {
    raw: { width: resized.info.width, height: resized.info.height, channels: resized.info.channels },
  })
    .composite([{ input: Buffer.from(snapshotOverlaySvg(request.marks, region, out)), left: 0, top: 0 }])
    .jpeg({ quality: 95 })
    .toBuffer();

  const processed = await processImage(composed, "image/jpeg");
  const photoId = randomUUID();
  const storage = getActiveStorage();
  const prefix = permanentPrefix(collectionId, photoId);
  const mime = processed.full.mime;
  // Bytes before the row, so a committed row never names bytes that are not there.
  await storage.put(variantKey(prefix, "full", mime), processed.full.buffer, mime, "delivery");
  await storage.put(variantKey(prefix, "thumb", mime), processed.thumb.buffer, mime, "delivery");

  const ownerField =
    owner === "item"
      ? { itemId: photo.itemId! }
      : owner === "stamp"
        ? { stampId: photo.stampId! }
        : { tileId: photo.tileId! };
  try {
    await prisma.$transaction(async (tx) => {
      const last = await tx.photo.aggregate({ where: ownerField, _max: { sortOrder: true } });
      await tx.photo.create({
        data: {
          id: photoId,
          ...ownerField,
          role: null,
          title: request.title,
          storageBackend: storage.backend,
          storageKey: prefix,
          mime,
          width: processed.full.width,
          height: processed.full.height,
          originalWidth: processed.original.width,
          originalHeight: processed.original.height,
          sizeBytes: processed.full.buffer.byteLength,
          sortOrder: (last._max.sortOrder ?? -1) + 1,
        },
      });
    });
  } catch (err) {
    await deletePhotoVariants(storage.backend, prefix, mime);
    throw err;
  }

  return { photoId, owner };
}

interface TileSideSource {
  box: Box;
  turn: QuarterTurn;
  sheet: {
    storageBackend: string;
    storageKey: string;
    mime: string;
    width: number;
    height: number;
  } | null;
}

/**
 * The tile side a photo is the crop of — its box on the card, its turn, and the card while it is
 * still retained. Null for anything that is not a tile's own front or back with a box: an item's or a
 * stamp's photo, and a tile's own extras (an earlier snapshot), all of which are their own pictures.
 */
function tileSide(photo: {
  role: string | null;
  tile: {
    frontX: number | null;
    frontY: number | null;
    frontW: number | null;
    frontH: number | null;
    backX: number | null;
    backY: number | null;
    backW: number | null;
    backH: number | null;
    frontTurn: number;
    backTurn: number;
    frontSheet: (TileSideSource["sheet"] & { purgedAt: Date | null }) | null;
    backSheet: (TileSideSource["sheet"] & { purgedAt: Date | null }) | null;
  } | null;
}): TileSideSource | null {
  const tile = photo.tile;
  if (!tile || (photo.role !== "front" && photo.role !== "back")) return null;
  const front = photo.role === "front";
  const x = front ? tile.frontX : tile.backX;
  const y = front ? tile.frontY : tile.backY;
  const w = front ? tile.frontW : tile.backW;
  const h = front ? tile.frontH : tile.backH;
  if (x == null || y == null || w == null || h == null || w <= 0 || h <= 0) return null;
  const sheet = front ? tile.frontSheet : tile.backSheet;
  return {
    box: { x, y, w, h },
    turn: asQuarterTurn(front ? tile.frontTurn : tile.backTurn),
    sheet: sheet && !sheet.purgedAt ? sheet : null,
  };
}

/** The request's region, whole pixels inside the picture, or null when too little of it is left. */
function clampRegion(region: Box, frame: MeasureFrame): Box | null {
  const x = Math.min(Math.max(region.x, 0), frame.width);
  const y = Math.min(Math.max(region.y, 0), frame.height);
  const x1 = Math.min(region.x + region.w, frame.width);
  const y1 = Math.min(region.y + region.h, frame.height);
  const box = { x, y, w: x1 - x, h: y1 - y };
  return box.w >= MIN_SNAPSHOT_REGION && box.h >= MIN_SNAPSHOT_REGION ? box : null;
}

/**
 * The region cut from the retained card, at the card's own resolution up to the pipeline's cap — the
 * same pixels the viewer escalates to past the tile photo's own size (`useSheetRegion`). The region is
 * in the turned frame the tile is drawn in; the card only knows the frame it was scanned in, so it is
 * turned back and moved to the tile's corner first, exactly as the region route is asked.
 */
async function cropFromSheet(
  side: TileSideSource,
  region: Box
): Promise<{ buffer: Buffer; size: { width: number; height: number } }> {
  const sheet = side.sheet!;
  const onTile = unturnBox(region, side.turn, { width: side.box.w, height: side.box.h });
  const onSheet = { x: side.box.x + onTile.x, y: side.box.y + onTile.y, w: onTile.w, h: onTile.h };
  if (onSheet.x + onSheet.w > sheet.width || onSheet.y + onSheet.h > sheet.height) {
    throw new PhotoValidationError("The region is not on the card.");
  }
  const original = await readBytes(
    sheet.storageBackend,
    sheetVariantKey(sheet.storageKey, "original", sheet.mime),
    sheet.mime
  );
  const crop = await extractSheetRegion(original, onSheet, Math.min(region.w, FULL_MAX_EDGE), side.turn);
  return { buffer: crop.buffer, size: { width: crop.width, height: crop.height } };
}

/** The region cut from the stored picture, mapped from the frame onto the derivative's own pixels. */
async function cropFromPhoto(
  photo: { storageBackend: string; storageKey: string; mime: string; width: number; height: number },
  frame: MeasureFrame,
  region: Box
): Promise<{ buffer: Buffer; size: { width: number; height: number } }> {
  const rx = photo.width / frame.width;
  const ry = photo.height / frame.height;
  const left = Math.min(Math.floor(region.x * rx), photo.width - 1);
  const top = Math.min(Math.floor(region.y * ry), photo.height - 1);
  const width = Math.max(1, Math.min(Math.ceil((region.x + region.w) * rx), photo.width) - left);
  const height = Math.max(1, Math.min(Math.ceil((region.y + region.h) * ry), photo.height) - top);
  const bytes = await readBytes(
    photo.storageBackend,
    variantKey(photo.storageKey, "full", photo.mime),
    photo.mime
  );
  const buffer = await sharp(bytes, { failOn: "error" })
    .extract({ left, top, width, height })
    .png()
    .toBuffer();
  return { buffer, size: { width, height } };
}

async function readBytes(backend: string, key: string, mime: string): Promise<Buffer> {
  // `work`: the server reads these to make something of them, not to hand them to a browser (#591).
  const object = await getStorage(backend).get(key, mime, "work");
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
