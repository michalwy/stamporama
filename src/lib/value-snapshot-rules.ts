import type { HoldingsSummary } from "./valuation";
import { costBasisCopyCount } from "./valuation";
import { convertViaEur } from "./ecb-rates";

/**
 * The pure half of the daily value snapshots (#652; ADR-0053) — which day a pass writes, what a
 * holdings summary is stored as, the rate table restated into the base currency, and which copies
 * each area's subtree holds. The reads and the writes are in `value-snapshots.ts`.
 */

/** The UTC calendar day `now` falls on, as the midnight a `DATE` column round-trips. Timestamps are
 * stored UTC everywhere here, and the growth tile buckets by UTC month for the same reason. */
export function snapshotDay(now: Date): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

/** The stored columns of one holdings summary — shared by the collection row and every area row. */
export interface HoldingsSnapshotFields {
  catalogueValue: string;
  catalogueUncertainValue: string;
  cataloguePricedCount: number;
  catalogueUnpricedCount: number;
  catalogueUnconvertibleCount: number;
  catalogueUncertainCount: number;
  marketValue: string;
  marketValuedCount: number;
  marketNoEvidenceCount: number;
  acquisitionCost: string;
  costKnownCount: number;
  costPendingCount: number;
  costNoneCount: number;
  copiesHeld: number;
}

/** A holdings summary as stored: every sum with the counts that say what it left out. The write-off
 * side is not recorded — a copy that is gone is not part of what the collection is worth that day. */
export function holdingsSnapshotFields(summary: HoldingsSummary): HoldingsSnapshotFields {
  return {
    catalogueValue: summary.totalBaseAmount,
    catalogueUncertainValue: summary.uncertainBaseAmount,
    cataloguePricedCount: summary.pricedCount,
    catalogueUnpricedCount: summary.unpricedCount,
    catalogueUnconvertibleCount: summary.unconvertibleCount,
    catalogueUncertainCount: summary.uncertainCount,
    marketValue: summary.market.totalBaseAmount,
    marketValuedCount: summary.market.valuedCount,
    marketNoEvidenceCount: summary.market.noEvidenceCount,
    acquisitionCost: summary.cost.totalCostBasis,
    costKnownCount: summary.cost.knownCount,
    costPendingCount: summary.cost.pendingCount,
    costNoneCount: summary.cost.noneCount,
    // The cost states partition the held copies, so their sum is the held count.
    copiesHeld: costBasisCopyCount(summary.cost),
  };
}

/**
 * The collection's EUR-anchored rate table restated as `currency → rate into baseCurrency`, the base
 * itself left out. Empty when the table cannot express the base — nothing was converted then, and a
 * row claiming rates it did not use would be worse than none.
 */
export function ratesIntoBase(
  table: Map<string, number>,
  baseCurrency: string
): Record<string, number> {
  if (!table.has(baseCurrency)) return {};
  const out: Record<string, number> = {};
  for (const currency of [...table.keys()].sort()) {
    if (currency === baseCurrency) continue;
    out[currency] = convertViaEur(table, currency, baseCurrency);
  }
  return out;
}

/**
 * Which copies each area's **subtree** holds — the Copies screen's area filter (#385): a copy counts
 * under every area its stamp is linked into and every ancestor of those, once per area however many
 * of its links land in the same subtree. Areas holding nothing map to an empty list rather than
 * being absent, so every area gets a row.
 */
export function copyIdsByAreaSubtree(
  areas: { id: string; parentId: string | null }[],
  copies: { id: string; areaIds: string[] }[]
): Map<string, string[]> {
  const parentOf = new Map(areas.map((a) => [a.id, a.parentId]));
  const out = new Map<string, string[]>(areas.map((a) => [a.id, []]));
  for (const copy of copies) {
    const reached = new Set<string>();
    for (const linked of copy.areaIds) {
      // Walk up until the root, or until an area already reached — which also ends a cycle.
      let at: string | null | undefined = linked;
      while (at && out.has(at) && !reached.has(at)) {
        reached.add(at);
        at = parentOf.get(at);
      }
    }
    for (const areaId of reached) out.get(areaId)!.push(copy.id);
  }
  return out;
}
