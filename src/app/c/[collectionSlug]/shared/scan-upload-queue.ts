"use client";

import { useMemo, useSyncExternalStore } from "react";
import { SCAN_UPLOAD_KEEPALIVE_MS } from "@/lib/scan-upload-status-rules";
import {
  SheetUploadError,
  discardSheetUpload,
  finalizeSheetUpload,
  interruptSheetUploads,
  keepSheetUploadsAlive,
  openSheetUpload,
  sendSheetChunks,
  type OpenedSheetUpload,
} from "./upload-sheet-chunks";

/**
 * The card scans this tab is sending (#1568) — several files chosen at once, sent **one after
 * another** at their own pace while the collector does something else.
 *
 * **A module, not a component's state.** The Card scans section that started a batch is unmounted
 * the moment the collector moves to another screen, and a queue held there would stop with it — or
 * worse, carry on with nothing left to show it. Held here, it lives exactly as long as the tab: every
 * screen of the app is the same page, so moving around leaves it running, and the section reads it
 * back whenever it is drawn again. Nothing about it is the collection's, so it sits beside no
 * provider and needs none.
 *
 * **One file at a time, in the order chosen.** Each joins the server's preparation queue (#1567) the
 * moment its last piece arrives, so preparing the first overlaps sending the next, and the cards are
 * numbered in the order the files were picked. Sending them side by side would only split one
 * connection between them and finish all of them later.
 *
 * **Every file is opened as it is chosen**, before any is sent: a file the app will not take is
 * refused on its own while the others go ahead, and the server knows the whole batch from the start
 * — which is what lets it report the files a closed tab never sent. As the tab closes it says so
 * (`pagehide`, a beacon) and the browser asks first while anything is unsent (`beforeunload`); for a
 * tab that could not say so, the files it holds are kept alive once a minute and the server takes
 * silence for closure (`SCAN_UPLOAD_STALL_MS`).
 *
 * **Drawn by the panel of scans being added** (#2099), on every screen, not by the Card scans
 * section: the batch carries on wherever the collector goes, so its progress goes with them.
 */

export type QueuedScanState =
  /** Being described to the server, which may still refuse it. */
  | "opening"
  /** Accepted, waiting for the files before it to be sent. */
  | "waiting"
  /** Its pieces are going up now. */
  | "uploading"
  /** Sending it failed part-way; *Try again* resumes from what the server already holds. */
  | "failed"
  /** The server will not take this file at all — the reason says why — and the others went ahead. */
  | "refused";

/** One file of a batch, as the panel of scans being added draws it. */
export interface QueuedScan {
  key: string;
  collectionId: string;
  purchaseId: string;
  /** The document it is being added to, as the panel names it: *Order #12*. */
  documentName: string;
  fileName: string;
  side: "front" | "back";
  batchNo: number | null;
  label: string | null;
  state: QueuedScanState;
  /** Pieces acknowledged over pieces expected, while uploading (and where a failure stopped). */
  fraction: number;
  error: string | null;
}

interface Entry extends QueuedScan {
  file: File;
  scanningProfileId: string | null;
  turnover: string | null;
  upload: OpenedSheetUpload | null;
}

/** A file whose last piece arrived and which is now the server's to prepare. */
export interface SentScan {
  collectionId: string;
  purchaseId: string;
  uploadId: string;
}

let entries: readonly Entry[] = [];
/**
 * The files of the current round of sending — counted from the moment a file is added to a queue
 * with nothing left to send, until nothing is again — and how many of them have been sent. What
 * *Uploading 3 of 12* counts. A file that fails or is refused leaves the round; tried again, it
 * rejoins it.
 */
export interface UploadRound {
  sent: number;
  total: number;
}
let round: UploadRound = { sent: 0, total: 0 };
/** The file each sent upload was, so a scan the server is preparing is still named by its file. */
const sentFileNames = new Map<string, string>();
let nextKey = 0;
let pumping = false;
const listeners = new Set<() => void>();
const sentListeners = new Set<(sent: SentScan) => void>();

function emit() {
  for (const listener of listeners) listener();
}

function patch(key: string, change: Partial<Entry>) {
  entries = entries.map((e) => (e.key === key ? { ...e, ...change } : e));
  emit();
}

/** Still to be sent, or being sent: the files of the current round not yet in. */
function toSend(): Entry[] {
  return entries.filter((e) => e.state === "opening" || e.state === "waiting" || e.state === "uploading");
}

/** Count files into the round — a new one if nothing was still to be sent. */
function joinRound(count: number) {
  round = toSend().length === 0 ? { sent: 0, total: count } : { ...round, total: round.total + count };
}

function leaveRound() {
  round = { ...round, total: Math.max(round.sent, round.total - 1) };
}

function remove(key: string) {
  entries = entries.filter((e) => e.key !== key);
  emit();
}

function errorText(err: unknown, fallback: string): string {
  return err instanceof SheetUploadError ? err.message : fallback;
}

/** What is still to be sent — what closing the tab would lose. A refused file was never going to be. */
function unsent(): Entry[] {
  return entries.filter((e) => e.state !== "refused");
}

/**
 * Add files to the queue, in the order given — several fronts at once, or one back.
 *
 * Each gets its own name (`labels`, one per file, worked out by the caller) and the same profile and
 * turnover. Opened one by one so the server records them in the order chosen; the first is sent the
 * moment it is accepted.
 */
export function enqueueScans(input: {
  collectionId: string;
  purchaseId: string;
  documentName: string;
  files: readonly File[];
  labels: readonly (string | null)[];
  side: "front" | "back";
  batchNo?: number;
  scanningProfileId: string | null;
  turnover: string | null;
}): void {
  const added: Entry[] = input.files.map((file, i) => ({
    key: `scan-${++nextKey}`,
    collectionId: input.collectionId,
    purchaseId: input.purchaseId,
    documentName: input.documentName,
    fileName: file.name,
    side: input.side,
    batchNo: input.batchNo ?? null,
    label: input.labels[i] ?? null,
    state: "opening",
    fraction: 0,
    error: null,
    file,
    scanningProfileId: input.scanningProfileId,
    turnover: input.turnover,
    upload: null,
  }));
  if (added.length === 0) return;
  joinRound(added.length);
  entries = [...entries, ...added];
  installPageHooks();
  emit();
  void (async () => {
    for (const entry of added) {
      try {
        const upload = await openSheetUpload({
          collectionId: entry.collectionId,
          purchaseId: entry.purchaseId,
          file: entry.file,
          side: entry.side,
          batchNo: entry.batchNo ?? undefined,
          label: entry.label,
          scanningProfileId: entry.scanningProfileId,
          turnover: entry.turnover,
        });
        patch(entry.key, { state: "waiting", upload });
        void pump();
      } catch (err) {
        leaveRound();
        patch(entry.key, { state: "refused", error: errorText(err, "Failed to upload the scan.") });
      }
    }
  })();
}

/** Send what is waiting, one file at a time, until nothing is. */
async function pump(): Promise<void> {
  if (pumping) return;
  pumping = true;
  try {
    for (;;) {
      const next = entries.find((e) => e.state === "waiting");
      if (!next?.upload) break;
      await send(next, next.upload);
    }
  } finally {
    pumping = false;
  }
}

async function send(entry: Entry, upload: OpenedSheetUpload): Promise<void> {
  patch(entry.key, { state: "uploading", error: null });
  try {
    await sendSheetChunks({
      collectionId: entry.collectionId,
      upload,
      file: entry.file,
      onProgress: ({ fraction }) => patch(entry.key, { fraction }),
    });
    await finalizeSheetUpload(entry.collectionId, upload.id);
  } catch (err) {
    leaveRound();
    patch(entry.key, { state: "failed", error: errorText(err, "Failed to upload the scan.") });
    return;
  }
  // In the server's queue now, where the panel draws it from the collection's scans being prepared.
  sentFileNames.set(upload.id, entry.fileName);
  round = { ...round, sent: round.sent + 1 };
  remove(entry.key);
  const sent = { collectionId: entry.collectionId, purchaseId: entry.purchaseId, uploadId: upload.id };
  for (const listener of sentListeners) listener(sent);
}

/** Send a failed file again, from where the server got to. It takes its turn after the file being
 * sent now, not before it. */
export function retryQueuedScan(key: string): void {
  const entry = entries.find((e) => e.key === key);
  if (!entry || entry.state !== "failed") return;
  joinRound(1);
  patch(key, { state: "waiting", error: null });
  void pump();
}

/** Drop a file from the batch: a refusal read, or a failure not worth trying again. What the server
 * holds of it goes too. */
export async function discardQueuedScan(key: string): Promise<void> {
  const entry = entries.find((e) => e.key === key);
  if (!entry || entry.state === "uploading" || entry.state === "opening") return;
  remove(key);
  if (entry.upload) {
    await discardSheetUpload(entry.collectionId, entry.upload.id).catch(() => {});
  }
}

// ── The tab around it ─────────────────────────────────────────────────────────────────────────

let hooksInstalled = false;

/** Installed with the first file and left in place: each one is a no-op while nothing is unsent. */
function installPageHooks() {
  if (hooksInstalled || typeof window === "undefined") return;
  hooksInstalled = true;

  // The browser's own *Leave site?* while something is unsent. It cannot say what — browsers show
  // their own words — but it is asked at the one moment the batch can still be saved.
  window.addEventListener("beforeunload", (e) => {
    if (unsent().length === 0) return;
    e.preventDefault();
    // Older browsers ask only when this is set.
    e.returnValue = "";
  });

  // The tab is going: stop what it opened and did not finish, so the purchase says which files were
  // never sent the next time it is opened, and the half-sent one's parts are not kept.
  window.addEventListener("pagehide", (e) => {
    if (e.persisted) return;
    for (const [collectionId, ids] of uploadIdsByCollection(unsent())) {
      interruptSheetUploads(collectionId, ids);
    }
  });

  // A file waiting behind a 200 MB card sends nothing for a long time, and would otherwise look
  // like one whose tab closed. The one being sent says it is alive with every piece.
  window.setInterval(() => {
    const idle = unsent().filter((e) => e.state !== "uploading");
    for (const [collectionId, ids] of uploadIdsByCollection(idle)) {
      void keepSheetUploadsAlive(collectionId, ids);
    }
  }, SCAN_UPLOAD_KEEPALIVE_MS);
}

function uploadIdsByCollection(list: readonly Entry[]): Map<string, string[]> {
  const byCollection = new Map<string, string[]>();
  for (const e of list) {
    if (!e.upload) continue;
    const ids = byCollection.get(e.collectionId) ?? [];
    ids.push(e.upload.id);
    byCollection.set(e.collectionId, ids);
  }
  return byCollection;
}

// ── Reading it ────────────────────────────────────────────────────────────────────────────────

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const NONE: readonly Entry[] = [];

function useEntries(): readonly Entry[] {
  return useSyncExternalStore(
    subscribe,
    () => entries,
    () => NONE
  );
}

/** The files of one order this tab is sending or has failed to send, in the order they were chosen. */
export function useQueuedScans(collectionId: string, purchaseId: string): QueuedScan[] {
  const all = useEntries();
  return useMemo(
    () =>
      all
        .filter((e) => e.collectionId === collectionId && e.purchaseId === purchaseId)
        .map(toScan),
    [all, collectionId, purchaseId]
  );
}

/** Every file of the collection this tab is sending or has failed to send — the panel's (#2099). */
export function useCollectionQueuedScans(collectionId: string): QueuedScan[] {
  const all = useEntries();
  return useMemo(
    () => all.filter((e) => e.collectionId === collectionId).map(toScan),
    [all, collectionId]
  );
}

const NO_ROUND: UploadRound = { sent: 0, total: 0 };

/** The current round of sending, for *Uploading 3 of 12*. */
export function useUploadRound(): UploadRound {
  return useSyncExternalStore(
    subscribe,
    () => round,
    () => NO_ROUND
  );
}

/** The file a sent upload was, if this tab sent it. */
export function sentScanFileName(uploadId: string): string | null {
  return sentFileNames.get(uploadId) ?? null;
}

/** An entry as the screen sees it — without the file and the upload it is sending. */
function toScan(e: Entry): QueuedScan {
  return {
    key: e.key,
    collectionId: e.collectionId,
    purchaseId: e.purchaseId,
    documentName: e.documentName,
    fileName: e.fileName,
    side: e.side,
    batchNo: e.batchNo,
    label: e.label,
    state: e.state,
    fraction: e.fraction,
    error: e.error,
  };
}

/** Be told each time a file's last piece has arrived and it is the server's to prepare. */
export function onScanSent(listener: (sent: SentScan) => void): () => void {
  sentListeners.add(listener);
  return () => sentListeners.delete(listener);
}
