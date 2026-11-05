import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { isHeld } from "./disposal";
import { marketKeyOf, marketStampIdsOf } from "./market-value";
import { copyMarketTrend, type MarketTrendValue } from "./market-trend";
import { readStampMarketValues } from "./market-values";
import type { CopyMarketTrendInput } from "./offer-price-table";
import { loadRealizationRatios, primaryAreaIdOf } from "./realization-ratios";
import { reduceForFaults } from "./valuation";

// **Each copy's market figure brought to today's money** (#2461) — what the offer's *Market trend*
// row is summed from. The figures are the holdings summary's own market reads (`readStampMarketValues`,
// the source of `readMarketMedians`) for the same held copies, so Market trend is over exactly the
// copies Market is over, and a copy no trend applies to counts at the median Market counts it at.
// The trend is #2460's (`market-trend.ts`), the one a recommended bid's fair is anchored on.
//
// A second read of the copies, beside the holdings summary, for the reason Estimated is one
// (`copy-estimates.ts`): the holdings summary stays the measurement and knows nothing of trends.
//
// Ownership is not checked here; every caller has already resolved the collection for its owner.

const TREND_ROW_SELECT = {
  id: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  disposedAt: true,
  deliveryState: true,
  faultReductionPercent: true,
  candidates: { select: { stampId: true } },
  stamp: {
    select: {
      issuedYear: true,
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
    },
  },
} satisfies Prisma.ItemSelect;

/**
 * Each group's held copies with recorded results as {@link CopyMarketTrendInput}s — none for a copy
 * without. Every group key is answered, with an empty list where nothing could be.
 */
export async function marketTrendCopiesByGroup(
  collectionId: string,
  groups: { key: string; itemIds: string[] }[]
): Promise<Map<string, CopyMarketTrendInput[]>> {
  const allIds = [...new Set(groups.flatMap((g) => g.itemIds))];
  const rows =
    allIds.length === 0
      ? []
      : await prisma.item.findMany({ where: { id: { in: allIds }, collectionId }, select: TREND_ROW_SELECT });
  const held = rows
    .filter(isHeld)
    .map((row) => ({ ...row, candidateStampIds: row.candidates.length > 1 ? row.candidates.map((c) => c.stampId) : null }));
  const byId = new Map<string, CopyMarketTrendInput>();
  if (held.length > 0) {
    const [byStamp, ratios] = await Promise.all([
      readStampMarketValues(collectionId, marketStampIdsOf(held)),
      loadRealizationRatios(collectionId),
    ]);
    const values = new Map<string, MarketTrendValue>();
    for (const list of byStamp.values()) for (const value of list) values.set(marketKeyOf(value), value);
    const now = new Date();
    for (const row of held) {
      const input = copyMarketTrend(
        {
          ...row,
          areaId: primaryAreaIdOf(row.stamp.stampAreaLinks),
          issuedYear: row.stamp.issuedYear,
        },
        values,
        ratios,
        now,
        (amount) => reduceForFaults(amount, row.faultReductionPercent)
      );
      if (input) byId.set(row.id, input);
    }
  }
  return new Map(
    groups.map((g) => [g.key, g.itemIds.map((id) => byId.get(id)).filter((copy) => copy !== undefined)])
  );
}
