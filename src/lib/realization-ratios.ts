import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  extractMarketDatapoints,
  extractObservationDatapoints,
  type MarketLotInput,
} from "./market-value";
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
import { onlySettledLots, type SettledConditionLot } from "./auction-line-condition";
import { OBSERVATION_SELECT, observationInput } from "./price-observations";
import { anchoringResolver, resultMarket } from "./market-anchoring";
import { buildAnchoringMarketsMap, getCollectionHomeMarket } from "./market-anchorings";

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
// **Exact price observations from other people's auctions count too** (#1633; ADR-0063 §7): each is
// one stamp at one key, taken whole, read against its key's catalogue value exactly as a single-line
// lot is. Uncertain ones never do — the same rule market value follows.
//
// **Only results from a stamp's own anchoring markets teach** (#1634; ADR-0064 §4): a ratio is a
// datapoint over a catalogue value, and a datapoint its own stamp does not count is a hint there and
// a hint here. Each is judged by the stamp it is about, never by the stamp being anchored.
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
  // Named, dated and linkable — a bucket expanded into the lots it was learned from (#602) has to
  // reach them, and these are the same fields `market-values.ts` shows its own evidence with.
  auctionLotNo: true,
  lotNo: true,
  title: true,
  endsAt: true,
  finalPrice: true,
  fxRateToBase: true,
  auctionSale: {
    select: {
      id: true,
      name: true,
      currency: true,
      seller: { select: { market: true } },
      platform: { select: { market: true } },
    },
  },
  lines: {
    orderBy: { id: "asc" },
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      quantity: true,
      condition: { select: { abbreviation: true } },
      stamp: {
        select: {
          name: true,
          issuedYear: true,
          stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
          variants: { select: VARIANT_FLAG_SELECT },
          ...VARIANT_FLAG_SELECT,
        },
      },
    },
  },
} satisfies Prisma.AuctionLotSelect;

/** An observation as the ladder reads it: what market value reads, plus the stamp's area and year
 * the buckets are drawn on, and its name for the drill-down. */
const RATIO_OBSERVATION_SELECT = {
  ...OBSERVATION_SELECT,
  stamp: {
    select: {
      name: true,
      issuedYear: true,
      stampAreaLinks: { select: { collectionAreaId: true, isPrimary: true } },
      variants: { select: VARIANT_FLAG_SELECT },
      ...VARIANT_FLAG_SELECT,
    },
  },
} satisfies Prisma.PriceObservationSelect;

type RatioObservationRow = Prisma.PriceObservationGetPayload<{ select: typeof RATIO_OBSERVATION_SELECT }>;

type RatioLotPayload = Prisma.AuctionLotGetPayload<{ select: typeof RATIO_LOT_SELECT }>;
/** A lot whose every line has its condition settled — the only kind that is evidence (#1623). */
type RatioLotRow = SettledConditionLot<RatioLotPayload>;
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
  /**
   * The lots a resolved bucket was learned from, newest first — the drill-down behind an estimated
   * figure (#602).
   *
   * Deliberately **not** part of {@link RealizationRatio}: the lot rows are only wanted by the one
   * surface that expands a figure, while `resolve` runs per line for a whole page of lots (#511)
   * and has no use for them. Empty at `fallback`, which is a policy percentage and has no evidence
   * by definition.
   */
  describeLots(resolved: ResolvedRatio): RatioEvidenceLot[];
  /** The price observations among a resolved bucket's evidence (#1633), newest sale first — the
   * other half of {@link describeLots}, kept apart for the same reason market value keeps its lots
   * and its observations apart: one is a link to a lot, the other a source to read. */
  describeObservations(resolved: ResolvedRatio): RatioEvidenceObservation[];
}

/** One lot behind a bucket's median, in the shape the market-value evidence list already uses. */
export interface RatioEvidenceLot {
  lotId: string;
  /** Ours, per collection (#432). */
  auctionLotNo: number;
  /** The house's own number, when it was typed in. */
  lotNo: string | null;
  lotTitle: string | null;
  saleId: string;
  saleName: string;
  endsAt: Date;
  /** The stamp this ratio was read off, and at what condition — a bucket is other stamps' evidence
   * by construction, so saying which ones is most of what makes it arguable. */
  stampName: string | null;
  conditionAbbreviation: string;
  /** What this observation contributed, unitless. */
  ratio: number;
  /** Carved out of a mixed lot's pro-rata split rather than taken whole (ADR-0022 §3). */
  split: boolean;
}

/** One price observation behind a bucket's median (#1633). */
export interface RatioEvidenceObservation {
  observationId: string;
  soldOn: Date;
  platformName: string;
  auctionHouseName: string | null;
  auctionName: string | null;
  lotNo: string | null;
  url: string | null;
  stampName: string | null;
  conditionAbbreviation: string;
  /** What this observation contributed, unitless. */
  ratio: number;
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
  const [collection, lots, observationRows] = await Promise.all([
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
        // …once every line's condition is settled (#1623): a share of the price cannot be stated as
        // a fraction of a catalogue value the line has not committed to.
        lines: { none: { conditionId: null } },
      },
      select: RATIO_LOT_SELECT,
    }).then(onlySettledLots),
    // Only the ones that name a condition can be exact; the extraction judges the rest.
    prisma.priceObservation.findMany({
      where: { collectionId, conditionId: { not: null } },
      select: RATIO_OBSERVATION_SELECT,
    }),
  ]);
  const fallbackPercent = collection?.bidFallbackPercent ?? 100;

  if (lots.length === 0 && observationRows.length === 0) return emptyResolver(fallbackPercent);

  const homeMarket = await getCollectionHomeMarket(collectionId);
  const [baseCurrency, areas, conditions, anchorsByArea] = await Promise.all([
    getCollectionBaseCurrency(collectionId),
    prisma.collectionArea.findMany({ where: { collectionId }, select: { id: true, name: true } }),
    prisma.stampCondition.findMany({
      where: { collectionId },
      // Conditions are named by their **abbreviation** (`MNH`), which is what every other
      // figure-beside-a-condition surface prints.
      select: { id: true, abbreviation: true },
    }),
    buildAnchoringMarketsMap(collectionId, homeMarket),
  ]);
  const areaNames = new Map(areas.map((a) => [a.id, a.name]));
  const conditionNames = new Map(conditions.map((c) => [c.id, c.abbreviation]));

  // Every line of every closed lot, valued in one pass — the lines the split weighs against are the
  // same ones that become ratios themselves — and every observation beside them.
  const valuations = await valuateItemRows(collectionId, [
    ...lots.flatMap((lot) =>
      lot.lines.map<ValuationRow>((line) => ({
        id: line.id,
        stampId: line.stampId,
        conditionId: line.conditionId,
        certificateStatusId: line.certificateStatusId,
        formatId: line.formatId,
        unknownVariant: isUnknownVariantStamp(line.stamp),
        carrier: null,
        faultReductionPercent: null,
        candidateStampIds: null,
      }))
    ),
    ...observationRows.map<ValuationRow>((row) => ({
      id: row.id,
      stampId: row.stampId,
      // Filtered to a named condition by the query above.
      conditionId: row.conditionId!,
      certificateStatusId: row.certificateStatusId,
      formatId: row.formatId,
      unknownVariant: isUnknownVariantStamp(row.stamp),
      carrier: null,
      faultReductionPercent: null,
      candidateStampIds: null,
    })),
  ]);

  const lineRows = new Map<string, RatioLineRow>();
  for (const lot of lots) for (const line of lot.lines) lineRows.set(line.id, line);

  const input = lots.map<MarketLotInput>((lot) => ({
    lotId: lot.id,
    status: "closed",
    endsAt: lot.endsAt,
    finalPrice: lot.finalPrice?.toString() ?? null,
    fxRateToBase: lot.fxRateToBase?.toString() ?? null,
    inBaseCurrency: lot.auctionSale.currency === baseCurrency,
    market: resultMarket(lot.auctionSale.seller, lot.auctionSale.platform),
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

  const observationById = new Map<string, RatioObservationRow>(observationRows.map((row) => [row.id, row]));

  const observations: RatioObservation[] = [];
  const datapoints = [
    ...extractMarketDatapoints(input),
    ...extractObservationDatapoints(observationRows.map((row) => observationInput(row, baseCurrency))),
  ];
  // The area each datapoint's stamp is valued in, read off the rows already loaded.
  const areaOfStamp = new Map<string, string | null>();
  for (const lot of lots) {
    for (const line of lot.lines) areaOfStamp.set(line.stampId, primaryAreaIdOf(line.stamp.stampAreaLinks));
  }
  for (const row of observationRows) areaOfStamp.set(row.stampId, primaryAreaIdOf(row.stamp.stampAreaLinks));
  const anchoring = anchoringResolver(homeMarket, areaOfStamp, anchorsByArea);

  for (const point of datapoints) {
    if (!anchoring.anchors(point.key.stampId, point.market)) continue;
    // A datapoint whose key has no catalogue value yields a market value but no ratio — there is
    // nothing to state it as a fraction of.
    const valuedId = point.source.kind === "lot" ? point.source.lineId : point.source.observationId;
    const catalogueValue = valuations.get(valuedId)?.baseAmount ?? null;
    if (catalogueValue === null || catalogueValue <= 0) continue;
    const stamp =
      point.source.kind === "lot"
        ? lineRows.get(point.source.lineId)?.stamp
        : observationById.get(point.source.observationId)?.stamp;
    if (!stamp) continue;
    observations.push({
      source: point.source,
      split: point.split,
      ratio: point.amount / catalogueValue,
      areaId: primaryAreaIdOf(stamp.stampAreaLinks),
      conditionId: point.key.conditionId,
      issuedYear: stamp.issuedYear,
    });
  }

  const lotById = new Map(lots.map((lot) => [lot.id, lot]));
  const conditionAbbreviationOf = (id: string) => conditionNames.get(id) ?? "";

  return {
    observationCount: observations.length,
    describeObservations(resolved) {
      return resolved.observations
        .map<RatioEvidenceObservation | null>((observation) => {
          if (observation.source.kind !== "observation") return null;
          const row = observationById.get(observation.source.observationId);
          if (!row) return null;
          return {
            observationId: row.id,
            soldOn: row.soldOn,
            platformName: row.platform.name,
            auctionHouseName: row.auctionHouse?.name ?? null,
            auctionName: row.auctionName,
            lotNo: row.lotNo,
            url: row.url,
            stampName: row.stamp.name,
            conditionAbbreviation: conditionAbbreviationOf(observation.conditionId),
            ratio: observation.ratio,
          };
        })
        .filter((row): row is RatioEvidenceObservation => row !== null)
        .sort((a, b) => b.soldOn.getTime() - a.soldOn.getTime());
    },
    describeLots(resolved) {
      return resolved.observations
        .map<RatioEvidenceLot | null>((observation) => {
          if (observation.source.kind !== "lot") return null;
          const lot = lotById.get(observation.source.lotId);
          const line = lineRows.get(observation.source.lineId);
          if (!lot || !line) return null;
          return {
            lotId: lot.id,
            auctionLotNo: lot.auctionLotNo,
            lotNo: lot.lotNo,
            lotTitle: lot.title,
            saleId: lot.auctionSale.id,
            saleName: lot.auctionSale.name,
            endsAt: lot.endsAt,
            stampName: line.stamp.name,
            conditionAbbreviation: line.condition.abbreviation,
            ratio: observation.ratio,
            split: observation.split,
          };
        })
        .filter((lot): lot is RatioEvidenceLot => lot !== null)
        .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime());
    },
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
    describeLots: () => [],
    describeObservations: () => [],
    resolve(subject) {
      const resolved = resolveRealizationRatio(subject, [], fallbackPercent);
      return { ...resolved, bucketLabel: ratioBucketLabel(resolved, { areaName: null, conditionName: null }) };
    },
  };
}
