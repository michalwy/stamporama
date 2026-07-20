import { FilesystemStorage } from "./filesystem";
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

/** All known storage bindings, keyed by the identifier persisted in `storageBackend`.
 * Adding GCS (#138) means adding one entry here — callers are untouched. */
const BINDINGS: Record<StorageBackend, Storage> = {
  filesystem,
};

/** The single active/configured backend that all *writes* go to. Filesystem today; when GCS
 * lands this becomes config-driven, but reads keep dispatching per-photo (write-one, read-many). */
export function getActiveStorage(): Storage {
  return filesystem;
}

/** The binding that holds a given photo's bytes, for *reads*. Dispatches by the photo's
 * recorded `storageBackend` so photos on different backends coexist without migration. */
export function getStorage(backend: string): Storage {
  const binding = BINDINGS[backend as StorageBackend];
  if (!binding) throw new Error(`Unknown storage backend: ${backend}`);
  return binding;
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
