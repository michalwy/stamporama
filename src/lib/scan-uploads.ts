import "server-only";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { prisma } from "./db";
import { dataDir } from "./storage";
import { assertCollectionProfile, ScanningProfileError } from "./scanning-profiles";
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
import { isBackTurnover } from "./back-turnover";
import {
  asScanUploadStatus,
  canDiscardScanUpload,
  canRetryScanUpload,
  SCAN_UPLOAD_STALL_MS,
  SWEEPABLE_SCAN_UPLOAD_STATUSES,
  type ScanUploadStatus,
} from "./scan-upload-status-rules";

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
 * Nothing downstream knows any of this happened. The preparation hands {@link uploadSheet} the same
 * scan the single-request route used to hand it, and `prepareSheet`, the retained original, the
 * `view` derivative, the cut and the tiles are untouched.
 *
 * **Preparing runs in the background** (#1567). Finalizing only puts the scan in a queue and answers
 * at once; the in-process worker prepares one scan at a time, and the row's `status` is what the
 * Card scans section reads. Preparing a large card inside the finalize request outlived the proxy's
 * timeout (Cloudflare's 524), however long it happened to take on a given day.
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
    /** The profile chosen beside the file (#1443), carried to the sheet at finalize. */
    scanningProfileId?: string | null;
    /** How a back's backs were made (#1555), carried to the sheet at finalize. */
    turnover?: string | null;
    totalBytes: number;
  }
): Promise<OpenedScanUpload> {
  // The same check the finished sheet will pass, taken once at the open: an upload is
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
      scanningProfileId: await chosenProfile(owner.collectionId, input.scanningProfileId),
      turnover: chosenTurnover(input.side, input.turnover),
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

/** The profile an upload is opened with: one of this collection's, or null for the default. Checked
 * at the open, where refusing costs nothing, rather than after 200 MB have arrived. */
async function chosenProfile(
  collectionId: string,
  chosen: string | null | undefined
): Promise<string | null> {
  if (!chosen) return null;
  try {
    await assertCollectionProfile(prisma, collectionId, chosen);
  } catch (err) {
    if (err instanceof ScanningProfileError) throw new ScanValidationError(err.message);
    throw err;
  }
  return chosen;
}

/** The way a back was made, checked at the open for the reason the profile is: refusing an unknown
 * one costs nothing here and 200 MB at finalize. Dropped on a front, which has no backs. */
function chosenTurnover(side: SheetSide, chosen: string | null | undefined): string | null {
  if (side !== "back" || !chosen) return null;
  if (!isBackTurnover(chosen)) throw new ScanValidationError("Unknown way the backs were made.");
  return chosen;
}

// ── Receiving a chunk ─────────────────────────────────────────────────────────────────────────

interface UploadRow {
  id: string;
  collectionId: string;
  purchaseId: string;
  side: string;
  batchNo: number | null;
  label: string | null;
  scanningProfileId: string | null;
  turnover: string | null;
  mime: string;
  totalBytes: number;
  chunkBytes: number;
  receivedChunks: number;
  receivedBytes: number;
  status: string;
  error: string | null;
  sheetId: string | null;
}

const UPLOAD_SELECT = {
  id: true,
  collectionId: true,
  purchaseId: true,
  side: true,
  batchNo: true,
  label: true,
  scanningProfileId: true,
  turnover: true,
  mime: true,
  totalBytes: true,
  chunkBytes: true,
  receivedChunks: true,
  receivedBytes: true,
  status: true,
  error: true,
  sheetId: true,
} as const;

async function loadUpload(ownerId: string, uploadId: string): Promise<UploadRow> {
  const upload = await prisma.scanUpload.findUnique({
    where: { id: uploadId },
    select: { ...UPLOAD_SELECT, collection: { select: { ownerId: true } } },
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

  // Stopped because the page sending it was taken for closed (#1568): its parts are gone, so there
  // is nothing to add this one to, and acknowledging it would have the client send the same piece
  // for ever.
  if (upload.status === "interrupted") {
    throw new ScanValidationError(
      "This upload was stopped because the page sending it seemed to have closed. Choose the file again."
    );
  }
  // A part arriving after the scan was finalized is a retry of one already held (the count is
  // complete) — acknowledged like any other, and never written over files the worker may be reading.
  if (upload.status !== "uploading") {
    return { received: upload.receivedChunks, chunks };
  }
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
    where: { id: upload.id, receivedChunks: index, status: "uploading" },
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

// ── Finalizing: into the queue ───────────────────────────────────────────────────────────────

/** What finalize, a retry and the section's reads say about an upload. */
export interface ScanUploadProgress {
  id: string;
  status: ScanUploadStatus;
  error: string | null;
  sheetId: string | null;
}

/**
 * The last chunk is in: put the scan in the queue and answer at once (#1567).
 *
 * Preparing the scan — joining the parts, the ~140 Mpx decode, the `view` — used to happen right
 * here, inside the request the browser was waiting on. A large card outlived the proxy in front of
 * the app (Cloudflare gives up after about 100 s with a 524), and the collector was left with a scan
 * whose bytes had all arrived and no card to cut. However long it takes on a given day, the work
 * cannot be promised to fit a request's time limit, so it is not done in one: the row is marked
 * `queued` and the in-process worker (`scan-upload-worker.ts`) prepares it in turn.
 *
 * **From here the scan is safe.** The parts stay on disk until the preparation succeeds, the sweep
 * never takes a queued or preparing row, and a restart puts one left mid-preparation back in the
 * queue. Finalizing twice — a retry of a request whose answer was lost — is answered with where the
 * scan already is rather than refused.
 */
export async function finalizeScanUpload(
  ownerId: string,
  uploadId: string
): Promise<ScanUploadProgress> {
  const upload = await loadUpload(ownerId, uploadId);
  const status = asScanUploadStatus(upload.status);
  if (status !== "uploading") return progressOf(upload);

  const chunks = chunkCount(upload.totalBytes, upload.chunkBytes);
  if (upload.receivedChunks !== chunks || upload.receivedBytes !== upload.totalBytes) {
    throw new ScanValidationError(
      `The scan is incomplete (${upload.receivedChunks} of ${chunks} parts received).`
    );
  }

  await prisma.scanUpload.updateMany({
    where: { id: upload.id, status: "uploading" },
    data: { status: "queued", queuedAt: new Date(), error: null },
  });
  return progressOf(await loadUpload(ownerId, uploadId));
}

/**
 * Put a failed preparation back in the queue (#1567) — without the scan being sent again, which is
 * what keeping the parts after a failure is for. It takes a new place at the back: the queue is in
 * the order scans became ready to prepare, and a retry is that moment again.
 */
export async function retryScanUpload(
  ownerId: string,
  uploadId: string
): Promise<ScanUploadProgress> {
  const upload = await loadUpload(ownerId, uploadId);
  if (!canRetryScanUpload(asScanUploadStatus(upload.status))) {
    throw new ScanValidationError("Only a scan that could not be prepared can be tried again.");
  }
  await prisma.scanUpload.updateMany({
    where: { id: upload.id, status: "failed" },
    data: { status: "queued", queuedAt: new Date(), error: null },
  });
  return progressOf(await loadUpload(ownerId, uploadId));
}

function progressOf(upload: Pick<UploadRow, "id" | "status" | "error" | "sheetId">): ScanUploadProgress {
  return {
    id: upload.id,
    status: asScanUploadStatus(upload.status),
    error: upload.error,
    sheetId: upload.sheetId,
  };
}

// ── The worker's half ─────────────────────────────────────────────────────────────────────────

/** Take the scan that has waited longest and mark it being prepared, or null when none is waiting.
 * Conditional on the status it was read at, so two passes can never claim the same scan. */
export async function claimNextScanUpload(): Promise<string | null> {
  for (;;) {
    const next = await prisma.scanUpload.findFirst({
      where: { status: "queued" },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      select: { id: true },
    });
    if (!next) return null;
    const { count } = await prisma.scanUpload.updateMany({
      where: { id: next.id, status: "queued" },
      data: { status: "preparing" },
    });
    if (count === 1) return next.id;
  }
}

/** A scan left `preparing` by a process that stopped goes back to the front of the queue — its
 * place is unchanged, since `queuedAt` is. Safe because a preparation is all-or-nothing: the sheet
 * and the row's `done` are one transaction, so a scan interrupted before it was never half made. */
export async function requeueStalledScanUploads(): Promise<number> {
  const { count } = await prisma.scanUpload.updateMany({
    where: { status: "preparing" },
    data: { status: "queued" },
  });
  return count;
}

/**
 * Prepare one claimed scan: join its parts and run the ordinary sheet upload over the result.
 *
 * Below this line nothing knows the bytes arrived in pieces, or late: {@link uploadSheet} is handed
 * the same scan the request used to hand it — as a **path** rather than a buffer, which is what
 * keeps a 200 MB card from ever being resident whole. The parts are copied through streams into one
 * file for the same reason: concatenating them in memory would double the peak.
 *
 * The row is marked `done` **inside the transaction that creates the sheet**, so a restart can never
 * prepare one scan into two batches. On success the parts go and the row stays, small, until the
 * sweep — it is how the page still open finds the card to cut. On failure the parts are **kept**:
 * a retry prepares them again without the scan being sent again. The failure itself is recorded by
 * {@link failScanUpload}, which the worker calls with whatever this throws.
 */
export async function prepareScanUpload(uploadId: string): Promise<UploadedSheet> {
  const upload = await prisma.scanUpload.findUniqueOrThrow({
    where: { id: uploadId },
    select: { ...UPLOAD_SELECT, collection: { select: { ownerId: true } } },
  });
  const chunks = chunkCount(upload.totalBytes, upload.chunkBytes);

  const scan = assembledPath(upload.id);
  // **One** pipeline over a generator that reads the parts in turn, rather than one pipeline per
  // part into a shared destination kept open with `end: false`. That shape worked and leaked
  // listeners: every `pipeline` call attaches `error`/`close`/`finish`/`end` handlers to the
  // destination and only detaches them when the destination itself finishes — which, being held
  // open on purpose, it does not until the last part. A card of 228 chunks was 228 sets of them,
  // and node started warning about the emitter at ten. This way the destination is handed to one
  // pipeline, which also puts the whole copy under a single error path and a single cleanup.
  //
  // Written afresh on every attempt, so a retry or a resumed preparation never trusts a file an
  // interrupted one left half-written.
  await pipeline(async function* () {
    for (let i = 0; i < chunks; i++) {
      yield* createReadStream(partPath(upload.id, i));
    }
  }, createWriteStream(scan));

  const sheet = await uploadSheet(
    upload.collection.ownerId,
    { purchaseId: upload.purchaseId },
    {
      source: { path: scan },
      mime: upload.mime,
      side: upload.side as SheetSide,
      batchNo: upload.batchNo ?? undefined,
      label: upload.label,
      scanningProfileId: upload.scanningProfileId,
      turnover: upload.turnover,
    },
    async (tx, sheetId) => {
      // `update`, not `updateMany`: a scan discarded while it was being prepared has no row, and
      // this throwing is what rolls the sheet back rather than leaving a card nobody asked for.
      await tx.scanUpload.update({
        where: { id: upload.id, status: "preparing" },
        data: { status: "done", sheetId, error: null },
      });
    }
  );

  await rm(uploadDir(upload.id), { recursive: true, force: true });
  return sheet;
}

/**
 * Record why a preparation failed, in words the card can show. A refusal the app made on purpose (a
 * file that is not an image, a batch deleted while its back waited) is already a sentence; anything
 * else is said as what went wrong, since the collector of a self-hosted app is usually also the
 * person who can do something about a full disk.
 */
export async function failScanUpload(uploadId: string, err: unknown): Promise<void> {
  const reason =
    err instanceof ScanValidationError
      ? err.message
      : `Something went wrong while preparing the scan${
          err instanceof Error && err.message ? `: ${err.message}` : "."
        }`;
  await prisma.scanUpload.updateMany({
    where: { id: uploadId, status: "preparing" },
    data: { status: "failed", error: reason.slice(0, 500) },
  });
}

// ── Giving up ─────────────────────────────────────────────────────────────────────────────────

/** Give up on an upload the collector abandoned — a cancelled dialog, a closed tab that got the
 * chance to say so, or a scan that could not be prepared and is not worth trying again. The sweep
 * would take it anyway; this is what stops 200 MB of parts sitting on the volume for hours after the
 * collector already knows they are not wanted. Refused while the scan is being prepared, when the
 * worker holds its files, and once it is a card, which is deleted as a batch. */
export async function abortScanUpload(ownerId: string, uploadId: string): Promise<void> {
  const upload = await loadUpload(ownerId, uploadId);
  if (!canDiscardScanUpload(asScanUploadStatus(upload.status))) {
    throw new ScanValidationError(
      upload.status === "preparing"
        ? "This scan is being prepared and cannot be discarded until it is done."
        : "This scan is already a card — delete the batch instead."
    );
  }
  await discardUpload(upload.id);
}

/** Delete an upload's files and its row. The whole directory goes in one call — the parts, and the
 * assembled scan if a preparation got that far — which is the one thing a local staging area makes
 * simpler than a bucket: there is a real directory to remove, so nothing has to enumerate what is
 * inside it. `force` makes an already-absent directory a no-op rather than an error, so a partly
 * cleaned-up upload can never leave its row behind. */
async function discardUpload(uploadId: string): Promise<void> {
  await rm(uploadDir(uploadId), { recursive: true, force: true });
  await prisma.scanUpload.deleteMany({ where: { id: uploadId } });
}

// ── A page closed mid-batch (#1568) ───────────────────────────────────────────────────────────

/**
 * Stop the uploads a page was still sending when it closed (#1568) — the files waiting their turn and
 * the one half-sent.
 *
 * Several scans are chosen at once and sent one after another by the page, so a closed tab leaves
 * files the server has only been told about. **Nothing half-sent is kept**: a part-sent scan cannot
 * be finished without the file, which only the collector's disk still has, so its parts go now rather
 * than at the sweep. **The row stays, as `interrupted`**, because it is the report — the next time the
 * purchase is opened it says which files were never sent, until the collector dismisses it.
 *
 * The page says so itself as it closes; {@link interruptStalledScanUploads} is for a page that could
 * not. Only uploads still `uploading` are touched — a file whose last piece made it is in the queue
 * and safe — and only the owner's.
 */
export async function interruptScanUploads(ownerId: string, uploadIds: readonly string[]): Promise<number> {
  if (uploadIds.length === 0) return 0;
  const rows = await prisma.scanUpload.findMany({
    where: { id: { in: [...uploadIds] }, status: "uploading", collection: { ownerId } },
    select: { id: true },
  });
  return interrupt(rows.map((r) => r.id));
}

/**
 * An order's uploads that have shown no sign of life for {@link SCAN_UPLOAD_STALL_MS} — the page
 * sending them closed without being able to say so (#1568). Run as the order's scans are read, so
 * the report is there when the purchase is next opened rather than whenever the hourly sweep comes
 * round. A page still sending keeps its waiting files alive ({@link keepScanUploadsAlive}) and bumps
 * the one being sent with every piece, so nothing it holds is mistaken for abandoned.
 */
export async function interruptStalledScanUploads(
  ownerId: string,
  purchaseId: string,
  now: number = Date.now()
): Promise<number> {
  const rows = await prisma.scanUpload.findMany({
    where: {
      purchaseId,
      status: "uploading",
      updatedAt: { lt: new Date(now - SCAN_UPLOAD_STALL_MS) },
      collection: { ownerId },
    },
    select: { id: true },
  });
  return interrupt(rows.map((r) => r.id));
}

/**
 * Say that the page sending these uploads is still open (#1568). A file waiting behind a 200 MB card
 * sends nothing for a long time, and without this it would look exactly like one whose page closed.
 */
export async function keepScanUploadsAlive(ownerId: string, uploadIds: readonly string[]): Promise<void> {
  if (uploadIds.length === 0) return;
  await prisma.scanUpload.updateMany({
    where: { id: { in: [...uploadIds] }, status: "uploading", collection: { ownerId } },
    data: { updatedAt: new Date() },
  });
}

/** Mark the rows first, so a piece arriving now is refused rather than written, then remove what
 * they had received. */
async function interrupt(uploadIds: string[]): Promise<number> {
  if (uploadIds.length === 0) return 0;
  const { count } = await prisma.scanUpload.updateMany({
    where: { id: { in: uploadIds }, status: "uploading" },
    data: { status: "interrupted", error: null, receivedChunks: 0, receivedBytes: 0 },
  });
  for (const id of uploadIds) {
    await rm(uploadDir(id), { recursive: true, force: true });
  }
  return count;
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
 * **Never a scan in the queue or being prepared** (#1567): once its last piece has arrived the scan
 * is safe, however long a queue or a server's downtime keeps it waiting. A failed preparation nobody
 * retried goes the way an unfinished upload does, its age measured from the failure; a done row has
 * no bytes left and is only the note that let an open page find its card.
 *
 * Idempotent, like the sweep it runs with. Returns what it freed.
 */
export async function gcStaleScanUploads(
  now: number = Date.now()
): Promise<{ uploads: number; bytes: number }> {
  const cutoff = new Date(now - uploadTtlMs());
  const stale = await prisma.scanUpload.findMany({
    where: {
      updatedAt: { lt: cutoff },
      status: { in: [...SWEEPABLE_SCAN_UPLOAD_STATUSES] },
    },
    select: { id: true, receivedBytes: true, status: true },
  });
  if (stale.length === 0) return { uploads: 0, bytes: 0 };

  for (const upload of stale) {
    await discardUpload(upload.id);
  }
  // A done row's parts went when its sheet was made, so it frees a row and no bytes.
  const holding = stale.filter((u) => u.status !== "done");
  return {
    uploads: holding.length,
    bytes: holding.reduce((sum, u) => sum + u.receivedBytes, 0),
  };
}
