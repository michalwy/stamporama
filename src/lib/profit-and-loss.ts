import "server-only";
import { lotCostInputs } from "./cost-basis";
import { prisma } from "./db";
import { listSaleProfitRows, type SaleProfitRow } from "./sales";
import { NOT_TRADED_AWAY } from "./trade-exit";
import {
  buildProfitAndLoss,
  dateRangeBounds,
  type DateRange,
  type PeriodGranularity,
  type ProfitAndLossBreakdown,
  type WriteOffCopy,
} from "./profit-and-loss-rules";

/**
 * The profit and loss screen's reads (#1305). Compositions only: each sale's figure is the one its
 * own screen shows (`listSaleProfitRows`, the read the Overview's realized figure sums), and the
 * grouping is pure in `profit-and-loss-rules.ts`.
 */

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<{ baseCurrency: string }> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, baseCurrency: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  return { baseCurrency: col.baseCurrency };
}

/**
 * The copies written off in a range: disposed of as lost, damaged or other (#394), by when the
 * disposal was recorded. A copy that also went out on a sale or a trade is that exit's to account
 * for, never a second loss here — the holdings bar's own `excludeGone` scope (#396).
 */
async function listWriteOffCopies(collectionId: string, range: DateRange): Promise<WriteOffCopy[]> {
  const bounds = dateRangeBounds(range);
  const rows = await prisma.item.findMany({
    where: {
      collectionId,
      disposedAt: { not: null, ...bounds },
      saleLineItems: { none: {} },
      ...NOT_TRADED_AWAY,
    },
    select: { disposedAt: true, costBasis: true, lotId: true, lot: { select: { status: true, price: true } } },
  });
  return rows.map((row) => ({
    disposedAt: row.disposedAt!,
    costBasis: row.costBasis == null ? null : row.costBasis.toFixed(2),
    lotId: row.lotId,
    ...lotCostInputs(row.lot),
  }));
}

export interface ProfitAndLoss extends ProfitAndLossBreakdown {
  baseCurrency: string;
  range: DateRange;
  granularity: PeriodGranularity;
}

/** The totals, the periods and the platforms over one range of dates. */
export async function getProfitAndLoss(
  ownerId: string,
  collectionId: string,
  range: DateRange,
  granularity: PeriodGranularity
): Promise<ProfitAndLoss> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const [sales, writeOffs] = await Promise.all([
    listSaleProfitRows(collectionId, baseCurrency, range),
    listWriteOffCopies(collectionId, range),
  ]);
  return {
    baseCurrency,
    range,
    granularity,
    ...buildProfitAndLoss(sales, writeOffs, granularity),
  };
}

export interface ProfitAndLossSalesPage {
  items: SaleProfitRow[];
  baseCurrency: string;
  nextCursor: string | null;
}

/** One page of the by-sale list, newest first, for the shared infinite scroll. */
export async function listProfitAndLossSales(
  ownerId: string,
  collectionId: string,
  range: DateRange,
  offset = 0,
  pageSize = 50
): Promise<ProfitAndLossSalesPage> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const rows = await listSaleProfitRows(collectionId, baseCurrency, range, {
    skip: offset,
    take: pageSize + 1,
  });
  const hasMore = rows.length > pageSize;
  return {
    items: hasMore ? rows.slice(0, pageSize) : rows,
    baseCurrency,
    nextCursor: hasMore ? String(offset + pageSize) : null,
  };
}
