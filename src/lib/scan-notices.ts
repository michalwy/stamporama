import "server-only";
import { prisma } from "./db";
import { isOpeningBalance } from "./purchase-kind";

/**
 * What the notification centre says about card scans (#1567).
 *
 * Preparing an uploaded scan runs in the background now, and the collector may be anywhere in the
 * app when it finishes — so the panel is where they learn of it. Two reads, both of state the Card
 * scans section already shows:
 *
 * - **scans ready to cut**: a sheet with nothing cut from it yet, which is exactly the batch that
 *   offers *Review the front cut* / *Review the back cut*. Derived from the sheet rather than from
 *   the upload that made it, so it lasts as long as the work does and goes the moment the cut is
 *   committed — a notice that expired with the upload's bookkeeping would go quiet over a card still
 *   waiting;
 * - **scans that could not be prepared**: a failed preparation nobody has retried or thrown away,
 *   which lasts until one of the two is done, or the sweep takes it.
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

/** How the panel names the document a card belongs to. */
function documentName(p: { kind: string; purchaseNo: number }): string {
  return isOpeningBalance(p) ? `Opening balance #${p.purchaseNo}` : `Order #${p.purchaseNo}`;
}

function batchName(batchNo: number, label: string | null): string {
  return label ? `Batch ${batchNo} · ${label}` : `Batch ${batchNo}`;
}

/** Sheets nothing has been cut from, whose bytes are still there to cut. Newest first. */
export async function scanSheetsToCut(
  ownerId: string,
  collectionId: string,
  limit: number
): Promise<{ total: number; sheets: ScanNotice[] }> {
  await assertOwner(ownerId, collectionId);
  const where = {
    collectionId,
    purgedAt: null,
    OR: [
      { side: "front", frontTiles: { none: {} } },
      { side: "back", backTiles: { none: {} } },
    ],
  };
  const [total, rows] = await Promise.all([
    prisma.scanSheet.count({ where }),
    prisma.scanSheet.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      select: {
        id: true,
        side: true,
        batchNo: true,
        label: true,
        createdAt: true,
        purchaseId: true,
        purchase: { select: { kind: true, purchaseNo: true } },
      },
    }),
  ]);
  return {
    total,
    sheets: rows.map((row) => ({
      id: row.id,
      label: `${batchName(row.batchNo, row.label)}${row.side === "back" ? " — back" : ""}`,
      detail: documentName(row.purchase),
      at: row.createdAt,
      purchaseId: row.purchaseId,
    })),
  };
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
      label:
        row.side === "back" && row.batchNo != null
          ? `Back of batch ${row.batchNo}`
          : row.label
            ? `New card · ${row.label}`
            : "New card",
      detail: `${documentName(row.purchase)}${row.error ? ` · ${row.error}` : ""}`,
      at: row.updatedAt,
      purchaseId: row.purchaseId,
    })),
  };
}
