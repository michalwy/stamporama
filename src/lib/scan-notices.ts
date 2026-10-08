import "server-only";
import { prisma } from "./db";
import { isOpeningBalance } from "./purchase-kind";

/**
 * What the notification centre says about card scans (#1567).
 *
 * Preparing an uploaded scan runs in the background now, and the collector may be anywhere in the
 * app when it fails — so the panel is where they learn of it: a failed preparation nobody has
 * retried or thrown away, which lasts until one of the two is done, or the sweep takes it.
 *
 * A scan that is ready to cut is not reported (#1675): the purchase's cards already say so, and
 * with scans uploaded many at a time the notices only filled the panel.
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
