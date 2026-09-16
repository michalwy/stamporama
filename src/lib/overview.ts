import "server-only";
import { lotCostInputs } from "./cost-basis";
import { prisma } from "./db";
import { getHoldingsValuation, listIssueGroupCompleteness } from "./items";
import type { HoldingsSummary } from "./valuation";
import { offersSummary } from "./offers";
import { auctionLotExposure } from "./auctions";
import { realizedProceedsByGroup, realizedProfit } from "./sales";
import type { ProfitFigures } from "./sale-profit";
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
import { buildValueHistory, type ValueHistory } from "./value-history-rules";

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
  /** Realized P/L over recorded sales (#168): every sale's own profit figure — net proceeds
   * (handling, commission, my shipping and the frozen FX already inside) against the cost basis of
   * the copies it could count — added up. Copies with no rate, a pending or missing cost, or an
   * unsplittable share are left out of both sides and counted by why; unknown is not zero. */
  realized: ProfitFigures & { saleCount: number };
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
    realizedProfit(collectionId, baseCurrency),
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

/** Every purchase's return in one pass: the arrived copies grouped by purchase, the sale side
 * attributed per purchase by `realizedProceedsByGroup`, and #559's own roll-up run per group. */
async function purchaseRecoup(
  collectionId: string,
  baseCurrency: string
): Promise<PurchaseRecoupTally> {
  // `returnOverCopies`' scope (#559): everything that arrived, sold or not, disposed included —
  // that money really was spent — and never-delivered copies left out, carrying no cost basis.
  // Purchases only: an opening balance spent nothing, so it has no cost to have returned (#1324),
  // and its opening value must not sit in the tile's *spent* total.
  const rows = await prisma.item.findMany({
    where: {
      collectionId,
      lotId: { not: null },
      lot: { purchase: { kind: "purchase" } },
      deliveryState: { not: "not_delivered" },
    },
    select: {
      id: true,
      costBasis: true,
      lotId: true,
      lot: { select: { status: true, price: true, purchaseId: true } },
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
      ...lotCostInputs(row.lot),
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

// ── Value over time (#653) ───────────────────────────────────────────────────

/**
 * The value-over-time chart's series: the daily snapshots #652 recorded, read as stored and never
 * re-valued (ADR-0053). Every recorded day is returned — the chart's span is the collection's whole
 * history — with each top-level area's subtree value beside it for the split.
 */
export async function getOverviewValueHistory(
  ownerId: string,
  collectionId: string
): Promise<ValueHistory> {
  const { baseCurrency } = await assertCollectionOwner(ownerId, collectionId);
  const [rows, rootAreas] = await Promise.all([
    prisma.collectionValueSnapshot.findMany({
      where: { collectionId },
      orderBy: { day: "asc" },
      select: {
        day: true,
        baseCurrency: true,
        catalogueValue: true,
        acquisitionCost: true,
        marketValue: true,
        marketValuedCount: true,
        copiesHeld: true,
        catalogueUnpricedCount: true,
        catalogueUnconvertibleCount: true,
        costPendingCount: true,
        costNoneCount: true,
        areas: {
          where: { collectionArea: { parentId: null } },
          select: { collectionAreaId: true, catalogueValue: true },
        },
      },
    }),
    prisma.collectionArea.findMany({
      where: { collectionId, parentId: null },
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: { id: true, name: true },
    }),
  ]);

  return buildValueHistory(
    rows.map((row) => ({
      ...row,
      catalogueValue: row.catalogueValue.toFixed(2),
      acquisitionCost: row.acquisitionCost.toFixed(2),
      marketValue: row.marketValue.toFixed(2),
      areas: row.areas.map((area) => ({
        collectionAreaId: area.collectionAreaId,
        catalogueValue: area.catalogueValue.toFixed(2),
      })),
    })),
    baseCurrency,
    rootAreas.map((area) => ({ areaId: area.id, name: area.name }))
  );
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
