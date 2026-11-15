import "server-only";
import { prisma } from "./db";
import { getStorage, variantKey } from "./storage";
import { FULL_MAX_EDGE, REDUCED_MAX_EDGE, isAcceptedMime, reduceImage } from "./photos/process";
import { TRADED_AWAY, TRADED_AWAY_LINE } from "./trade-exit";
import {
  copyDepartedAt,
  departedCopyPhotoCutoff,
  isPhotoReductionDue,
} from "./departed-copy-photo-rules";
import { resolveDepartedCopyPhotoTtlMs } from "./departed-copy-photo-retention";

// The reduction of a departed copy's photos (#2547) — the fourth periodic sweep beside the photo
// staging GC (#112), the closed-offer purge (#512) and the card-scan sweep (#578). The rules (the
// period, when a copy left, whether it is due) are pure, in `departed-copy-photo-rules.ts`.
//
// A copy has **left** when it is on a sale (a cancelled one has deleted its lines, #2500), given away
// in a closed trade (#644), or marked no longer held (#394). The departure is read afresh on every
// pass, so a copy that comes back before its period ends is simply held again and keeps its photos;
// one that comes back later keeps the reduced photo, since nothing reduced can be restored.

/** What one pass did, for the log line. */
export interface DepartedCopyPhotoReduction {
  /** Photos reduced this pass. */
  photos: number;
  /** Copies those photos belong to. */
  copies: number;
  /** Bytes the full-resolution `full` derivatives took, less what the reduced ones take. */
  bytes: number;
}

/** The suffix a reduced photo's new storage prefix carries. A new prefix rather than an overwrite in
 * place: the row moves to the new bytes in one write, so a pass that fails half-way leaves the photo
 * whole at either size, never a row pointing at bytes being rewritten. */
const REDUCED_PREFIX_SUFFIX = "-reduced";

/**
 * Reduce the photos of every copy that left longer ago than its collection's period (#2547).
 *
 * Resolved **per collection**, a pass per collection, like the other retention sweeps. `only` narrows
 * the pass to one copy, for test isolation; the boot path passes nothing.
 */
export async function reduceDepartedCopyPhotos(
  now: Date = new Date(),
  only?: { itemId: string }
): Promise<DepartedCopyPhotoReduction> {
  const result: DepartedCopyPhotoReduction = { photos: 0, copies: 0, bytes: 0 };

  const collections = await prisma.collection.findMany({
    select: { id: true, departedCopyPhotoTtlDays: true },
  });

  for (const collection of collections) {
    const cutoff = departedCopyPhotoCutoff(
      now,
      resolveDepartedCopyPhotoTtlMs(collection.departedCopyPhotoTtlDays)
    );
    if (!cutoff) continue;

    const items = await prisma.item.findMany({
      where: {
        ...(only ? { id: only.itemId } : {}),
        collectionId: collection.id,
        photos: { some: { reducedAt: null } },
        OR: [{ saleLineItems: { some: {} } }, TRADED_AWAY, { disposedAt: { not: null } }],
      },
      select: {
        id: true,
        disposedAt: true,
        saleLineItems: { select: { saleLine: { select: { sale: { select: { soldAt: true } } } } } },
        tradeLines: { where: TRADED_AWAY_LINE, select: { trade: { select: { closedAt: true } } } },
        photos: {
          where: { reducedAt: null },
          select: {
            id: true,
            storageBackend: true,
            storageKey: true,
            mime: true,
            width: true,
            height: true,
            originalWidth: true,
            originalHeight: true,
            sizeBytes: true,
          },
        },
      },
    });

    for (const item of items) {
      const departedAt = copyDepartedAt({
        soldAt: item.saleLineItems.map((l) => l.saleLine.sale.soldAt),
        tradeClosedAt: item.tradeLines.map((l) => l.trade.closedAt),
        disposedAt: item.disposedAt,
      });
      if (!isPhotoReductionDue(departedAt, cutoff)) continue;

      let reducedAny = false;
      for (const photo of item.photos) {
        try {
          const freed = await reducePhoto(photo, now);
          if (freed === null) continue;
          reducedAny = true;
          result.photos += 1;
          result.bytes += freed;
        } catch (err) {
          // One photo that cannot be read or written is logged and left at full size; the next pass
          // tries it again, and the rest of the pass goes on.
          console.error(`[copy-photos] could not reduce photo ${photo.id}`, err);
        }
      }
      if (reducedAny) result.copies += 1;
    }
  }

  return result;
}

interface ReduciblePhoto {
  id: string;
  storageBackend: string;
  storageKey: string;
  mime: string;
  width: number;
  height: number;
  originalWidth: number | null;
  originalHeight: number | null;
  sizeBytes: number;
}

/**
 * Reduce one photo, returning the bytes freed, or `null` when it was left alone.
 *
 * Left alone: a photo whose bytes another photo row also points at — one still used elsewhere, such
 * as by a copy that is held, keeps its full resolution (#2547) — and one changed by somebody else
 * while this pass was reading it.
 */
async function reducePhoto(photo: ReduciblePhoto, now: Date): Promise<number | null> {
  const shared = await prisma.photo.count({
    where: {
      id: { not: photo.id },
      storageBackend: photo.storageBackend,
      storageKey: photo.storageKey,
    },
  });
  if (shared > 0) return null;

  // A photo with no recorded original size whose `full` is under the cap was never downscaled, so
  // that size *is* the upload's — recorded now, before `width`/`height` become the reduced photo's,
  // so measuring and collage scaling keep the frame they had. One at the cap stays unknown, and
  // `photoMeasureFrame` reads a reduced photo with no original as having none.
  const originals =
    photo.originalWidth == null &&
    photo.originalHeight == null &&
    Math.max(photo.width, photo.height) < FULL_MAX_EDGE
      ? { originalWidth: photo.width, originalHeight: photo.height }
      : {};

  // Already at most the reduced size — or in a format the pipeline does not re-encode: its bytes are
  // the reduced photo, and only the row says so.
  if (!isAcceptedMime(photo.mime) || Math.max(photo.width, photo.height) <= REDUCED_MAX_EDGE) {
    const marked = await prisma.photo.updateMany({
      where: { id: photo.id, storageKey: photo.storageKey, reducedAt: null },
      data: { reducedAt: now, ...originals },
    });
    return marked.count === 0 ? null : 0;
  }

  const storage = getStorage(photo.storageBackend);
  const fullKey = variantKey(photo.storageKey, "full", photo.mime);
  const object = await storage.get(fullKey, photo.mime, "work");
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
  const reduced = await reduceImage(Buffer.concat(chunks), photo.mime);

  const newPrefix = `${photo.storageKey}${REDUCED_PREFIX_SUFFIX}`;
  const newFull = variantKey(newPrefix, "full", reduced.mime);
  const newThumb = variantKey(newPrefix, "thumb", reduced.mime);
  await storage.put(newFull, reduced.buffer, reduced.mime, "work");
  await storage.copy(variantKey(photo.storageKey, "thumb", photo.mime), newThumb);

  // The row moves to the new bytes in one conditional write: a photo edited, turned or deleted
  // meanwhile is not overwritten, and the new bytes go again instead.
  const moved = await prisma.photo.updateMany({
    where: { id: photo.id, storageKey: photo.storageKey, reducedAt: null },
    data: {
      storageKey: newPrefix,
      mime: reduced.mime,
      width: reduced.width,
      height: reduced.height,
      sizeBytes: reduced.buffer.byteLength,
      reducedAt: now,
      ...originals,
    },
  });
  if (moved.count === 0) {
    await Promise.all([storage.delete(newFull), storage.delete(newThumb)].map((p) => p.catch(() => {})));
    return null;
  }

  // After the row, so a failure here leaves at worst unreferenced bytes, never a row pointing at none.
  await Promise.all(
    (["full", "thumb"] as const).map((v) =>
      storage.delete(variantKey(photo.storageKey, v, photo.mime)).catch(() => {})
    )
  );
  return Math.max(0, photo.sizeBytes - reduced.buffer.byteLength);
}

/**
 * When this copy's photos were reduced (#2547) — the latest, if more than one was — or null when none
 * was. What the copy's Photos card says. Scoped to the collection like every copy read.
 */
export async function getCopyPhotosReducedAt(
  collectionId: string,
  itemId: string
): Promise<string | null> {
  const row = await prisma.photo.aggregate({
    where: { itemId, item: { collectionId }, reducedAt: { not: null } },
    _max: { reducedAt: true },
  });
  return row._max.reducedAt?.toISOString() ?? null;
}
