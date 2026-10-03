import type { ScanUploadProgress } from "@/lib/scan-uploads";
import { scansApiBase } from "./use-scans-query";

/**
 * Send card scans in parts (#590).
 *
 * A 1200 dpi stockbook card is 100–200 MB and never reached the app in one request: Cloudflare caps
 * a body at 100 MB and nginx defaults to 1 MB, so the upload failed with a 413 the app never saw.
 * Here the file is opened, sent in pieces the server names, and finalized — and the piece size comes
 * from the server rather than from a constant compiled in here, because it is the *operator's* dial
 * (`STAMPORAMA_UPLOAD_CHUNK_KB`) and a client that ignored it would make the dial pointless.
 *
 * **Progress is the count the server acknowledges**, not the bytes handed to a socket. It is a real
 * measure and it exists only because the upload is in parts, which is why it is emitted here rather
 * than threaded through later.
 *
 * **A failed chunk is retried, not the file.** At 200 MB over a home connection, losing everything
 * to one dropped request is the difference between a mechanism and a nuisance. Only the failures
 * worth retrying are retried — a network drop or a server error; a refusal (an unsupported format, a
 * batch that no longer exists) is an answer, and asking again three times only delays it.
 *
 * **It ends when the bytes are in** (#1567). Preparing the scan — joining the parts, a ~140 Mpx
 * decode and the `view` derivative — runs in the background on the server: finalizing only puts the
 * scan in a queue and answers at once, and the Card scans section shows the card being prepared from
 * the order's scans. It used to be done inside the finalize request, and a large card outlived the
 * proxy in front of the app (Cloudflare's 524 at about 100 s).
 */

export interface SheetUploadProgress {
  /** Chunks acknowledged over chunks expected. */
  fraction: number;
}

/** How many times one chunk is re-sent before the upload gives up, and how long it waits between
 * attempts. Short and few: a connection that has dropped four times over ten seconds is not about to
 * carry another 200 MB, and the collector would rather be told than watched over. */
const CHUNK_ATTEMPTS = 4;
const RETRY_DELAY_MS = 400;

export class SheetUploadError extends Error {}

/** Where the parts, the finalize and the abort of an upload are addressed. They name the
 * **upload**, which knows its own owner, so the order is not in their path; only the open has to say
 * who the card is for. */
function uploadsBase(collectionId: string): string {
  return `/api/collections/${collectionId}/scan-sheets/uploads`;
}

/** What the server answered an open with: how large a piece may be and how many there will be. */
export interface OpenedSheetUpload {
  id: string;
  chunkBytes: number;
  chunks: number;
}

/**
 * Open the upload of one scan, with the file's description alone.
 *
 * The size and the format are refused here if they are going to be refused at all — after 200 MB
 * have crossed the wire is the expensive place to learn a scan is too large. Several files chosen at
 * once (#1568) are each opened as they are chosen, so a file the app will not take is refused on its
 * own before anything is sent, and the server knows every file of the batch from the start — which is
 * what lets it say which ones a closed page never sent.
 */
export async function openSheetUpload(input: {
  collectionId: string;
  /** The document the card belongs to — the only thing it decides here is where the upload is
   * **opened**. */
  purchaseId: string;
  file: File;
  side: "front" | "back";
  batchNo?: number;
  label?: string | null;
  /** What the card was scanned with (#1443); null takes the collection's default. */
  scanningProfileId?: string | null;
  /** How a back's backs were made (#1555); null takes the collection's last. */
  turnover?: string | null;
}): Promise<OpenedSheetUpload> {
  const res = await fetch(`${scansApiBase(input.collectionId, input.purchaseId)}/uploads`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      mime: input.file.type,
      side: input.side,
      batchNo: input.batchNo,
      label: input.label ?? null,
      scanningProfileId: input.scanningProfileId ?? null,
      turnover: input.turnover ?? null,
      totalBytes: input.file.size,
    }),
  }).catch(() => null);
  if (!res) throw new SheetUploadError("The connection dropped while starting the upload.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SheetUploadError(body.error ?? "Failed to upload the scan.");
  return body as OpenedSheetUpload;
}

/**
 * Send an opened upload's parts, in order, **from wherever the server has got to**.
 *
 * Every acknowledgement says how many parts the server holds, and the next part sent is that one —
 * so sending an upload again after a failure (#1568's *Try again*) resumes rather than starting the
 * 200 MB over: the first part re-sent is answered with the count already held, and the rest follows
 * from there.
 */
export async function sendSheetChunks(input: {
  collectionId: string;
  upload: OpenedSheetUpload;
  file: File;
  onProgress: (progress: SheetUploadProgress) => void;
}): Promise<void> {
  const { id, chunkBytes, chunks } = input.upload;
  const base = uploadsBase(input.collectionId);
  let index = 0;
  while (index < chunks) {
    const start = index * chunkBytes;
    const slice = input.file.slice(start, Math.min(start + chunkBytes, input.file.size));
    const ack = await putChunk(`${base}/${id}?index=${index}`, slice);
    // A server that holds no more than before has refused the part without saying so; asking again
    // would ask for ever.
    if (ack.received <= index) throw new SheetUploadError("The server did not accept part of the scan.");
    index = ack.received;
    input.onProgress({ fraction: chunks > 0 ? index / chunks : 1 });
  }
}

/**
 * The bytes are in: put the scan in the queue to be prepared. It is safe from here — it is prepared
 * in the background, and nothing is discarded if this request's answer is lost, since finalizing
 * again is answered with where the scan already is.
 */
export async function finalizeSheetUpload(
  collectionId: string,
  uploadId: string
): Promise<ScanUploadProgress> {
  let res: Response | null = null;
  for (let attempt = 0; attempt < CHUNK_ATTEMPTS && res == null; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    res = await fetch(`${uploadsBase(collectionId)}/${uploadId}/finalize`, { method: "POST" }).catch(
      () => null
    );
    if (res && res.status >= 500) res = null;
  }
  if (!res) throw new SheetUploadError("The connection dropped while finishing the upload.");
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new SheetUploadError(body.error ?? "Failed to upload the scan.");
  const progress = body as ScanUploadProgress;
  if (progress.status === "interrupted") {
    throw new SheetUploadError(
      "This upload was stopped because the page sending it seemed to have closed. Choose the file again."
    );
  }
  return progress;
}

/** The page sending a batch is closing (#1568): stop the files it had not finished, so the purchase
 * reports them the next time it is opened. A beacon, because nothing else is promised to leave a
 * closing tab. */
export function interruptSheetUploads(collectionId: string, uploadIds: string[]): void {
  if (uploadIds.length === 0) return;
  const body = new Blob([JSON.stringify({ ids: uploadIds })], { type: "application/json" });
  navigator.sendBeacon(`${uploadsBase(collectionId)}/interrupt`, body);
}

/** The page sending a batch is still open (#1568), for the files it holds and is not sending now. */
export async function keepSheetUploadsAlive(collectionId: string, uploadIds: string[]): Promise<void> {
  if (uploadIds.length === 0) return;
  await fetch(`${uploadsBase(collectionId)}/keepalive`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ids: uploadIds }),
  }).catch(() => {});
}

/** Ask for a failed preparation to be tried again (#1567), from the parts already on the server. */
export async function retrySheetPreparation(collectionId: string, uploadId: string): Promise<void> {
  const res = await fetch(`${uploadsBase(collectionId)}/${uploadId}/retry`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new SheetUploadError(body.error ?? "Failed to try the scan again.");
  }
}

/** Throw away a scan that could not be prepared (#1567), one that could not be sent, or the report of
 * one a closed page never sent (#1568). */
export async function discardSheetUpload(collectionId: string, uploadId: string): Promise<void> {
  const res = await fetch(`${uploadsBase(collectionId)}/${uploadId}`, {
    method: "DELETE",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new SheetUploadError(body.error ?? "Failed to discard the scan.");
  }
}

/** Send one part, retrying the part alone. A chunk the server already holds is acknowledged rather
 * than refused, so a retry of a request whose response was lost resumes instead of failing. */
async function putChunk(url: string, body: Blob): Promise<{ received: number; chunks: number }> {
  let lastError: unknown = null;
  for (let attempt = 0; attempt < CHUNK_ATTEMPTS; attempt++) {
    if (attempt > 0) {
      await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    }
    let res: Response;
    try {
      res = await fetch(url, {
        method: "PUT",
        headers: { "content-type": "application/octet-stream" },
        body,
      });
    } catch (err) {
      // The network dropped — the case retries exist for.
      lastError = err;
      continue;
    }
    if (res.ok) return await res.json();
    // A 4xx is an answer: the upload is gone, the format is wrong, the chunk is not the one
    // expected. Repeating the request cannot change it.
    if (res.status < 500) {
      const body = await res.json().catch(() => ({}));
      throw new SheetUploadError(body.error ?? "Failed to upload the scan.");
    }
    lastError = new SheetUploadError(`The server could not store part of the scan.`);
  }
  throw lastError instanceof SheetUploadError
    ? lastError
    : new SheetUploadError("The connection dropped while sending the scan.");
}
