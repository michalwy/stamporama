import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { isHeld } from "./disposal";
import { COPY_VALUATION_SELECT, copyValuationOf, valuateItemRows } from "./item-valuation";
import { loadRealizationRatios, primaryAreaIdOf } from "./realization-ratios";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import type { CopyEstimateInput } from "./offer-price-table";

// **Estimated value for a given list of copies** (#1829): each held copy's catalogue value × the
// learned realisation ratio its stamp's area, its condition and its issue year resolve to (#520,
// #1828). What the offer's price table suggests, and what a new offer is seeded with.
//
// The catalogue value is `valuateItemRows`'s — the area's primary catalogue, format factors, the
// unknown-variant rollup, the copy's fault reduction — the same figure the holdings summary and the
// ratio's own denominator read, so the two halves of the multiplication are about the same number.
// The ratio is asked about the copy's own stamp, which is what the ladder buckets on.
//
// Only **held** copies count (#396), the holdings summary's rule, so a sold set adds nothing. A copy
// valued at a **recorded** figure (#747) is left out: it has no catalogue value to correct.
//
// Ownership is not checked here; every caller has already resolved the collection for its owner.

const ESTIMATE_ROW_SELECT = {
  id: true,
  stampId: true,
  conditionId: true,
  certificateStatusId: true,
  formatId: true,
  disposedAt: true,
  deliveryState: true,
  ...COPY_VALUATION_SELECT,
  stamp: {
    select: {
      issuedYear: true,
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      variants: { select: VARIANT_FLAG_SELECT },
    },
  },
} satisfies Prisma.ItemSelect;

/**
 * Each group's held copies as {@link CopyEstimateInput}s — one entry per copy that could be
 * estimated, none for the rest. Every group key is answered, with an empty list where nothing could.
 */
export async function estimateCopiesByGroup(
  collectionId: string,
  groups: { key: string; itemIds: string[] }[]
): Promise<Map<string, CopyEstimateInput[]>> {
  const allIds = [...new Set(groups.flatMap((g) => g.itemIds))];
  const rows =
    allIds.length === 0
      ? []
      : await prisma.item.findMany({
          where: { id: { in: allIds }, collectionId },
          select: ESTIMATE_ROW_SELECT,
        });
  const held = rows.filter(isHeld);
  const [valuations, ratios] = await Promise.all([
    valuateItemRows(
      collectionId,
      held.map((row) => ({
        id: row.id,
        stampId: row.stampId,
        conditionId: row.conditionId,
        certificateStatusId: row.certificateStatusId,
        formatId: row.formatId,
        unknownVariant: isUnknownVariantStamp(row.stamp),
        ...copyValuationOf(row),
      }))
    ),
    held.length === 0 ? null : loadRealizationRatios(collectionId),
  ]);
  const byId = new Map<string, CopyEstimateInput>();
  for (const row of held) {
    const valuation = valuations.get(row.id);
    if (!ratios || !valuation || valuation.explicit || valuation.baseAmount === null) continue;
    const ratio = ratios.resolve({
      areaId: primaryAreaIdOf(row.stamp.stampAreaLinks),
      conditionId: row.conditionId,
      issuedYear: row.stamp.issuedYear,
    });
    byId.set(row.id, {
      catalogueBase: valuation.baseAmount,
      ratio: ratio.ratio,
      level: ratio.level,
      bucketLabel: ratio.bucketLabel,
      n: ratio.n,
    });
  }
  return new Map(
    groups.map((g) => [
      g.key,
      g.itemIds.map((id) => byId.get(id)).filter((copy) => copy !== undefined),
    ])
  );
}
