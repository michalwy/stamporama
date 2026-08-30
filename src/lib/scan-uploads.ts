import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { prisma } from "./db";
import { dataDir } from "./storage";
import { isAcceptedMime, MAX_UPLOAD_BYTES } from "./photos/process";
import { uploadTtlMs } from "./photos";
import {
  assertScanOwner,
  ScanAuthError,
  ScanValidationError,
  uploadSheet,
  type ScanOwnerRef,
  type SheetSide,
  type UploadedSheet,
} from "./scan-sheets";
import { chunkCount, chunkRange, resolveUploadChunkBytes } from "./upload-chunk-rules";

/**
 * A card scan uploaded in **parts** (#590).
 *
 * A 1200 dpi stockbook card is 100–200 MB and never reached the app: Cloudflare caps a request body
 * at 100 MB and nginx defaults `client_max_body_size` to 1 MB, so `MAX_UPLOAD_BYTES` — the app's own
 * judgement that a card may weigh 200 MB — was a promise no ordinary deployment could keep. It
 * stays exactly where it is; what changes is that the bytes now arrive in pieces small enough that
 * the proxy in front of the app has no opinion about them.
 *
 * Four decisions this module is arranged around.
 *
 * **The parts never go to the storage backend.** They are written under `STAMPORAMA_DATA_DIR`
 * directly, whatever `STAMPORAMA_STORAGE_BACKEND` says. A chunk is written once, read once and
 * deleted, and its whole lifecycle is explicit — finalize, abort, or the sweep. Sending it to a
 * bucket would mean a 200 MB card going up as parts and coming straight back down seconds later to
 * be assembled, only to be deleted: 400 MB of transfer and a few hundred operations for bytes that
 * never needed to leave the machine. **This is not a local cache of a remote object** (that is #591,
 * a separate mechanism with its own policy): a chunk was never remote, so there is nothing here to
 * invalidate, evict or keep warm. Only the assembled sheet is handed to the storage interface.
 *
 * **Direct-to-storage was the other candidate for the upload itself, and is wrong.** Signed upload
 * URLs are a GCS feature the filesystem backend has none of, so large scans would exist on one
 * backend only — the exact thing `src/lib/storage/` prevents. Chunking lives in the HTTP layer and
 * is identical whatever the backend is.
 *
 * **A retry re-sends the chunk, not the file.** At 200 MB over a home connection, losing everything
 * to one dropped request is the difference between a mechanism and a nuisance — so a chunk already
 * stored is acknowledged rather than refused, and the client's retry of a request whose response it
 * never saw is a no-op instead of a double-count.
 *
 * **Nothing holds the card whole.** The parts are concatenated by a stream copy into one file and
 * `prepareSheet` is handed that file's *path* — `sharp` takes one — so the peak is the decode it
 * always was and never the decode plus a 200 MB buffer. Reading the parts into an array and
 * `Buffer.concat`ing them would have made chunking a memory regression rather than a fix.
 *
 * Only the **sheet** route uploads this way. A copy photo is a few megabytes and will never approach
 * a proxy's limit, so it keeps the plain single-request path (`photos/uploads`): carrying this
 * machinery for every thumbnail would be paying the whole cost for none of the benefit. The
 * asymmetry is a decision, not an unfinished refactor.
 *
 * Nothing downstream knows any of this happened. `finalize` hands {@link uploadSheet} the same scan
 * the single-request route used to hand it, and `prepareSheet`, the retained original, the `view`
 * derivative, the cut and the tiles are untouched.
 */

/** What the client needs to send the file: how large a piece may be, and how many there will be. */
export interface OpenedScanUpload {
  id: string;
  chunkBytes: number;
  chunks: number;
}

/** What a stored chunk is acknowledged with. `received` is the real measure of progress that exists
 * only because the upload is in parts — the client draws its bar from it rather than from bytes it
 * has handed to the socket, so the figure on screen is what the server actually holds. */
export interface ScanChunkAck {
  received: number;
  chunks: number;
}

/** The chunk size this instance opens uploads at. `STAMPORAMA_UPLOAD_CHUNK_KB` is the operator's
 * dial: the default is below every proxy default we know of, and someone behind something stricter
 * lowers it rather than being stuck. Read per upload, so a change takes effect on the next scan and
 * never under one already in flight. */
export function uploadChunkBytes(): number {
  return resolveUploadChunkBytes(process.env.STAMPORAMA_UPLOAD_CHUNK_KB);
}

// ── Where the parts live ──────────────────────────────────────────────────────────────────────
//
// On local disk, under the same volume the filesystem backend uses — `dataDir()` is read here as a
// *configured location*, not as a way into the storage interface, which these bytes deliberately do
// not go through. Its own top-level segment rather than under `photos/`, because that tree is the
// filesystem backend's and nothing here is a storage object: an operator listing the volume should
// be able to see at a glance which files something might come looking for and which are scaffolding
// for an upload in flight.

/** Everything one in-flight upload owns: its parts and, at the end, the file they assemble into. */
function uploadDir(uploadId: string): string {
  return path.join(dataDir(), "scan-uploads", uploadId);
}

/** One part. Zero-padded so the parts sort the way they are numbered when a human looks at the
 * volume; the app addresses them by index and never by listing. No extension — a part is a slice of
 * a file, not a file. */
function partPath(uploadId: string, index: number): string {
  return path.join(uploadDir(uploadId), `part-${String(index).padStart(6, "0")}`);
}

/** The parts, joined. Handed to `prepareSheet` as a path and deleted with everything else. */
function assembledPath(uploadId: string): string {
  return path.join(uploadDir(uploadId), "scan");
}

// ── Opening ───────────────────────────────────────────────────────────────────────────────────

/**
 * Open an upload: everything the finalize step will need is captured here, so a chunk request can
 * be bytes and an index and nothing else.
 *
 * The size cap is checked **before a byte is sent**. That is most of the point of declaring it: a
 * scan the app would refuse is refused at the open rather than after 200 MB have crossed the wire,
 * which is the failure this whole change exists to stop being expensive.
 */
export async function openScanUpload(
  ownerId: string,
  ref: ScanOwnerRef,
  input: {
    mime: string;
    side: SheetSide;
    batchNo?: number;
    label?: string | null;
    totalBytes: number;
  }
): Promise<OpenedScanUpload> {
  // The same check the finished sheet will pass (#725), taken once at the open: an upload is
  // staging for a `uploadSheet` call, so the two must not be able to disagree about who may write
  // where. The resolved owner is written onto the row and handed straight back at finalize.
  const owner = await assertScanOwner(ownerId, ref);

  if (!Number.isInteger(input.totalBytes) || input.totalBytes <= 0) {
    throw new ScanValidationError("No file provided.");
  }
  if (input.totalBytes > MAX_UPLOAD_BYTES) {
    throw new ScanValidationError("Scan is too large (max 200 MB).");
  }
  // The declared type is checked here and the *actual* one again in `prepareSheet`, which reads the
  // bytes rather than believing the client. This is the cheap half, and it is worth doing early for
  // the same reason the size is: refusing a 200 MB PDF after it has been sent helps nobody.
  if (!isAcceptedMime(input.mime)) {
    throw new ScanValidationError(`Unsupported image type: ${input.mime}`);
  }

  const chunkBytes = uploadChunkBytes();
  const upload = await prisma.scanUpload.create({
    data: {
      collectionId: owner.collectionId,
      purchaseId: owner.purchaseId,
      side: input.side,
      batchNo: input.batchNo ?? null,
      label: input.label ?? null,
      mime: input.mime,
      totalBytes: input.totalBytes,
      chunkBytes,
    },
    select: { id: true },
  });

  return {
    id: upload.id,
    chunkBytes,
    chunks: chunkCount(input.totalBytes, chunkBytes),
  };
}

// ── Receiving a chunk ─────────────────────────────────────────────────────────────────────────

interface UploadRow {
  id: string;
  collectionId: string;
  purchaseId: string | null;
  side: string;
  batchNo: number | null;
  label: string | null;
  mime: string;
  totalBytes: number;
  chunkBytes: number;
  receivedChunks: number;
  receivedBytes: number;
}

async function loadUpload(ownerId: string, uploadId: string): Promise<UploadRow> {
  const upload = await prisma.scanUpload.findUnique({
    where: { id: uploadId },
    select: {
      id: true,
      collectionId: true,
      purchaseId: true,
      side: true,
      batchNo: true,
      label: true,
      mime: true,
      totalBytes: true,
      chunkBytes: true,
      receivedChunks: true,
      receivedBytes: true,
      collection: { select: { ownerId: true } },
    },
  });
  if (!upload || upload.collection.ownerId !== ownerId) {
    throw new ScanAuthError("Upload not found or access denied.");
  }
  return upload;
}

/**
 * Store one part.
 *
 * Chunks arrive **in order**, so `receivedChunks` is both the count of what is held and the index of
 * what is expected next — one number the client can retry against, rather than a set the server
 * would have to keep and reconcile. Three cases:
 *
 * - `index === receivedChunks` — the part is stored and the count advances.
 * - `index < receivedChunks` — already held. Acknowledged, not refused: this is a retry of a request
 *   whose response the client never saw, and answering it with an error would fail an upload that
 *   is in fact intact.
 * - `index > receivedChunks` — a gap, which nothing downstream could assemble. Refused, and the
 *   acknowledgement says how far the server got so the client can resume from there.
 *
 * The length is checked exactly rather than loosely, because that is what makes the assembled file
 * verifiable: every part but the last is a full chunk, and the total then cannot silently differ
 * from what was declared.
 */
export async function receiveScanChunk(
  ownerId: string,
  uploadId: string,
  index: number,
  bytes: Buffer
): Promise<ScanChunkAck> {
  const upload = await loadUpload(ownerId, uploadId);
  const chunks = chunkCount(upload.totalBytes, upload.chunkBytes);

  if (!Number.isInteger(index) || index < 0 || index >= chunks) {
    throw new ScanValidationError("Chunk index is outside this upload.");
  }
  if (index < upload.receivedChunks) {
    return { received: upload.receivedChunks, chunks };
  }
  if (index > upload.receivedChunks) {
    throw new ScanValidationError(
      `Chunk ${index} arrived before chunk ${upload.receivedChunks}.`
    );
  }

  const { start, end } = chunkRange(index, upload.totalBytes, upload.chunkBytes);
  if (bytes.byteLength !== end - start) {
    throw new ScanValidationError("Chunk is not the size this upload expects.");
  }

  await mkdir(uploadDir(upload.id), { recursive: true });
  await writeFile(partPath(upload.id, index), bytes);

  // Guarded on the count it was read at, so two deliveries of the same chunk racing each other
  // write the same file twice (harmless — one path, one part) but advance the count once.
  const { count } = await prisma.scanUpload.updateMany({
    where: { id: upload.id, receivedChunks: index },
    data: {
      receivedChunks: index + 1,
      receivedBytes: upload.receivedBytes + bytes.byteLength,
    },
  });
  if (count === 0) {
    const current = await loadUpload(ownerId, uploadId);
    return { received: current.receivedChunks, chunks };
  }
  return { received: index + 1, chunks };
}

// ── Finalizing ────────────────────────────────────────────────────────────────────────────────

/**
 * Join the parts and run the ordinary sheet upload over the result.
 *
 * This is the whole seam: below this line nothing knows the bytes arrived in pieces, because
 * {@link uploadSheet} is handed the same scan the single-request route used to hand it — as a
 * **path** rather than a buffer, which is what keeps a 200 MB card from ever being resident whole.
 * The parts are copied through streams into one file for the same reason: concatenating them in
 * memory would double the peak the single-request path had, so chunking would have bought a proxy
 * fix and paid for it in RAM.
 *
 * The parts and the row go **whatever happens** — a finished upload has nothing left to stage, and a
 * refused one (a corrupt file, an unsupported format) has nothing worth keeping either, since a
 * retry means sending the file again. Abandoned uploads leaving nothing behind is a promise this
 * path keeps directly and the sweep only backstops.
 */
export async function finalizeScanUpload(
  ownerId: string,
  uploadId: string
): Promise<UploadedSheet> {
  const upload = await loadUpload(ownerId, uploadId);
  const chunks = chunkCount(upload.totalBytes, upload.chunkBytes);

  if (upload.receivedChunks !== chunks || upload.receivedBytes !== upload.totalBytes) {
    throw new ScanValidationError(
      `The scan is incomplete (${upload.receivedChunks} of ${chunks} parts received).`
    );
  }

  try {
    const scan = assembledPath(upload.id);
    // **One** pipeline over a generator that reads the parts in turn, rather than one pipeline per
    // part into a shared destination kept open with `end: false`. That shape worked and leaked
    // listeners: every `pipeline` call attaches `error`/`close`/`finish`/`end` handlers to the
    // destination and only detaches them when the destination itself finishes — which, being held
    // open on purpose, it does not until the last part. A card of 228 chunks was 228 sets of them,
    // and node started warning about the emitter at ten. This way the destination is handed to one
    // pipeline, which also puts the whole copy under a single error path and a single cleanup.
    await pipeline(async function* () {
      for (let i = 0; i < chunks; i++) {
        yield* createReadStream(partPath(upload.id, i));
      }
    }, createWriteStream(scan));

    return await uploadSheet(
      ownerId,
      upload.purchaseId
        ? { purchaseId: upload.purchaseId }
        : { collectionId: upload.collectionId },
      {
        source: { path: scan },
        mime: upload.mime,
        side: upload.side as SheetSide,
        batchNo: upload.batchNo ?? undefined,
        label: upload.label,
      }
    );
  } finally {
    await discardUpload(upload.id);
  }
}

/** Give up on an upload the collector abandoned — a cancelled dialog, a closed tab that got the
 * chance to say so. The sweep would take it anyway; this is what stops 200 MB of parts sitting on
 * the volume for hours after the collector already knows they are not wanted. */
export async function abortScanUpload(ownerId: string, uploadId: string): Promise<void> {
  const upload = await loadUpload(ownerId, uploadId);
  await discardUpload(upload.id);
}

/** Delete an upload's files and its row. The whole directory goes in one call — the parts, and the
 * assembled scan if finalize got that far — which is the one thing a local staging area makes
 * simpler than a bucket: there is a real directory to remove, so nothing has to enumerate what is
 * inside it. `force` makes an already-absent directory a no-op rather than an error, so a partly
 * cleaned-up upload can never leave its row behind. */
async function discardUpload(uploadId: string): Promise<void> {
  await rm(uploadDir(uploadId), { recursive: true, force: true });
  await prisma.scanUpload.deleteMany({ where: { id: uploadId } });
}

// ── The sweep ─────────────────────────────────────────────────────────────────────────────────

/**
 * Abandoned chunk uploads (#590), swept on the **same TTL and in the same pass** as the abandoned
 * photo staging uploads they sit beside (#112). A part-sent scan is staging in exactly the sense a
 * dropped-but-unsaved photo is — the collector's data only once they commit to it — so its lifetime
 * is the operator's business and `STAMPORAMA_PHOTO_UPLOAD_TTL_HOURS` is the answer already given to
 * that question (#577's rule). A second variable saying the same thing about the same class of
 * bytes would be one more number to keep in agreement with this one.
 *
 * Age is measured from `updatedAt` — the **last accepted chunk** — because a 200 MB card over a home
 * connection can legitimately be in flight longer than the TTL, and sweeping an upload still making
 * progress would break exactly the case this feature exists for.
 *
 * It is driven by the **rows** and not by walking the directory, for the reason the row exists at
 * all: a directory on disk says what is there but not whose it is or when it was last written to as
 * a whole, and a sweep that trusted a listing would be one `mkdir` race away from deleting an upload
 * mid-flight.
 *
 * Idempotent, like the sweep it runs with. Returns what it freed.
 */
export async function gcStaleScanUploads(
  now: number = Date.now()
): Promise<{ uploads: number; bytes: number }> {
  const cutoff = new Date(now - uploadTtlMs());
  const stale = await prisma.scanUpload.findMany({
    where: { updatedAt: { lt: cutoff } },
    select: { id: true, receivedBytes: true },
  });
  if (stale.length === 0) return { uploads: 0, bytes: 0 };

  for (const upload of stale) {
    await discardUpload(upload.id);
  }
  return {
    uploads: stale.length,
    bytes: stale.reduce((sum, u) => sum + u.receivedBytes, 0),
  };
}
