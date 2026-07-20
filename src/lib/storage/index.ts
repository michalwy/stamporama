import { FilesystemStorage } from "./filesystem";
import { GcsStorage } from "./gcs";
import type { PhotoVariant, Storage, StorageBackend } from "./types";

export type {
  PhotoVariant,
  Storage,
  StorageBackend,
  StorageObject,
  ResolveResult,
} from "./types";
export { dataDir, toWebStream } from "./filesystem";

const filesystem = new FilesystemStorage();

// The GCS binding is created on first use so a filesystem-only deployment never constructs a
// GCS client or needs bucket config. It's still a stable singleton once made.
//
// Pinned to `globalThis` (same pattern as the Prisma client in `db.ts`) so the instance
// survives Turbopack HMR module invalidation under `next dev`. A plain module-level `let`
// resets on every hot reload, so each recompile would build a fresh `GcsClient` — each one
// carrying its own auth client and keep-alive HTTP agents whose live sockets keep the old
// instance reachable. Over a dev session those accumulate and the heap climbs until OOM.
// In production this is just a per-process singleton, unchanged.
const globalForStorage = globalThis as unknown as { gcs?: GcsStorage };
function gcsBinding(): GcsStorage {
  if (!globalForStorage.gcs) globalForStorage.gcs = new GcsStorage();
  return globalForStorage.gcs;
}

/** All known storage bindings, keyed by the identifier persisted in `storageBackend`. GCS is
 * resolved lazily (#138) so callers stay untouched and its client isn't built unless used. */
const BINDINGS: Record<StorageBackend, () => Storage> = {
  filesystem: () => filesystem,
  gcs: gcsBinding,
};

/** The single active/configured backend that all *writes* go to, selected by
 * `STAMPORAMA_STORAGE_BACKEND` (`filesystem` default, or `gcs`). Reads still dispatch per-photo
 * by recorded `storageBackend` (write-one, read-many), so flipping this only affects new writes. */
export function getActiveStorage(): Storage {
  const configured = process.env.STAMPORAMA_STORAGE_BACKEND?.trim();
  return configured === "gcs" ? gcsBinding() : filesystem;
}

/** The binding that holds a given photo's bytes, for *reads*. Dispatches by the photo's
 * recorded `storageBackend` so photos on different backends coexist without migration. */
export function getStorage(backend: string): Storage {
  const resolve = BINDINGS[backend as StorageBackend];
  if (!resolve) throw new Error(`Unknown storage backend: ${backend}`);
  return resolve();
}

/** Log the configured active storage backend at boot and run its health-check probe. Called
 * from `instrumentation.ts`. Never throws: a failed probe is logged loudly but must not abort
 * startup (e.g. a transient GCS hiccup shouldn't take the whole app down). */
export async function logStorageStartup(): Promise<void> {
  const storage = getActiveStorage();
  console.log(`[storage] active write backend: ${storage.describe()}`);
  try {
    await storage.healthCheck();
    console.log(`[storage] health check passed (${storage.backend})`);
  } catch (err) {
    console.error(
      `[storage] health check FAILED (${storage.backend}): ${
        err instanceof Error ? err.message : String(err)
      }`
    );
  }
}

/** File extension for a stored variant, derived from its mime. Accepted upload formats only. */
export function extForMime(mime: string): string {
  switch (mime) {
    case "image/jpeg":
      return "jpg";
    case "image/png":
      return "png";
    case "image/webp":
      return "webp";
    default:
      throw new Error(`Unsupported mime for storage key: ${mime}`);
  }
}

// A photo/upload persists a `storageKey` *prefix*; the two variant files hang under it as
// `<prefix>/{full,thumb}.<ext>` (#112 variant addressing). Storing the prefix keeps the two
// derivatives addressable from the single column and lets a whole photo's bytes be moved or
// deleted as a unit.

/** Permanent prefix for a committed photo: `<collectionId>/<photoId>`. */
export function permanentPrefix(collectionId: string, photoId: string): string {
  return `${collectionId}/${photoId}`;
}

/** Staging prefix for an eager pre-Save upload: `staging/<uploadId>`. Namespaced apart from
 * permanent keys so the GC sweep and tooling can target staging alone. */
export function stagingPrefix(uploadId: string): string {
  return `staging/${uploadId}`;
}

/** The concrete key of one variant under a stored prefix: `<prefix>/{full,thumb}.<ext>`. */
export function variantKey(
  prefix: string,
  variant: PhotoVariant,
  mime: string
): string {
  return `${prefix}/${variant}.${extForMime(mime)}`;
}
