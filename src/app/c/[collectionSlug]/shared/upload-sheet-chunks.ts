import type { ScanUploadProgress } from "@/lib/scan-uploads";
import { scansApiBase } from "./use-scans-query";

/**
 * Send a card scan in parts (#590).
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

export async function uploadSheetInChunks(input: {
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
  onProgress: (progress: SheetUploadProgress) => void;
}): Promise<ScanUploadProgress> {
  const openUrl = `${scansApiBase(input.collectionId, input.purchaseId)}/uploads`;
  // The parts, the finalize and the abort are addressed by the **upload**, which knows its own
  // owner, so the order is not in their path. Only the open has to say who the card is for.
  const base = `/api/collections/${input.collectionId}/scan-sheets/uploads`;

  // Opened with the file's description alone. The size and the format are refused here if they are
  // going to be refused at all — after 200 MB have crossed the wire is the expensive place to learn
  // a scan is too large, and it is the failure this whole change exists to stop.
  const openRes = await fetch(openUrl, {
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
  });
  const opened = await openRes.json();
  if (!openRes.ok) {
    throw new SheetUploadError(opened.error ?? "Failed to upload the scan.");
  }
  const { id, chunkBytes, chunks } = opened as {
    id: string;
    chunkBytes: number;
    chunks: number;
  };

  input.onProgress({ fraction: 0 });

  try {
    for (let index = 0; index < chunks; index++) {
      const start = index * chunkBytes;
      const slice = input.file.slice(start, Math.min(start + chunkBytes, input.file.size));
      const ack = await putChunk(`${base}/${id}?index=${index}`, slice);
      input.onProgress({ fraction: chunks > 0 ? ack.received / chunks : 1 });
    }
  } catch (err) {
    // Nothing is left behind on a path the collector is already being told about. The hourly sweep
    // would collect the parts anyway; this is what keeps 200 MB off the volume in the meantime.
    void fetch(`${base}/${id}`, { method: "DELETE" }).catch(() => {});
    throw err;
  }

  // The bytes are in, so the scan is safe from here: it joins the queue and is prepared in the
  // background, and nothing is discarded if this request's answer is lost — finalizing again is
  // answered with where the scan already is.
  let finalRes: Response | null = null;
  for (let attempt = 0; attempt < CHUNK_ATTEMPTS && finalRes == null; attempt++) {
    if (attempt > 0) await new Promise((resolve) => setTimeout(resolve, RETRY_DELAY_MS * attempt));
    finalRes = await fetch(`${base}/${id}/finalize`, { method: "POST" }).catch(() => null);
    if (finalRes && finalRes.status >= 500) finalRes = null;
  }
  if (!finalRes) {
    throw new SheetUploadError("The connection dropped while finishing the upload.");
  }
  const body = await finalRes.json().catch(() => ({}));
  if (!finalRes.ok) {
    void fetch(`${base}/${id}`, { method: "DELETE" }).catch(() => {});
    throw new SheetUploadError(body.error ?? "Failed to upload the scan.");
  }
  return body as ScanUploadProgress;
}

/** Ask for a failed preparation to be tried again (#1567), from the parts already on the server. */
export async function retrySheetPreparation(collectionId: string, uploadId: string): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/scan-sheets/uploads/${uploadId}/retry`, {
    method: "POST",
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new SheetUploadError(body.error ?? "Failed to try the scan again.");
  }
}

/** Throw away a scan that could not be prepared (#1567). */
export async function discardSheetUpload(collectionId: string, uploadId: string): Promise<void> {
  const res = await fetch(`/api/collections/${collectionId}/scan-sheets/uploads/${uploadId}`, {
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
