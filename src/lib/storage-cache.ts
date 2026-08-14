import "server-only";
import { prisma } from "./db";
import {
  clearStorageCacheForCollection,
  collectionStorageCacheBytes,
  getActiveStorage,
  storageCacheUsage,
  type StorageCacheSweep,
} from "./storage";

/**
 * The collection-scoped face of the local storage cache (#591) — what Settings reads and what its
 * Clear button calls.
 *
 * The authorization check lives here rather than in `src/lib/storage/`, the same way `photos.ts`
 * holds it for photo bytes: the storage layer answers about objects and knows nothing about who is
 * asking, and ADR-0011's whole point is that callers never learn where the bytes are.
 *
 * The figure it reports is deliberately **not** part of the collection's photo-storage total. They
 * answer different questions and one of them is reclaimable: the storage figure is *how much of the
 * collector's data is being held*, and this is *how much disk this instance is using as scratch*.
 * Summing them would tell an operator that deleting scans is the way to recover space the cache
 * would have given back on its own.
 */

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

/** What the Settings line shows. `active` is false on the filesystem backend, where the cache is a
 * no-op because the bytes are already local, and when an operator has set the cap to zero. */
export interface StorageCacheStatus {
  active: boolean;
  /** Held by the whole instance — the cache is global, because the disk it protects is. */
  bytes: number;
  /** This collection's share of that figure. The cap stays whole; only the breakdown is split. */
  collectionBytes: number;
  /** The instance's cap, in bytes. */
  maxBytes: number;
  entries: number;
}

export async function getStorageCacheStatus(
  ownerId: string,
  collectionId: string
): Promise<StorageCacheStatus> {
  await assertCollectionOwner(ownerId, collectionId);
  const usage = await storageCacheUsage();
  const collectionBytes = await collectionStorageCacheBytes(collectionId);
  return {
    active: getActiveStorage().backend !== "filesystem" && usage.maxBytes > 0,
    bytes: usage.bytes,
    collectionBytes,
    maxBytes: usage.maxBytes,
    entries: usage.entries,
  };
}

/**
 * Empty this collection's share of the cache. Per collection because that is the surface a
 * collector is standing on, and it costs no partitioning to offer: keys are collection-scoped
 * (ADR-0011), so it is a delete by prefix.
 *
 * Safe by construction — every object in the cache is re-fetchable, that being what makes it a
 * cache — so this needs none of the confirmation a deletion of the collector's own bytes does.
 */
export async function clearCollectionStorageCache(
  ownerId: string,
  collectionId: string
): Promise<StorageCacheSweep> {
  await assertCollectionOwner(ownerId, collectionId);
  return clearStorageCacheForCollection(collectionId);
}
