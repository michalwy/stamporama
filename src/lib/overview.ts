import "server-only";
import { prisma } from "./db";
import { getHoldingsValuation, listIssueGroupCompleteness } from "./items";
import type { HoldingsSummary } from "./valuation";
import { aggregateCostBasis, type CostBasisTotal } from "./cost-basis";
import { offersSummary } from "./offers";
import { auctionLotExposure } from "./auctions";
import { realizedProceedsByGroup, realizedProceedsForItems } from "./sales";
import { summarizePurchaseReturn, type PurchaseReturnCopy } from "./purchase-return";
import { openWantGapSummary, type OpenWantGapSummary } from "./wants";
import { readCollectionAreas } from "./areas";
import {
  buildGrowthSeries,
  classifyPurchaseReturns,
  rollUpAreaCoverage,
  tallyChecklists,
  type AreaCoverageRollup,
  type ChecklistTally,
  type GrowthMonth,
  type PurchaseRecoupTally,
} from "./overview-rules";

/**
 * The Overview screen's two reads (#649–#651; decided in #397): a financial and a progress
 * picture of one collection, every figure an aggregate of reads that already exist. The screen is
 * an entry point — each tile links into the list screen holding the underlying rows — so nothing
 * here is a source of truth: it states sums the detail screens can be asked to itemize.
 *
 * The rules the figures hold to (#650): everything is in the collection's base currency, with
 * unpriced and unconvertible rows **counted apart rather than silently dropped**
 * (`offer-summary.ts`'s own separation); catalogue value and market value are different claims and
 * are never summed into one figure; and each tile is one server read over the whole set — no N+1
 * across copies, which is what `realizedProceedsByGroup` exists for.
 */

async function assertCollectionOwner(
  ownerId: string,
  collectionId: string
): Promise<{ baseCurrency: string }> {
  const collection = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true, baseCurrency: true },
  });
  if (!collection || collection.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
  return { baseCurrency: collection.baseCurrency };
}

// ── Value (#650) ─────────────────────────────────────────────────────────────

export interface OverviewValue {
  baseCurrency: string;
  /** Holdings vs. acquisition cost — catalogue value, market value where known, cost and
   * write-off, straight from the holdings read (`getHoldingsValuation`, the Copies screen's own
   * default scope). Catalogue and market stay two figures. */
  holdings: HoldingsSummary;
  /** Capital on the market: what active listings ask and what open auction bids commit — money
   * committed rather than held, and two different claims (would receive vs. would pay), so they
   * are stated side by side and never summed. */
  market: {
    asking: {
      amount: string;
      offerCount: number;
      setCount: number;
      unpricedCount: number;
      unconvertibleCount: number;
    };
    exposure: {
      committed: string;
      ceiling: string;
      payableCount: number;
      uncappedCount: number;
      unconvertibleCount: number;
    };
  };
  /** Realized P/L over recorded sales: net proceeds (handling, commission, my shipping and the
   * frozen FX already inside, `sale-allocation.ts`) against the sold copies' cost basis. */
  realized: {
    proceeds: string;
    /** `proceeds − known cost of the sold copies`. The pending/none cost counts ride beside it in
     * {@link soldCost} — a profit over a cost that is not settled says so, it does not guess. */
    profit: string;
    saleCount: number;
    soldCount: number;
    /** Sold copies whose share of a mixed sale line could not be split (ADR-0012 §6.3) — they are
     * in `soldCount` and contribute nothing to `proceeds`; unknown is not zero. */
    unresolvedCount: number;
    soldCost: CostBasisTotal;
  };
  /** Which purchases have returned their cost (#559's per-order figure, classified across every
   * measured order at once). */
  purchases: PurchaseRecoupTally;
}

export async function getOverviewValue(
  ownerId: string,
  collectionId: string
): Promise<OverviewValue> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const [holdings, offers, exposure, realized, purchases, saleCount] = await Promise.all([
    // The Copies screen's own default scope, so the tile and the list it links to agree.
    getHoldingsValuation(ownerId, collectionId, { excludeGone: true }),
    // Active listings only — the tile claims money *on the market*, and it links to
    // `/offers?state=active`, so the figure must range over exactly those rows.
    offersSummary(ownerId, collectionId, { states: ["active"] }),
    // The watchlist's own default scope (open lots), for the same entry-point reason.
    auctionLotExposure(ownerId, collectionId, {}),
    realizedOverSoldCopies(collectionId, baseCurrency),
    purchaseRecoup(collectionId, baseCurrency),
    prisma.sale.count({ where: { collectionId } }),
  ]);

  return {
    baseCurrency,
    holdings,
    market: {
      asking: {
        amount: offers.askingBaseAmount,
        offerCount: offers.offerCount,
        setCount: offers.setCount,
        unpricedCount: offers.unpricedCount,
        unconvertibleCount: offers.unconvertibleCount,
      },
      exposure: {
        committed: exposure.committedTotal,
        ceiling: exposure.ceilingTotal,
        payableCount: exposure.payableCount,
        uncappedCount: exposure.uncappedCount,
        unconvertibleCount: exposure.unconvertibleCount,
      },
    },
    realized: { ...realized, saleCount },
    purchases,
  };
}

/** Net proceeds and cost basis over every copy that left on a sale — one allocation pass over the
 * touched sales, one cost aggregation over the sold copies. */
async function realizedOverSoldCopies(collectionId: string, baseCurrency: string) {
  const sold = await prisma.item.findMany({
    where: { collectionId, saleLineItems: { some: {} } },
    select: { id: true, costBasis: true, lotId: true, lot: { select: { status: true } } },
  });
  const proceeds = await realizedProceedsForItems(
    collectionId,
    sold.map((s) => s.id)
  );
  const soldCost = aggregateCostBasis(
    sold.map((s) => ({
      costBasis: s.costBasis == null ? null : s.costBasis.toFixed(2),
      lotId: s.lotId,
      lotStatus: s.lot?.status ?? null,
    })),
    baseCurrency
  );
  const proceedsCents = Math.round(proceeds.total * 100);
  const costCents = Math.round(Number(soldCost.totalCostBasis) * 100);
  return {
    proceeds: (proceedsCents / 100).toFixed(2),
    profit: ((proceedsCents - costCents) / 100).toFixed(2),
    soldCount: sold.length,
    unresolvedCount: proceeds.unresolved.size,
    soldCost,
  };
}

/** Every purchase's return in one pass: the arrived copies grouped by purchase, the sale side
 * attributed per purchase by `realizedProceedsByGroup`, and #559's own roll-up run per group. */
async function purchaseRecoup(
  collectionId: string,
  baseCurrency: string
): Promise<PurchaseRecoupTally> {
  // `returnOverCopies`' scope (#559): everything that arrived, sold or not, disposed included —
  // that money really was spent — and never-delivered copies left out, carrying no cost basis.
  const rows = await prisma.item.findMany({
    where: { collectionId, lotId: { not: null }, deliveryState: { not: "not_delivered" } },
    select: {
      id: true,
      costBasis: true,
      lotId: true,
      lot: { select: { status: true, purchaseId: true } },
    },
  });

  const groupOf = new Map<string, string>();
  for (const row of rows) {
    if (row.lot?.purchaseId) groupOf.set(row.id, row.lot.purchaseId);
  }
  const proceedsByPurchase = await realizedProceedsByGroup(collectionId, groupOf);

  const copiesByPurchase = new Map<string, PurchaseReturnCopy[]>();
  for (const row of rows) {
    const purchaseId = row.lot?.purchaseId;
    if (!purchaseId) continue;
    const proceeds = proceedsByPurchase.get(purchaseId)!;
    const copy: PurchaseReturnCopy = {
      id: row.id,
      costBasis: row.costBasis == null ? null : row.costBasis.toFixed(2),
      lotId: row.lotId,
      lotStatus: row.lot?.status ?? null,
      sold: proceeds.resolved.has(row.id) || proceeds.unresolved.has(row.id),
      proceedsResolved: proceeds.resolved.has(row.id),
    };
    const list = copiesByPurchase.get(purchaseId);
    if (list) list.push(copy);
    else copiesByPurchase.set(purchaseId, [copy]);
  }

  const returns = [...copiesByPurchase.entries()].map(([purchaseId, copies]) =>
    summarizePurchaseReturn(copies, proceedsByPurchase.get(purchaseId)!.total, baseCurrency)
  );
  return classifyPurchaseReturns(returns);
}

// ── Progress (#651) ──────────────────────────────────────────────────────────

/** How many months the growth tile looks back, current month included. */
const GROWTH_MONTHS = 12;

export interface OverviewProgress {
  /** Checklist coverage rolled up to the root areas, worst-covered first; areas with no checklist
   * are named as untracked rather than reported complete. */
  coverage: AreaCoverageRollup;
  checklists: ChecklistTally;
  /** Copies and issues added per month, derived from creation dates with no new storage (#397's
   * "history is recorded, not reconstructed"). */
  growth: { months: GrowthMonth[] };
  wants: OpenWantGapSummary;
}

export async function getOverviewProgress(
  ownerId: string,
  collectionId: string
): Promise<OverviewProgress> {
  await assertCollectionOwner(ownerId, collectionId);

  const [areas, issues] = await Promise.all([
    readCollectionAreas(collectionId),
    prisma.issue.findMany({
      where: { collectionId, checklists: { some: {} } },
      select: { id: true, collectionAreaId: true },
    }),
  ]);

  const [completeness, growthMonths, wants] = await Promise.all([
    // The held-copy scope the Copies screen defaults to — coverage counts what is actually held.
    listIssueGroupCompleteness(
      ownerId,
      collectionId,
      issues.map((i) => i.id),
      { excludeGone: true }
    ),
    growthSeries(collectionId),
    openWantGapSummary(ownerId, collectionId),
  ]);

  const checklistRows = issues.flatMap((issue) =>
    (completeness[issue.id] ?? []).map((c) => ({
      checklistId: c.checklistId,
      issueId: issue.id,
      name: c.name,
      owned: c.owned,
      requiredCount: c.requiredCount,
    }))
  );

  return {
    coverage: rollUpAreaCoverage(
      areas.map((a) => ({ id: a.id, parentId: a.parentId, name: a.name })),
      issues.map((i) => ({ issueId: i.id, areaId: i.collectionAreaId })),
      checklistRows
    ),
    checklists: tallyChecklists(checklistRows),
    growth: { months: growthMonths },
    wants,
  };
}

/** Monthly creation counts for the growth tile — grouped in SQL rather than fetched row by row,
 * since the input is every copy the collection ever gained. Timestamps are stored UTC, so the
 * month boundary is UTC too, matching `monthKey`. */
async function growthSeries(collectionId: string): Promise<GrowthMonth[]> {
  const now = new Date();
  const windowStart = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (GROWTH_MONTHS - 1), 1)
  );
  const [copies, issues] = await Promise.all([
    prisma.$queryRaw<{ month: string; count: number }[]>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
             COUNT(*)::int AS count
      FROM "item"
      WHERE "collectionId" = ${collectionId} AND "createdAt" >= ${windowStart}
      GROUP BY 1`,
    prisma.$queryRaw<{ month: string; count: number }[]>`
      SELECT to_char(date_trunc('month', "createdAt"), 'YYYY-MM') AS month,
             COUNT(*)::int AS count
      FROM "issue"
      WHERE "collectionId" = ${collectionId} AND "createdAt" >= ${windowStart}
      GROUP BY 1`,
  ]);
  return buildGrowthSeries(copies, issues, GROWTH_MONTHS, now);
}
