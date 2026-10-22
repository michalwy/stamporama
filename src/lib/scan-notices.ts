import "server-only";
import { prisma } from "./db";
import { intakeDocumentRef } from "./purchase-kind";
import {
  asScanUploadStatus,
  queueAhead,
  scanCardTitle,
  type ScanUploadStatus,
} from "./scan-upload-status-rules";

/**
 * What the notification centre says about card scans (#1567).
 *
 * Preparing an uploaded scan runs in the background now, and the collector may be anywhere in the
 * app when it fails — so the panel is where they learn of it: a failed preparation nobody has
 * retried or thrown away, which lasts until one of the two is done, or the sweep takes it.
 *
 * A scan that is ready to cut is not reported (#1675): the purchase's cards already say so, and
 * with scans uploaded many at a time the notices only filled the panel.
 *
 * And, since #2099, what the **panel of scans being added** reads for the scans already in the
 * server's hands — waiting their turn to be prepared or being prepared — on whichever screen the
 * collector is on.
 */

interface ScanNotice {
  id: string;
  label: string;
  detail: string;
  at: Date | null;
  purchaseId: string;
}

async function assertOwner(ownerId: string, collectionId: string): Promise<void> {
  const found = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!found) throw new Error("Collection not found");
}

/** Preparations that failed and are still waiting for a retry or a discard. Newest first. */
export async function failedScanPreparations(
  ownerId: string,
  collectionId: string,
  limit: number
): Promise<{ total: number; uploads: ScanNotice[] }> {
  await assertOwner(ownerId, collectionId);
  const where = { collectionId, status: "failed" };
  const [total, rows] = await Promise.all([
    prisma.scanUpload.count({ where }),
    prisma.scanUpload.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      select: {
        id: true,
        side: true,
        batchNo: true,
        label: true,
        error: true,
        updatedAt: true,
        purchaseId: true,
        purchase: { select: { kind: true, purchaseNo: true } },
      },
    }),
  ]);
  return {
    total,
    uploads: rows.map((row) => ({
      id: row.id,
      label: scanCardTitle(row),
      detail: `${intakeDocumentRef(row.purchase)}${row.error ? ` · ${row.error}` : ""}`,
      at: row.updatedAt,
      purchaseId: row.purchaseId,
    })),
  };
}

/** A scan of the collection the server is preparing or will prepare next (#2099). */
export interface ScanInPreparation {
  id: string;
  status: Extract<ScanUploadStatus, "queued" | "preparing">;
  title: string;
  purchaseId: string;
  documentName: string;
  /** How many scans of any collection are prepared before this one, while it waits its turn. */
  ahead: number | null;
}

/** Every scan of the collection waiting its turn to be prepared or being prepared, in the queue's
 * order. The places are counted over the instance's queue, as the section's cards count them. */
export async function scansInPreparation(
  ownerId: string,
  collectionId: string
): Promise<ScanInPreparation[]> {
  await assertOwner(ownerId, collectionId);
  const [rows, queue] = await Promise.all([
    prisma.scanUpload.findMany({
      where: { collectionId, status: { in: ["queued", "preparing"] } },
      orderBy: [{ queuedAt: "asc" }, { id: "asc" }],
      select: {
        id: true,
        status: true,
        side: true,
        batchNo: true,
        label: true,
        purchaseId: true,
        purchase: { select: { kind: true, purchaseNo: true } },
      },
    }),
    prisma.scanUpload.findMany({
      where: { status: { in: ["queued", "preparing"] } },
      select: { id: true, status: true, queuedAt: true },
    }),
  ]);
  const ahead = queueAhead(queue.map((q) => ({ ...q, status: asScanUploadStatus(q.status) })));
  return rows.map((row) => ({
    id: row.id,
    status: row.status === "preparing" ? "preparing" : "queued",
    title: scanCardTitle(row),
    purchaseId: row.purchaseId,
    documentName: intakeDocumentRef(row.purchase),
    ahead: ahead.get(row.id) ?? null,
  }));
}
