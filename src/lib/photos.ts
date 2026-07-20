import "server-only";
import { randomUUID } from "node:crypto";
import { prisma } from "./db";
import {
  getActiveStorage,
  getStorage,
  permanentPrefix,
  stagingPrefix,
  variantKey,
  type PhotoVariant,
} from "./storage";
import {
  MAX_UPLOAD_BYTES,
  isAcceptedMime,
  processImage,
  UnsupportedImageError,
} from "./photos/process";

// Server-side photo domain for inventory copies (#112, ADR-0011). Collection-scoped
// throughout; owner checks live here, never in UI. Bytes are handled via the storage
// interface — this module is the only place that reconciles `Photo`/`PhotoUpload` rows with
// stored bytes so there are never orphaned files.

/** Reserved single-image slots plus the null "extra" role. */
export type PhotoRole = "front" | "back" | null;

const VALID_ROLES = new Set(["front", "back"]);

function normalizeRole(role: unknown): PhotoRole {
  return typeof role === "string" && VALID_ROLES.has(role)
    ? (role as "front" | "back")
    : null;
}

/** Display-facing photo metadata (no bytes). The serving route addresses variants by id. */
export interface PhotoData {
  id: string;
  itemId: string;
  role: PhotoRole;
  title: string | null;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
  sortOrder: number;
  createdAt: Date;
}

/** Lightweight photo shape carried on list/popup rows for thumbnail display (#110). */
export interface PhotoSummary {
  id: string;
  role: PhotoRole;
  title: string | null;
  sortOrder: number;
}

/** What `stageUpload` returns to the dialog: enough to preview + reference the staged bytes
 * in the pending change-set. */
export interface StagedUpload {
  id: string;
  mime: string;
  width: number;
  height: number;
  sizeBytes: number;
}

/** The dialog's pending change-set, applied atomically on Save. Staged uploads to add (with
 * intended role/title/order), plus role/title/order changes and removals of already-committed
 * photos. Nothing touches `Photo` until Save. */
export interface PhotoChangeSet {
  add: {
    uploadId: string;
    role: PhotoRole;
    title: string | null;
    sortOrder: number;
  }[];
  update: {
    photoId: string;
    role?: PhotoRole;
    title?: string | null;
    sortOrder?: number;
  }[];
  remove: string[];
}

export class PhotoAuthError extends Error {}
export class PhotoValidationError extends Error {}

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new PhotoAuthError("Collection not found or access denied.");
  }
}

async function resolveItemCollection(itemId: string): Promise<string> {
  const item = await prisma.item.findUnique({
    where: { id: itemId },
    select: { collectionId: true },
  });
  if (!item) throw new PhotoAuthError("Item not found.");
  return item.collectionId;
}

/** Delete both stored variants under a photo/upload prefix, best-effort. Never throws — byte
 * cleanup must not block a delete/GC path (orphan bytes are the failure we tolerate least, so
 * we try, but a missing file is fine). */
async function deleteVariants(
  backend: string,
  storageKey: string,
  mime: string
): Promise<void> {
  const storage = getStorage(backend);
  const variants: PhotoVariant[] = ["full", "thumb"];
  await Promise.all(
    variants.map((v) =>
      storage.delete(variantKey(storageKey, v, mime)).catch(() => {})
    )
  );
}

/** Stage an eager, pre-Save upload (#112). Validates format + size, processes with `sharp`,
 * writes `full` + `thumb` to the active backend under a staging key, then records the
 * `PhotoUpload` row. Bytes are written before the row is finalized; a failed write best-effort
 * deletes any bytes so nothing dangles. */
export async function stageUpload(
  ownerId: string,
  collectionId: string,
  file: { bytes: Buffer; mime: string }
): Promise<StagedUpload> {
  await assertCollectionOwner(ownerId, collectionId);

  if (!isAcceptedMime(file.mime)) {
    throw new PhotoValidationError(
      "Unsupported image type. Use JPEG, PNG, or WebP."
    );
  }
  if (file.bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new PhotoValidationError("Image is too large (max 15 MB).");
  }

  let processed;
  try {
    processed = await processImage(file.bytes, file.mime);
  } catch (err) {
    if (err instanceof UnsupportedImageError) {
      throw new PhotoValidationError(err.message);
    }
    throw err;
  }

  const id = randomUUID();
  const prefix = stagingPrefix(id);
  const mime = processed.full.mime;
  const storage = getActiveStorage();

  try {
    await storage.put(
      variantKey(prefix, "full", mime),
      processed.full.buffer,
      mime
    );
    await storage.put(
      variantKey(prefix, "thumb", mime),
      processed.thumb.buffer,
      mime
    );
  } catch (err) {
    await deleteVariants(storage.backend, prefix, mime);
    throw err;
  }

  const sizeBytes = processed.full.buffer.byteLength;
  try {
    await prisma.photoUpload.create({
      data: {
        id,
        collectionId,
        storageBackend: storage.backend,
        storageKey: prefix,
        mime,
        width: processed.full.width,
        height: processed.full.height,
        sizeBytes,
      },
    });
  } catch (err) {
    await deleteVariants(storage.backend, prefix, mime);
    throw err;
  }

  return {
    id,
    mime,
    width: processed.full.width,
    height: processed.full.height,
    sizeBytes,
  };
}

/** Apply the dialog's pending change-set to an item in one logical Save (#112). Removals and
 * updates are validated against the item's own photos; adds consume staged uploads from the
 * same collection. Front/back stay singletons: an add into an occupied slot replaces the
 * incumbent. Staged bytes are moved to the permanent `<collectionId>/<photoId>` prefix before
 * the DB writes commit, so committed rows always reference existing bytes. */
export async function applyPhotoChangeSet(
  ownerId: string,
  itemId: string,
  changeSet: PhotoChangeSet
): Promise<void> {
  const collectionId = await resolveItemCollection(itemId);
  await assertCollectionOwner(ownerId, collectionId);

  const existing = await prisma.photo.findMany({
    where: { itemId },
    select: {
      id: true,
      role: true,
      storageBackend: true,
      storageKey: true,
      mime: true,
    },
  });
  const existingById = new Map(existing.map((p) => [p.id, p]));

  // --- Validate references up front (fail before touching bytes) ---
  for (const photoId of changeSet.remove) {
    if (!existingById.has(photoId)) {
      throw new PhotoValidationError("Photo not found on this item.");
    }
  }
  for (const u of changeSet.update) {
    if (!existingById.has(u.photoId)) {
      throw new PhotoValidationError("Photo not found on this item.");
    }
  }
  const uploads =
    changeSet.add.length > 0
      ? await prisma.photoUpload.findMany({
          where: {
            id: { in: changeSet.add.map((a) => a.uploadId) },
            collectionId,
          },
        })
      : [];
  const uploadById = new Map(uploads.map((u) => [u.id, u]));
  for (const a of changeSet.add) {
    if (!uploadById.has(a.uploadId)) {
      throw new PhotoValidationError("Staged upload not found or expired.");
    }
  }

  // Removals: explicit list plus any front/back incumbent displaced by an add into its slot
  // (replace semantics) that the client did not already remove.
  const removeIds = new Set(changeSet.remove);
  const reassignedRoles = new Map(
    changeSet.update
      .filter((u) => u.role !== undefined)
      .map((u) => [u.photoId, normalizeRole(u.role)])
  );
  const roleAfterUpdate = (p: { id: string; role: string | null }): PhotoRole =>
    reassignedRoles.has(p.id)
      ? (reassignedRoles.get(p.id) as PhotoRole)
      : normalizeRole(p.role);

  for (const a of changeSet.add) {
    const role = normalizeRole(a.role);
    if (role === null) continue;
    for (const p of existing) {
      if (removeIds.has(p.id)) continue;
      if (roleAfterUpdate(p) === role) removeIds.add(p.id);
    }
  }

  // Pre-move staged bytes to permanent keys (fs side effects live outside the txn, which
  // cannot roll them back). Each add gets a pre-generated photo id so its permanent prefix is
  // known before the move.
  const prepared = changeSet.add.map((a) => {
    const upload = uploadById.get(a.uploadId)!;
    const photoId = randomUUID();
    return {
      add: a,
      upload,
      photoId,
      role: normalizeRole(a.role),
      toPrefix: permanentPrefix(collectionId, photoId),
    };
  });

  for (const p of prepared) {
    const storage = getStorage(p.upload.storageBackend);
    for (const v of ["full", "thumb"] as PhotoVariant[]) {
      await storage.move(
        variantKey(p.upload.storageKey, v, p.upload.mime),
        variantKey(p.toPrefix, v, p.upload.mime)
      );
    }
  }

  // Bytes of removed photos, deleted after a successful commit.
  const bytesToDelete = [...removeIds]
    .map((id) => existingById.get(id))
    .filter((p): p is NonNullable<typeof p> => !!p)
    .map((p) => ({
      backend: p.storageBackend,
      storageKey: p.storageKey,
      mime: p.mime,
    }));

  await prisma.$transaction(async (tx) => {
    if (removeIds.size > 0) {
      await tx.photo.deleteMany({ where: { id: { in: [...removeIds] } } });
    }
    // Front/back are singleton roles (the `(itemId, role)` unique index). When photos swap
    // roles, applying updates one by one could transiently give two rows the same role and
    // trip the constraint. Clear every role-changing photo's role first, then set finals.
    for (const u of changeSet.update) {
      if (removeIds.has(u.photoId)) continue;
      if (u.role !== undefined) {
        await tx.photo.update({ where: { id: u.photoId }, data: { role: null } });
      }
    }
    for (const u of changeSet.update) {
      if (removeIds.has(u.photoId)) continue; // displaced/removed — skip stale update
      await tx.photo.update({
        where: { id: u.photoId },
        data: {
          ...(u.role !== undefined ? { role: normalizeRole(u.role) } : {}),
          ...(u.title !== undefined ? { title: u.title } : {}),
          ...(u.sortOrder !== undefined ? { sortOrder: u.sortOrder } : {}),
        },
      });
    }
    for (const p of prepared) {
      await tx.photo.create({
        data: {
          id: p.photoId,
          itemId,
          role: p.role,
          title: p.role === null ? p.add.title : null,
          storageBackend: p.upload.storageBackend,
          storageKey: p.toPrefix,
          mime: p.upload.mime,
          width: p.upload.width,
          height: p.upload.height,
          sizeBytes: p.upload.sizeBytes,
          sortOrder: p.add.sortOrder,
        },
      });
    }
    if (prepared.length > 0) {
      await tx.photoUpload.deleteMany({
        where: { id: { in: prepared.map((p) => p.upload.id) } },
      });
    }
  });

  // Post-commit best-effort byte cleanup for removed photos.
  await Promise.all(
    bytesToDelete.map((b) => deleteVariants(b.backend, b.storageKey, b.mime))
  );
}

const ROLE_ORDER: Record<string, number> = { front: 0, back: 1 };

/** All photos on a copy, ordered front, back, then extras by `sortOrder` (#112 display). */
export async function listItemPhotos(
  ownerId: string,
  itemId: string
): Promise<PhotoData[]> {
  const collectionId = await resolveItemCollection(itemId);
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.photo.findMany({ where: { itemId } });
  return rows
    .map((r) => ({
      id: r.id,
      itemId: r.itemId,
      role: normalizeRole(r.role),
      title: r.title,
      mime: r.mime,
      width: r.width,
      height: r.height,
      sizeBytes: r.sizeBytes,
      sortOrder: r.sortOrder,
      createdAt: r.createdAt,
    }))
    .sort(sortPhotos);
}

/** Shared front→back→extras(by sortOrder) ordering for photo lists. */
export function sortPhotos(
  a: { role: PhotoRole; sortOrder: number },
  b: { role: PhotoRole; sortOrder: number }
): number {
  const ra = a.role ? ROLE_ORDER[a.role] : 2;
  const rb = b.role ? ROLE_ORDER[b.role] : 2;
  if (ra !== rb) return ra - rb;
  return a.sortOrder - b.sortOrder;
}

/** Resolve a committed photo for the serving route: its owning collection + owner (for the
 * auth check) plus the bytes address. Returns null when the photo does not exist. */
export async function getPhotoForServing(photoId: string): Promise<{
  collectionId: string;
  ownerId: string;
  storageBackend: string;
  storageKey: string;
  mime: string;
} | null> {
  const photo = await prisma.photo.findUnique({
    where: { id: photoId },
    select: {
      storageBackend: true,
      storageKey: true,
      mime: true,
      item: { select: { collectionId: true, collection: { select: { ownerId: true } } } },
    },
  });
  if (!photo) return null;
  return {
    collectionId: photo.item.collectionId,
    ownerId: photo.item.collection.ownerId,
    storageBackend: photo.storageBackend,
    storageKey: photo.storageKey,
    mime: photo.mime,
  };
}

/** Delete all stored bytes for an item's photos. Called before deleting the `Item` — Prisma
 * cascade drops the `Photo` rows, but not the files (#112 byte cleanup on delete). */
export async function deletePhotoBytesForItem(itemId: string): Promise<void> {
  const rows = await prisma.photo.findMany({
    where: { itemId },
    select: { storageBackend: true, storageKey: true, mime: true },
  });
  await Promise.all(
    rows.map((r) => deleteVariants(r.storageBackend, r.storageKey, r.mime))
  );
}

/** Default orphan-GC TTL: staged uploads not attached within this window are swept. A few
 * hours by default, overridable via `STAMPORAMA_PHOTO_UPLOAD_TTL_HOURS`. */
export function uploadTtlMs(): number {
  const raw = process.env.STAMPORAMA_PHOTO_UPLOAD_TTL_HOURS?.trim();
  const hours = raw ? Number(raw) : NaN;
  return (Number.isFinite(hours) && hours > 0 ? hours : 3) * 60 * 60 * 1000;
}

/** Orphan-GC sweep (#112): delete `PhotoUpload` rows older than the TTL and their bytes. The
 * only cleanup path for abandoned drops. Idempotent — safe to run concurrently. Returns how
 * many rows were swept. `now` is injectable for tests. */
export async function gcStaleUploads(now: number = Date.now()): Promise<number> {
  const cutoff = new Date(now - uploadTtlMs());
  const stale = await prisma.photoUpload.findMany({
    where: { createdAt: { lt: cutoff } },
    select: { id: true, storageBackend: true, storageKey: true, mime: true },
  });
  if (stale.length === 0) return 0;
  await Promise.all(
    stale.map((u) => deleteVariants(u.storageBackend, u.storageKey, u.mime))
  );
  const { count } = await prisma.photoUpload.deleteMany({
    where: { id: { in: stale.map((u) => u.id) } },
  });
  return count;
}
