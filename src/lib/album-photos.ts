import "server-only";
import { prisma } from "./db";
import { getStorage, variantKey } from "./storage";

// One picture per box (#768): which photo an album prints inside a mount, and its bytes.
//
// Split out of `album-pdf.ts` on the same seam every other renderer in this codebase is split on —
// the drawing knows nothing about Prisma, and the reading knows nothing about millimetres. It is
// also what lets #769's canvas ask the same question and get the same answer, which matters more
// than it sounds: the editor and the sheet showing different pictures for one slot would be a
// collector checking a page against a screen that is not it.
//
// ## Which photo, and why in that order
//
// The issue states it: *a box prints the photo attached to the stamp; failing that, the photo of the
// collector's own copy.* The reasoning behind that order is the same one that separates a box from a
// copy everywhere else on this track — a page is a **catalogue slot** and doubles as a want list
// (#755), so the picture belongs to the stamp, and a copy's scan is a stand-in used only where the
// catalogue side has nothing. It also means a page does not change its pictures when a duplicate is
// sold.
//
// Within each source the choice is **deterministic** and stated rather than left to the database's
// row order, because a page that quietly swaps a picture between two prints is a page the collector
// cannot check against the one in the binder: a stamp's `main` first (#137's single catalogue
// image), then its remaining photos by `sortOrder`; then a copy's `front`, then the rest, with the
// copy chosen by its own creation order so the oldest copy wins and stays winning.
//
// ## Bytes are `work`
//
// The read feeds a composition the server will be asked to repeat — reprinting one card after an
// insertion is the ordinary case, not the exception — so it populates the local cache in front of a
// remote backend (#591). That is the same answer `offer-photo-generation.ts` gives for a collage
// tile, and for the same reason.

/** A picture as the renderer needs it: the bytes, what they are, and the pixels they cover. */
export interface AlbumPhotoBytes {
  bytes: Buffer;
  mime: string;
  widthPx: number;
  heightPx: number;
}

interface PhotoRef {
  storageBackend: string;
  storageKey: string;
  mime: string;
  width: number;
  height: number;
}

/** Rank within one source: the catalogue/scan role first, then the collector's own ordering. */
function rank(role: string | null, primary: string): number {
  return role === primary ? 0 : 1;
}

/**
 * The photo each of `stampIds` prints, or nothing for a stamp that has none.
 *
 * One query per source rather than one per stamp: an album is a few thousand slots and a page is
 * rendered on demand, so a per-box lookup would be a few thousand round trips for a file the
 * collector is waiting on.
 */
export async function resolveAlbumPhotos(
  collectionId: string,
  stampIds: readonly string[]
): Promise<Map<string, PhotoRef>> {
  const out = new Map<string, PhotoRef>();
  const ids = [...new Set(stampIds)];
  if (ids.length === 0) return out;

  const select = {
    stampId: true,
    itemId: true,
    role: true,
    sortOrder: true,
    storageBackend: true,
    storageKey: true,
    mime: true,
    width: true,
    height: true,
  } as const;

  const stampPhotos = await prisma.photo.findMany({
    where: { stampId: { in: ids } },
    select,
    orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
  });

  const best = new Map<string, { key: number; photo: PhotoRef }>();
  const consider = (stampId: string, key: number, photo: PhotoRef) => {
    const held = best.get(stampId);
    if (!held || key < held.key) best.set(stampId, { key, photo });
  };

  for (const p of stampPhotos) {
    if (!p.stampId) continue;
    // A stamp's own picture always beats a copy's, so its ranks sit below the copy band.
    consider(p.stampId, rank(p.role, "main"), p);
  }

  // Only stamps with nothing of their own need the copies looked at — the common case on a mature
  // collection is that most of them do have one, and the second query then covers the remainder.
  const withoutOwn = ids.filter((id) => !best.has(id));
  if (withoutOwn.length > 0) {
    const copyPhotos = await prisma.photo.findMany({
      where: {
        item: { collectionId, stampId: { in: withoutOwn } },
      },
      select: { ...select, item: { select: { stampId: true, createdAt: true } } },
      orderBy: [{ sortOrder: "asc" }, { createdAt: "asc" }],
    });
    // The oldest copy wins, and keeps winning as duplicates come and go.
    const oldest = new Map<string, Date>();
    for (const p of copyPhotos) {
      const stampId = p.item?.stampId;
      if (!stampId) continue;
      const held = oldest.get(stampId);
      if (!held || p.item!.createdAt < held) oldest.set(stampId, p.item!.createdAt);
    }
    for (const p of copyPhotos) {
      const stampId = p.item?.stampId;
      if (!stampId) continue;
      if (p.item!.createdAt.getTime() !== oldest.get(stampId)?.getTime()) continue;
      consider(stampId, 10 + rank(p.role, "front"), p);
    }
  }

  for (const [stampId, held] of best) out.set(stampId, held.photo);
  return out;
}

/**
 * Read one resolved photo's `full` bytes.
 *
 * Through `src/lib/storage/` and never the filesystem — the standing invariant, and the reason a
 * GCS-backed collection prints the same page as a filesystem-backed one.
 */
export async function readAlbumPhotoBytes(photo: PhotoRef): Promise<AlbumPhotoBytes> {
  const object = await getStorage(photo.storageBackend).get(
    variantKey(photo.storageKey, "full", photo.mime),
    photo.mime,
    "work"
  );
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return {
    bytes: Buffer.concat(chunks),
    mime: photo.mime,
    widthPx: photo.width,
    heightPx: photo.height,
  };
}
