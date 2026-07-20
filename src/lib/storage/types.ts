import type { Readable } from "node:stream";

// Storage abstraction for photo bytes (#112, ADR-0011). Two seams are locked in so a future
// GCS binding is purely additive:
//   1. Async + streaming — every method is `async` and reads/writes streams, never assuming
//      the whole object fits in a Buffer.
//   2. `resolveUrl` returns a discriminated result — `stream` (filesystem streams bytes
//      through the collection-scoped route) vs `redirect` (a GCS binding mints a short-lived
//      signed URL so bytes bypass the app). The serving route handles both.
// Writes always target the single active/configured backend (`getActiveStorage`); reads
// dispatch per-photo by its recorded `storageBackend` (`getStorage`), so photos can live on
// different backends simultaneously with no forced migration (write-one, read-many).

/** Which stored derivative to address. Both are written eagerly at upload time. */
export type PhotoVariant = "full" | "thumb";

/** Identifier of a storage binding, persisted per-photo in `storageBackend`. */
export type StorageBackend = "filesystem";

/** Bytes to write, as a stream or a materialized buffer. */
export type StorageInput = Buffer | Readable;

/** A readable handle to stored bytes plus the metadata the serving route needs. */
export interface StorageObject {
  stream: Readable;
  sizeBytes: number;
  mime: string;
}

/** Result of {@link Storage.resolveUrl}. `stream` means the app must stream the bytes itself
 * (filesystem); `redirect` means send the client to a pre-authorized URL (future GCS signed
 * URL) so bytes bypass the app. */
export type ResolveResult =
  | { kind: "stream"; object: StorageObject }
  | { kind: "redirect"; url: string };

/** A storage binding. Filesystem is the only implementation today; GCS is the planned second
 * binding (#138) and must slot in without touching callers. */
export interface Storage {
  readonly backend: StorageBackend;
  /** Write bytes at `key`, creating any intermediate structure. Overwrites if present. */
  put(key: string, input: StorageInput, mime: string): Promise<void>;
  /** Open the bytes at `key` for reading. Throws if absent. */
  get(key: string, mime: string): Promise<StorageObject>;
  /** Delete the bytes at `key`. Best-effort: absent keys are a no-op, not an error. */
  delete(key: string): Promise<void>;
  /** Move bytes from one key to another within this backend (staging → permanent). On
   * filesystem this is a cheap rename; a future GCS binding pays a server-side-copy cost. */
  move(fromKey: string, toKey: string): Promise<void>;
  /** Resolve how the serving route should hand `key` to a client. */
  resolveUrl(key: string, mime: string): Promise<ResolveResult>;
}
