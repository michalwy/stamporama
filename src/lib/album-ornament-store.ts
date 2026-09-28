import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { getActiveStorage, getStorage, ornamentKey } from "./storage";
import { assertCollectionOwner } from "./platform-category";
import {
  AlbumOrnamentSvgError,
  MAX_ORNAMENT_SVG_BYTES,
  readOrnamentSvg,
  type AlbumOrnamentDrawing,
} from "./album-ornament-svg";
import {
  NO_FRAME_ORNAMENT,
  albumBuiltinOrnament,
  albumOrnamentName,
  isAlbumUploadedOrnamentId,
} from "./album-ornaments";

// The collector's own corner ornaments (#1427), and the one resolver from a preset's
// `frameOrnament` to the drawing a sheet prints.
//
// An upload is **read once**, here, into a drawing (`album-ornament-svg.ts`), and the drawing is
// what is stored beside the file and what everything downstream draws. A file this reader refuses
// is refused at the upload, with the reason, rather than accepted and found wanting on a card.
//
// A row is **never changed** once written: a template or an album names it by id, so replacing its
// drawing would change what a live page prints with nothing to say so. Deleting one is refused while
// a template or an album names it — the album's own copy of its preset is what the page is printed
// from, and it would be left naming nothing. A card already in a binder is unaffected either way: it
// copied the drawing into its snapshot (ADR-0047 §1).

/** Thrown for an upload or a deletion the collector has to change something about. */
export class AlbumOrnamentError extends Error {}

export interface AlbumOrnamentData {
  id: string;
  name: string;
  drawing: AlbumOrnamentDrawing;
}

export async function getAlbumOrnaments(
  ownerId: string,
  collectionId: string
): Promise<AlbumOrnamentData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.albumOrnament.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, drawing: true },
  });
  return rows.map((r) => ({ ...r, drawing: r.drawing as unknown as AlbumOrnamentDrawing }));
}

/**
 * Read an SVG file into an ornament and keep it. Returns the new row. Throws
 * {@link AlbumOrnamentError} with the reader's own reason for a file it will not take.
 */
export async function uploadAlbumOrnament(
  ownerId: string,
  collectionId: string,
  fileName: string,
  bytes: Buffer
): Promise<AlbumOrnamentData> {
  await assertCollectionOwner(ownerId, collectionId);
  if (bytes.length > MAX_ORNAMENT_SVG_BYTES) {
    throw new AlbumOrnamentError("This file is too large to be a corner ornament (1 MB at most).");
  }
  let drawing: AlbumOrnamentDrawing;
  try {
    drawing = readOrnamentSvg(bytes.toString("utf8"));
  } catch (err) {
    if (err instanceof AlbumOrnamentSvgError) throw new AlbumOrnamentError(err.message);
    throw err;
  }

  const taken = await prisma.albumOrnament.findMany({
    where: { collectionId },
    select: { name: true },
  });
  const name = albumOrnamentName(fileName, new Set(taken.map((t) => t.name)));

  // The id is made first so the file's key can carry it; the row is written only once the bytes are
  // in, so a row never names a file that is not there.
  const storage = getActiveStorage();
  const row = await prisma.$transaction(async (tx) => {
    const created = await tx.albumOrnament.create({
      data: {
        collectionId,
        name,
        storageKey: "",
        storageBackend: storage.backend,
        sizeBytes: bytes.length,
        drawing: drawing as unknown as Prisma.InputJsonValue,
      },
      select: { id: true },
    });
    const key = ornamentKey(collectionId, created.id);
    await storage.put(key, bytes, "image/svg+xml", "work");
    await tx.albumOrnament.update({ where: { id: created.id }, data: { storageKey: key } });
    return created;
  });
  return { id: row.id, name, drawing };
}

/** Where a template or an album names the ornament, by name, for a refusal the collector can act on. */
async function ornamentUsers(collectionId: string, ornamentId: string): Promise<string[]> {
  const [templates, albums] = await Promise.all([
    prisma.albumTemplate.findMany({
      where: { collectionId, frameOrnament: ornamentId },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
    prisma.album.findMany({
      where: { collectionId, frameOrnament: ornamentId },
      select: { name: true },
      orderBy: { name: "asc" },
    }),
  ]);
  return [
    ...templates.map((t) => `the template "${t.name}"`),
    ...albums.map((a) => `the album "${a.name}"`),
  ];
}

/** Delete an uploaded ornament and its file. Refused, naming them, while a template or an album
 *  uses it. */
export async function deleteAlbumOrnament(ownerId: string, ornamentId: string): Promise<void> {
  const row = await prisma.albumOrnament.findUnique({
    where: { id: ornamentId },
    select: { collectionId: true, storageKey: true, storageBackend: true },
  });
  if (!row) throw new AlbumOrnamentError("That ornament no longer exists.");
  await assertCollectionOwner(ownerId, row.collectionId);
  const users = await ornamentUsers(row.collectionId, ornamentId);
  if (users.length > 0) {
    const named = users.length <= 3 ? users.join(", ") : `${users.slice(0, 3).join(", ")} and ${users.length - 3} more`;
    throw new AlbumOrnamentError(
      `This ornament is used by ${named}. Choose another frame there first — printed cards keep theirs either way.`
    );
  }
  await prisma.albumOrnament.delete({ where: { id: ornamentId } });
  // The collector asked for this file to go, so it goes; a failure leaves an orphan, never a row
  // pointing at nothing.
  try {
    if (row.storageKey) await getStorage(row.storageBackend).delete(row.storageKey);
  } catch (err) {
    console.warn(`[album-ornaments] could not delete ${row.storageKey}: ${String(err)}`);
  }
}

/**
 * The drawing a preset's `frameOrnament` names, for a sheet about to be drawn — null for a frame
 * without one, **and** for an uploaded ornament that is not this collection's. The caller that
 * prints tells those two apart (`album-pdf.ts` refuses the second); a screen draws the frame without
 * it.
 */
export async function resolveAlbumFrameOrnament(
  collectionId: string,
  key: string
): Promise<AlbumOrnamentDrawing | null> {
  if (key === NO_FRAME_ORNAMENT) return null;
  const builtin = albumBuiltinOrnament(key);
  if (builtin) return builtin;
  if (!isAlbumUploadedOrnamentId(key)) return null;
  const row = await prisma.albumOrnament.findFirst({
    where: { id: key, collectionId },
    select: { drawing: true },
  });
  return row ? (row.drawing as unknown as AlbumOrnamentDrawing) : null;
}

/** Refuse a save that names an uploaded ornament the collection does not have. The parser has
 *  checked the value's shape; this is the half only the database can answer. */
export async function assertAlbumFrameOrnament(collectionId: string, key: string): Promise<void> {
  if (!isAlbumUploadedOrnamentId(key)) return;
  const found = await prisma.albumOrnament.count({ where: { id: key, collectionId } });
  if (found === 0) throw new AlbumOrnamentError("That corner ornament is no longer in the collection.");
}
