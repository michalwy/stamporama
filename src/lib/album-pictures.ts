import "server-only";
import sharp, { type Metadata } from "sharp";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { albumPictureKey, getActiveStorage, getStorage } from "./storage";
import { assertCollectionOwner } from "./platform-category";
import {
  AlbumOrnamentSvgError,
  readOrnamentSvg,
  type AlbumOrnamentDrawing,
} from "./album-ornament-svg";
import { albumOrnamentName } from "./album-ornaments";
import { albumPictureAspect } from "./album-free-page";

// The collection's picture library for free pages (#1429) — a coat of arms, a map, an emblem,
// uploaded once and placed on as many pages, in as many albums, as the collector wants. Decided with
// the collector on 2026-09-28.
//
// ## Two ways a picture prints
//
// - **As lines.** An SVG the frame's ornament reader takes (ADR-0057) is read once, here, into its
//   outlines, and the outlines are what the PDF and the canvas draw — the vector the issue asks for.
// - **As a picture.** A PNG or a JPEG, as uploaded; or an SVG the reader does not follow — a gradient,
//   transparency, text — **rasterised once at upload** through `sharp`, which already moves every
//   other pixel in this app. Decided with the collector on 2026-09-28: a coat of arms with a gradient
//   is worth printing, and refusing it would send him to a drawing program first. The reason is kept
//   (`rasterReason`) so the screen can say it will print as a picture rather than as lines.
//
// ## Never changed, and not deleted while anything prints it
//
// An element names a picture by id, so replacing its bytes would change what a live page prints with
// nothing to say so. A card in a binder names it through `album_printed_page_picture`. Both foreign
// keys are `NO ACTION`, so the database itself refuses a deletion that would leave either pointing at
// nothing; {@link deleteAlbumPicture} asks first so the refusal can name the albums.

/** Thrown for an upload or a deletion the collector has to change something about. */
export class AlbumPictureError extends Error {}

/** A picture as large as anything a free page could want. A scan of a whole map at 600 dpi fits. */
export const MAX_ALBUM_PICTURE_BYTES = 25 * 1024 * 1024;

/** The longer side an SVG the reader does not follow is rasterised to: 4000 px is an A4 page's
 *  longer side at over 340 dpi, so even a picture placed across a whole sheet is not flagged. */
const RASTER_LONG_SIDE_PX = 4000;

/** What the reader could not follow, when an SVG is printed as a picture. Completes "the drawing …". */
const UNFOLLOWED = "uses SVG the vector reader does not follow";

/** A picture as the library lists it and the plan sizes it. */
export interface AlbumPictureData {
  id: string;
  name: string;
  /** `vector` prints as lines; `raster` as pixels. */
  kind: "vector" | "raster";
  /** The raster's own pixels, for the 300 dpi flag; null for a vector. */
  widthPx: number | null;
  heightPx: number | null;
  /** Height over width — the proportions the plan gives the picture its height from. */
  aspect: number;
  /** Why an SVG prints as a picture, completing "the drawing …"; null otherwise. */
  rasterReason: string | null;
}

const PICTURE_SELECT = {
  id: true,
  name: true,
  collectionId: true,
  storageKey: true,
  storageBackend: true,
  contentType: true,
  widthPx: true,
  heightPx: true,
  drawing: true,
  rasterKey: true,
  rasterReason: true,
} satisfies Prisma.AlbumPictureSelect;

type PictureRow = Prisma.AlbumPictureGetPayload<{ select: typeof PICTURE_SELECT }>;

/** A picture as a renderer needs it: its drawing, or where its pixels are. */
export interface AlbumPictureRef extends AlbumPictureData {
  collectionId: string;
  drawing: AlbumOrnamentDrawing | null;
  /** The pixels to print, for a raster: the rasterised PNG of an SVG, or the upload itself. */
  raster: { backend: string; key: string; mime: string } | null;
}

function toRef(row: PictureRow): AlbumPictureRef {
  const drawing = (row.drawing ?? null) as AlbumOrnamentDrawing | null;
  const raster = drawing
    ? null
    : {
        backend: row.storageBackend,
        key: row.rasterKey ?? row.storageKey,
        mime: row.rasterKey ? "image/png" : row.contentType,
      };
  return {
    id: row.id,
    name: row.name,
    collectionId: row.collectionId,
    kind: drawing ? "vector" : "raster",
    widthPx: drawing ? null : row.widthPx,
    heightPx: drawing ? null : row.heightPx,
    aspect: drawing
      ? albumPictureAspect(drawing.viewBox)
      : albumPictureAspect(
          row.widthPx && row.heightPx ? { width: row.widthPx, height: row.heightPx } : null
        ),
    rasterReason: row.rasterReason,
    drawing,
    raster,
  };
}

function toData(ref: AlbumPictureRef): AlbumPictureData {
  return {
    id: ref.id,
    name: ref.name,
    kind: ref.kind,
    widthPx: ref.widthPx,
    heightPx: ref.heightPx,
    aspect: ref.aspect,
    rasterReason: ref.rasterReason,
  };
}

export async function getAlbumPictures(
  ownerId: string,
  collectionId: string
): Promise<AlbumPictureData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.albumPicture.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: PICTURE_SELECT,
  });
  return rows.map((r) => toData(toRef(r)));
}

/** The pictures of `ids` that are the collection's, by id. One read for a whole page's worth. */
export async function resolveAlbumPictures(
  collectionId: string,
  ids: readonly string[]
): Promise<Map<string, AlbumPictureRef>> {
  const wanted = [...new Set(ids)];
  if (wanted.length === 0) return new Map();
  const rows = await prisma.albumPicture.findMany({
    where: { collectionId, id: { in: wanted } },
    select: PICTURE_SELECT,
  });
  return new Map(rows.map((r) => [r.id, toRef(r)]));
}

/** One picture for serving, scoped by its collection so an id cannot be read through another. */
export async function getAlbumPictureForServing(
  collectionId: string,
  pictureId: string
): Promise<AlbumPictureRef | null> {
  const row = await prisma.albumPicture.findFirst({
    where: { id: pictureId, collectionId },
    select: PICTURE_SELECT,
  });
  return row ? toRef(row) : null;
}

/** A raster picture's pixels, through `src/lib/storage/` — `work`, for the reason a stamp photo's are
 *  (`album-photos.ts`): a PDF is composed again and again from the same few pictures. */
export async function readAlbumPictureBytes(ref: AlbumPictureRef): Promise<Buffer> {
  if (!ref.raster) throw new AlbumPictureError("That picture prints as lines and has no pixels.");
  const object = await getStorage(ref.raster.backend).get(ref.raster.key, ref.raster.mime, "work");
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

/** What an upload is, read from its bytes rather than trusted from its name. */
function sniff(bytes: Buffer): "svg" | "png" | "jpeg" | null {
  if (bytes.length >= 8 && bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return "png";
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
  const head = bytes.subarray(0, 2048).toString("utf8").replace(/^﻿/, "").trimStart();
  if (head.startsWith("<") && /<svg[\s>]/i.test(bytes.subarray(0, 64 * 1024).toString("utf8"))) return "svg";
  return null;
}

/**
 * Rasterise an SVG the vector reader does not follow, once, at a size no placement will out-grow.
 *
 * `density` is what sets librsvg's output size for an SVG; it is chosen so the longer side comes out
 * at {@link RASTER_LONG_SIDE_PX}, and the resize after it only guarantees the ceiling.
 */
async function rasterise(bytes: Buffer): Promise<{ png: Buffer; widthPx: number; heightPx: number }> {
  const meta = await sharp(bytes).metadata();
  const longSide = Math.max(meta.width ?? 0, meta.height ?? 0);
  if (!(longSide > 0)) throw new Error("The drawing states no size.");
  const density = Math.min(72 * (RASTER_LONG_SIDE_PX / longSide), 100_000);
  const { data, info } = await sharp(bytes, { density })
    .resize({ width: RASTER_LONG_SIDE_PX, height: RASTER_LONG_SIDE_PX, fit: "inside", withoutEnlargement: true })
    .png()
    .toBuffer({ resolveWithObject: true });
  return { png: data, widthPx: info.width, heightPx: info.height };
}

/**
 * Take a picture into the collection's library. Returns the new picture. Throws
 * {@link AlbumPictureError} for a file that cannot be a picture, with the reason.
 */
export async function uploadAlbumPicture(
  ownerId: string,
  collectionId: string,
  fileName: string,
  bytes: Buffer
): Promise<AlbumPictureData> {
  await assertCollectionOwner(ownerId, collectionId);
  if (bytes.length > MAX_ALBUM_PICTURE_BYTES) {
    throw new AlbumPictureError("This file is too large for a picture (25 MB at most).");
  }
  const format = sniff(bytes);
  if (!format) throw new AlbumPictureError("A picture must be an SVG, PNG or JPEG file.");

  let original = bytes;
  let contentType: string;
  let drawing: AlbumOrnamentDrawing | null = null;
  let raster: { png: Buffer; widthPx: number; heightPx: number } | null = null;
  let rasterReason: string | null = null;
  let widthPx: number | null = null;
  let heightPx: number | null = null;

  if (format === "svg") {
    contentType = "image/svg+xml";
    try {
      drawing = readOrnamentSvg(bytes.toString("utf8"));
    } catch (err) {
      if (!(err instanceof AlbumOrnamentSvgError)) throw err;
      // Not something the reader follows — print it as a picture instead (decided 2026-09-28). A file
      // `sharp` cannot draw either is not an SVG anyone can print, and is refused in the reader's words.
      try {
        raster = await rasterise(bytes);
      } catch {
        throw new AlbumPictureError(
          err.reason
            ? `The drawing ${err.reason}, and it could not be drawn as a picture either.`
            : err.message
        );
      }
      rasterReason = err.reason ?? UNFOLLOWED;
      widthPx = raster.widthPx;
      heightPx = raster.heightPx;
    }
  } else {
    contentType = format === "png" ? "image/png" : "image/jpeg";
    let meta: Metadata;
    try {
      meta = await sharp(bytes).metadata();
    } catch {
      throw new AlbumPictureError("This file could not be read as a picture.");
    }
    // A JPEG from a camera or a phone often stores its orientation as a tag rather than in its pixels.
    // The PDF embeds pixels and ignores the tag, so a picture that looked upright here would print on
    // its side: turned once, now, and stored upright.
    if (format === "jpeg" && meta.orientation && meta.orientation > 1) {
      original = await sharp(bytes).rotate().jpeg({ quality: 95 }).toBuffer();
      meta = await sharp(original).metadata();
    }
    widthPx = meta.width ?? null;
    heightPx = meta.height ?? null;
    if (!widthPx || !heightPx) throw new AlbumPictureError("This picture states no size.");
  }

  const taken = await prisma.albumPicture.findMany({ where: { collectionId }, select: { name: true } });
  const name = albumOrnamentName(
    fileName.replace(/\.(png|jpe?g)$/i, ""),
    new Set(taken.map((t) => t.name))
  );

  const storage = getActiveStorage();
  const extension = format === "svg" ? "svg" : format === "png" ? "png" : "jpg";
  // The id is made first so the files' keys can carry it; the row names them only once the bytes are
  // in, so a row never names a file that is not there.
  const created = await prisma.$transaction(async (tx) => {
    const row = await tx.albumPicture.create({
      data: {
        collectionId,
        name,
        storageKey: "",
        storageBackend: storage.backend,
        contentType,
        sizeBytes: original.length,
        widthPx,
        heightPx,
        drawing: drawing ? (drawing as unknown as Prisma.InputJsonValue) : Prisma.DbNull,
        rasterReason,
      },
      select: { id: true },
    });
    const key = albumPictureKey(collectionId, row.id, `original.${extension}`);
    await storage.put(key, original, contentType, "work");
    let rasterKey: string | null = null;
    if (raster) {
      rasterKey = albumPictureKey(collectionId, row.id, "raster.png");
      await storage.put(rasterKey, raster.png, "image/png", "work");
    }
    return tx.albumPicture.update({
      where: { id: row.id },
      data: { storageKey: key, rasterKey },
      select: PICTURE_SELECT,
    });
  });
  return toData(toRef(created));
}

/** Where a picture is used, by name, for a refusal the collector can act on. */
async function pictureUsers(pictureId: string): Promise<string[]> {
  const [pages, printed] = await Promise.all([
    prisma.albumFreePageElement.findMany({
      where: { pictureId },
      select: { freePage: { select: { album: { select: { name: true } } } } },
    }),
    prisma.albumPrintedPagePicture.findMany({
      where: { pictureId },
      select: { printedPage: { select: { album: { select: { name: true } } } } },
    }),
  ]);
  const onPages = [...new Set(pages.map((p) => p.freePage.album.name))].sort();
  const onCards = [...new Set(printed.map((p) => p.printedPage.album.name))].sort();
  return [
    ...onPages.map((n) => `a page of "${n}"`),
    ...onCards.filter((n) => !onPages.includes(n)).map((n) => `a printed card of "${n}"`),
  ];
}

/** Delete a picture and its files. Refused, naming the albums, while a page or a card prints it. */
export async function deleteAlbumPicture(ownerId: string, pictureId: string): Promise<void> {
  const row = await prisma.albumPicture.findUnique({
    where: { id: pictureId },
    select: { collectionId: true, storageKey: true, storageBackend: true, rasterKey: true },
  });
  if (!row) throw new AlbumPictureError("That picture no longer exists.");
  await assertCollectionOwner(ownerId, row.collectionId);
  const users = await pictureUsers(pictureId);
  if (users.length > 0) {
    const named =
      users.length <= 3 ? users.join(", ") : `${users.slice(0, 3).join(", ")} and ${users.length - 3} more`;
    throw new AlbumPictureError(
      `This picture is on ${named}. Take it off the page first — a card in a binder keeps it for as long as the album knows about the card.`
    );
  }
  await prisma.albumPicture.delete({ where: { id: pictureId } });
  // The collector asked for these files to go, so they go; a failure leaves an orphan, never a row
  // pointing at nothing.
  for (const key of [row.storageKey, row.rasterKey]) {
    if (!key) continue;
    try {
      await getStorage(row.storageBackend).delete(key);
    } catch (err) {
      console.warn(`[album-pictures] could not delete ${key}: ${String(err)}`);
    }
  }
}
