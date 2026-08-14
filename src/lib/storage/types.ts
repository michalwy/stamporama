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

/** Which stored derivative of a retained **scan sheet** to address (#566, ADR-0033). A closed
 * union of its own rather than two more members on `PhotoVariant`: a sheet is not a photo, and
 * `original` in particular is a promise no photo makes — the upload's own bytes, never resampled,
 * because the cut is taken from them and a stockbook cannot be re-scanned once broken up. `view`
 * is the `FULL_MAX_EDGE`-capped derivative the review editor displays. */
export type SheetVariant = "original" | "view";

/** Identifier of a storage binding, persisted per-photo in `storageBackend`. */
export type StorageBackend = "filesystem" | "gcs";

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

/** A storage binding. Two implementations: filesystem and GCS (#138); reads dispatch per-photo
 * so both coexist, and either can be the active write backend. */
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
  /** One-line, non-secret summary of this binding's effective config, for the startup log. */
  describe(): string;
  /** Quick connectivity/writability probe run at boot. Resolves if the backend looks usable;
   * throws (with a human-readable reason) otherwise. Must be cheap — no full object round-trip. */
  healthCheck(): Promise<void>;
}
