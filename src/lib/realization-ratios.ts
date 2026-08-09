import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { extractMarketDatapoints, type MarketLotInput } from "./market-value";
import { valuateItemRows, type ValuationRow } from "./items";
import { getCollectionBaseCurrency } from "./pricing";
import {
  ratioBucketLabel,
  resolveRealizationRatio,
  type RatioObservation,
  type RatioSubject,
  type ResolvedRatio,
} from "./realization-ratio";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";

// **The learned realization ratio, read out of the lots already recorded** (#520; ADR-0029 §2).
//
// The ladder itself is in the pure `realization-ratio.ts`. What this module does is the three
// things that need a database: turn every closed, priced lot of the collection into datapoints
// (ADR-0022's own extraction, reused rather than re-derived), divide each one by the catalogue
// value of its key, and name the bucket the ladder came back with.
//
// **Computed on demand, nothing stored** (ADR-0029 §10). A stored ratio table would need
// invalidating on every lot edit, every catalogue price change and every area reassignment, and the
// figures move slowly enough that recomputing them per page costs less than one class of staleness
// bug.
//
// **The whole collection is read, not the stamps being anchored.** Bucket 4 is *every* ratio
// recorded, and buckets 1–3 are ratios about other stamps by definition — the point of the ladder
// is to price a stamp that has no evidence of its own. So the query is the collection's closed
// lots, once, and the resolver it returns answers a whole page of lines off that one load.
//
// Catalogue values come from `valuateItemRows` (`items.ts`) exactly as `market-values.ts` takes
// them: the area's primary catalogue at its latest edition, format factors per ADR-0020, the
// unknown-variant rollup per #238, in the collection's base currency. The market side of the ratio
// is in the base currency too, so the ratio is unitless and applies to a catalogue value in any
// currency (ADR-0029 §5).
//
// Ownership is **not** checked here — every entry point is called from a module that has already
// resolved the collection for the owner.

const RATIO_LOT_SELECT = {
  id: true,
  endsAt: true,
  finalPrice: true,
  fxRateToBase: true,
  auctionSale: { select: { currency: true } },
  lines: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      quantity: true,
      stamp: {
        select: {
          issuedYear: true,
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          variants: { select: VARIANT_FLAG_SELECT },
          ...VARIANT_FLAG_SELECT,
        },
      },
    },
  },
} satisfies Prisma.AuctionLotSelect;

type RatioLotRow = Prisma.AuctionLotGetPayload<{ select: typeof RATIO_LOT_SELECT }>;
type RatioLineRow = RatioLotRow["lines"][number];

/** The area a stamp is priced under: its primary link, else whichever link it has. The same
 * resolution every other stamp surface makes, so a line and the evidence behind it are bucketed on
 * the same area. */
export function primaryAreaIdOf(links: { collectionAreaId: string; isPrimary: boolean }[]): string | null {
  const link = links.find((l) => l.isPrimary) ?? links[0];
  return link?.collectionAreaId ?? null;
}

/** A resolved ratio with the bucket named — what #511 renders and #510 anchors a line on. */
export interface RealizationRatio extends ResolvedRatio {
  /** e.g. `Polska Ludowa, MNH, 1945–1949`. */
  bucketLabel: string;
}

/**
 * The collection's ratio evidence, loaded once and asked many times.
 *
 * Every line of a page resolves its own sample — the period bucket is a window centred on the
 * stamp being anchored — so the resolver is a function over the loaded observations rather than a
 * precomputed table.
 */
export interface RealizationRatioResolver {
  resolve(subject: RatioSubject): RealizationRatio;
  /** Observations behind every answer, for a caller that wants to say how much was recorded at
   * all. Deduplication is per bucket, so this is the raw count. */
  observationCount: number;
}

/**
 * Load every ratio the collection has recorded and return a resolver over them.
 *
 * A collection with no closed lots yields a resolver that answers `fallback` to everything, which
 * is the cold start ADR-0029 §9 describes and not an error.
 */
export async function loadRealizationRatios(
  collectionId: string
): Promise<RealizationRatioResolver> {
  const [collection, lots] = await Promise.all([
    prisma.collection.findUnique({
      where: { id: collectionId },
      select: { bidFallbackPercent: true },
    }),
    prisma.auctionLot.findMany({
      where: {
        // The lifecycle plus a price, and nothing else (ADR-0022 §2): won, lost and merely observed
        // are all real prices the market paid.
        status: "closed",
        finalPrice: { not: null },
        auctionSale: { collectionId },
      },
      select: RATIO_LOT_SELECT,
    }),
  ]);
  const fallbackPercent = collection?.bidFallbackPercent ?? 100;

  if (lots.length === 0) return emptyResolver(fallbackPercent);

  const [baseCurrency, areas, conditions] = await Promise.all([
    getCollectionBaseCurrency(collectionId),
    prisma.collectionArea.findMany({ where: { collectionId }, select: { id: true, name: true } }),
    prisma.stampCondition.findMany({
      where: { collectionId },
      // Conditions are named by their **abbreviation** (`MNH`), which is what every other
      // figure-beside-a-condition surface prints.
      select: { id: true, abbreviation: true },
    }),
  ]);
  const areaNames = new Map(areas.map((a) => [a.id, a.name]));
  const conditionNames = new Map(conditions.map((c) => [c.id, c.abbreviation]));

  // Every line of every closed lot, valued in one pass — the lines the split weighs against are the
  // same ones that become ratios themselves.
  const valuations = await valuateItemRows(
    collectionId,
    lots.flatMap((lot) =>
      lot.lines.map<ValuationRow>((line) => ({
        id: line.id,
        stampId: line.stampId,
        conditionId: line.conditionId,
        certificateStatusId: line.certificateStatusId,
        formatId: line.formatId,
        unknownVariant: isUnknownVariantStamp(line.stamp),
      }))
    )
  );

  const lineRows = new Map<string, RatioLineRow>();
  for (const lot of lots) for (const line of lot.lines) lineRows.set(line.id, line);

  const input = lots.map<MarketLotInput>((lot) => ({
    lotId: lot.id,
    status: "closed",
    endsAt: lot.endsAt,
    finalPrice: lot.finalPrice?.toString() ?? null,
    fxRateToBase: lot.fxRateToBase?.toString() ?? null,
    inBaseCurrency: lot.auctionSale.currency === baseCurrency,
    lines: lot.lines.map((line) => ({
      lineId: line.id,
      stampId: line.stampId,
      conditionId: line.conditionId,
      certificateStatusId: line.certificateStatusId,
      formatId: line.formatId,
      quantity: line.quantity,
      unitCatalogueValue: valuations.get(line.id)?.baseAmount ?? null,
    })),
  }));

  const observations: RatioObservation[] = [];
  for (const point of extractMarketDatapoints(input)) {
    // A datapoint whose key has no catalogue value yields a market value but no ratio — there is
    // nothing to state it as a fraction of.
    const catalogueValue = valuations.get(point.lineId)?.baseAmount ?? null;
    if (catalogueValue === null || catalogueValue <= 0) continue;
    const line = lineRows.get(point.lineId);
    if (!line) continue;
    observations.push({
      lotId: point.lotId,
      split: point.split,
      ratio: point.amount / catalogueValue,
      areaId: primaryAreaIdOf(line.stamp.stampAreaLinks),
      conditionId: line.conditionId,
      issuedYear: line.stamp.issuedYear,
    });
  }

  return {
    observationCount: observations.length,
    resolve(subject) {
      const resolved = resolveRealizationRatio(subject, observations, fallbackPercent);
      return {
        ...resolved,
        bucketLabel: ratioBucketLabel(resolved, {
          areaName: subject.areaId ? (areaNames.get(subject.areaId) ?? null) : null,
          conditionName: conditionNames.get(subject.conditionId) ?? null,
        }),
      };
    },
  };
}

/** A resolver over no evidence at all: everything falls back, and nothing is queried to say so. */
function emptyResolver(fallbackPercent: number): RealizationRatioResolver {
  return {
    observationCount: 0,
    resolve(subject) {
      const resolved = resolveRealizationRatio(subject, [], fallbackPercent);
      return { ...resolved, bucketLabel: ratioBucketLabel(resolved, { areaName: null, conditionName: null }) };
    },
  };
}
