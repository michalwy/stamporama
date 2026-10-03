/**
 * Where a card scan is once it has been sent (#1567) — the pure half of the background preparation,
 * shared by the server (what may be swept, discarded, retried) and the Card scans section (what a
 * card says, and when the cut editor opens on its own).
 *
 * `uploading` → `queued` → `preparing` → `done` | `failed`. Preparing — joining the parts, decoding
 * a ~140 Mpx card and writing the `view` — used to run inside the request that finished the upload,
 * and a large card outlived the proxy in front of the app (Cloudflare's 524 at about 100 s). It runs
 * in the background now, one scan at a time, and the page reads this state instead of waiting.
 */

export const SCAN_UPLOAD_STATUSES = ["uploading", "queued", "preparing", "done", "failed"] as const;
export type ScanUploadStatus = (typeof SCAN_UPLOAD_STATUSES)[number];

export function isScanUploadStatus(value: string): value is ScanUploadStatus {
  return (SCAN_UPLOAD_STATUSES as readonly string[]).includes(value);
}

/** A stored status, read tolerantly: anything this build did not write is treated as still
 * arriving, which is the one state that promises nothing. */
export function asScanUploadStatus(value: string): ScanUploadStatus {
  return isScanUploadStatus(value) ? value : "uploading";
}

/**
 * What the abandoned-upload sweep may take, on the staging TTL.
 *
 * **Never a scan in the queue or being prepared**: once its last piece has arrived the scan is safe,
 * however long the queue or a server's downtime keeps it there — a restart resumes it rather than
 * the sweep deleting it. A failed one is staging again (nobody retried it, so it goes the way an
 * unfinished upload does), and a done one is only the note that let an open page find its sheet.
 */
export const SWEEPABLE_SCAN_UPLOAD_STATUSES: readonly ScanUploadStatus[] = [
  "uploading",
  "failed",
  "done",
];

/** Whether the collector may throw this upload away. Not while it is being prepared — the worker
 * holds its files — and not once done, when the card itself is what is deleted. */
export function canDiscardScanUpload(status: ScanUploadStatus): boolean {
  return status === "uploading" || status === "queued" || status === "failed";
}

/** Only a failed preparation is retried; its parts are kept for exactly this. */
export function canRetryScanUpload(status: ScanUploadStatus): boolean {
  return status === "failed";
}

/** Still on its way to being a card — the states the section keeps asking about. */
export function isScanUploadPending(status: ScanUploadStatus): boolean {
  return status === "queued" || status === "preparing";
}

/** What the section draws a card for while there is no batch yet. `uploading` is the browser's own
 * bar, and `done` is the batch itself. */
export function isScanUploadShown(status: ScanUploadStatus): boolean {
  return status === "queued" || status === "preparing" || status === "failed";
}

/** What a card being prepared says it is doing. */
export function scanUploadStatusText(status: ScanUploadStatus): string {
  switch (status) {
    case "queued":
      return "Waiting its turn to be prepared";
    case "preparing":
      return "Preparing the scan…";
    case "failed":
      return "Could not be prepared";
    case "done":
      return "Ready to cut";
    case "uploading":
      return "Uploading the scan…";
  }
}

/** One upload as the section sees it. */
export interface ScanUploadState {
  id: string;
  status: ScanUploadStatus;
  sheetId: string | null;
}

/**
 * The uploads this page watched being prepared that have just become cards — the ones whose cut
 * editor opens on their own.
 *
 * Only those the page **saw** queued or preparing: a scan that was ready before the page was opened
 * waits as a card with *Review the front cut* and is reported in the notifications, rather than
 * throwing an editor over whatever the collector came to the page to do.
 */
export function newlyPreparedSheets(
  watched: ReadonlySet<string>,
  uploads: readonly ScanUploadState[]
): string[] {
  return uploads
    .filter((u) => watched.has(u.id) && u.status === "done" && u.sheetId != null)
    .map((u) => u.sheetId as string);
}

/** A scan on its way to being a card, as the Card scans section draws it (#1567). */
export interface ScanUploadCard extends ScanUploadState {
  side: "front" | "back";
  batchNo: number | null;
  label: string | null;
  /** Why the preparation failed, while `failed`. */
  error: string | null;
  /** How many scans — of any collection on the instance — will be prepared before this one, while
   * it waits its turn; null otherwise. */
  ahead: number | null;
}

/**
 * How many scans are before each waiting one in the instance's queue: the one being prepared, then
 * every scan that joined the queue earlier. The queue is the instance's and not the order's, because
 * one worker prepares every collection's scans in turn.
 */
export function queueAhead(
  queue: readonly { id: string; status: ScanUploadStatus; queuedAt: Date | string | null }[]
): Map<string, number> {
  const preparing = queue.filter((q) => q.status === "preparing").length;
  const waiting = queue
    .filter((q) => q.status === "queued")
    .map((q) => ({ id: q.id, at: q.queuedAt == null ? 0 : new Date(q.queuedAt).getTime() }))
    .sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return new Map(waiting.map((q, i) => [q.id, preparing + i]));
}
