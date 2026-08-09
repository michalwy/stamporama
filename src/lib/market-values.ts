import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  marketKeyOf,
  realizationRatio,
  valuateMarket,
  type MarketConfidenceBadge,
  type MarketLotInput,
  type MarketValueKey,
} from "./market-value";
import { valuateItemRows, type ValuationRow } from "./items";
import { getCollectionBaseCurrency } from "./pricing";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";

// **What a stamp fetches, read out of the lots already recorded** (#456; ADR-0022 §7).
//
// Computed on demand, nothing stored: no `stamp_valuation` table, no queued recompute (ADR-0018),
// no invalidation edges. Editing a lot's final price changes the next screen that asks. The data is
// small — hundreds of closed lots, not millions — and a materialized table is a straightforward
// later optimization if a screen is ever measurably slow, not something worth a cache-staleness
// class of bug before then.
//
// The arithmetic is **not here**: extraction, the split, the aggregation and the confidence score
// all live in the pure `market-value.ts`. What this module does is the three things that need a
// database — find the lots, resolve the catalogue values the split and the ratio are built on, and
// name the condition, certificate and format a key is made of.
//
// **Catalogue values are reused, never re-derived.** They come from `valuateItemRows` (`items.ts`),
// which is what values a copy: the area's primary catalogue at its latest edition, format factors
// per ADR-0020, the unknown-variant rollup per #238, all in the collection's base currency. An
// auction line is that shape already — `auction-lines.ts` values a lot's composition the same way —
// so re-resolving them here would be a second copy of ADR-0006, ADR-0020 and #238 to keep in step.
//
// **A mixed lot's other lines matter.** Splitting a hammer price pro-rata needs every line of the
// lot, including the ones pointing at stamps nobody asked about, so the query is "the lots that
// mention these stamps" and then "all of those lots' lines" — never "these stamps' lines".
//
// Everything is collection-scoped server-side: the lot filter reaches its collection through its
// sale, exactly as every other auction read does.

/** One evidence lot behind a figure — what the UI expands a row into (#457). */
export interface MarketValueLot {
  lotId: string;
  /** Ours, per collection (#432) — what the quick-jump box takes. */
  auctionLotNo: number;
  /** The house's own number for the lot, when it was typed in. */
  lotNo: string | null;
  lotTitle: string | null;
  saleId: string;
  saleName: string;
  /** The lot's closing time, which is the date the datapoint carries. */
  endsAt: Date;
  /** What the whole lot fetched, in the **base** currency: the hammer price at the rate frozen at
   * the close (#354), excluding premium and shipping. */
  finalPrice: string;
  /** The lot's own transaction currency, so a converted figure can say where it came from. */
  saleCurrency: string;
  /** How many of this key the line held. */
  quantity: number;
  /** The per-unit figure this lot contributed — what the median is actually over. */
  amount: string;
  /** The figure was carved out of a mixed lot pro-rata rather than taken whole (ADR-0022 §3). */
  split: boolean;
}

/** What the market paid for one `stamp × condition × certificate × format`, with its evidence. */
export interface StampMarketValue extends MarketValueKey {
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  /** Every figure below is in this currency. */
  baseCurrency: string;
  /** The headline (ADR-0022 §4). */
  median: string;
  mean: string;
  min: string;
  max: string;
  n: number;
  splitCount: number;
  latestAt: Date;
  earliestAt: Date;
  confidence: { score: number; badge: MarketConfidenceBadge };
  /** The catalogue price for the **same** key, base currency, by the same headline selection the
   * lists use. Null when the key carries none — which is possible even with evidence, since a
   * single-line lot needs no catalogue price to yield a datapoint. */
  catalogueValue: string | null;
  /** `median ÷ catalogueValue` as a ratio (ADR-0022 §6); null when either side is missing. The
   * surface that prints it decides whether that is "24%" or "0.24". */
  realizationRatio: number | null;
  /** Newest result first — the order a collector reads evidence in. */
  lots: MarketValueLot[];
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const collection = await prisma.collection.findFirst({
    where: { id: collectionId, ownerId },
    select: { id: true },
  });
  if (!collection) throw new Error("Collection not found");
}

const MARKET_LOT_SELECT = {
  id: true,
  auctionLotNo: true,
  lotNo: true,
  title: true,
  endsAt: true,
  finalPrice: true,
  fxRateToBase: true,
  auctionSale: { select: { id: true, name: true, currency: true } },
  lines: {
    // Stable reading order, the same one the composition editor uses: a lot's lines are a list the
    // collector built, and the order they built it in is the only one that means anything.
    orderBy: { id: "asc" },
    select: {
      id: true,
      stampId: true,
      conditionId: true,
      certificateStatusId: true,
      formatId: true,
      quantity: true,
      condition: { select: { name: true, abbreviation: true, sortOrder: true } },
      certificateStatus: { select: { name: true, abbreviation: true, sortOrder: true } },
      format: { select: { name: true, abbreviation: true, sortOrder: true } },
      stamp: { select: { ...VARIANT_FLAG_SELECT, variants: { select: VARIANT_FLAG_SELECT } } },
    },
  },
} satisfies Prisma.AuctionLotSelect;

type MarketLotRow = Prisma.AuctionLotGetPayload<{ select: typeof MARKET_LOT_SELECT }>;
type MarketLineRow = MarketLotRow["lines"][number];

/** How a key sorts on screen: the collector's own condition order first, then certificate, then
 * format — the same axes the catalogue-price grid is laid out on, in the same order. */
function sortRank(line: MarketLineRow): [number, number, number] {
  // A null certificate is "none" and a null format is the single: both are the unmarked default,
  // so both sort ahead of anything configured.
  return [line.condition.sortOrder, line.certificateStatus?.sortOrder ?? -1, line.format?.sortOrder ?? -1];
}

/**
 * Market values for a set of stamps, one entry per key that has evidence.
 *
 * Stamps with no evidence are simply absent from the map — a key with no datapoints shows **no**
 * market value, and nothing is synthesized from comparable keys' ratios (ADR-0022 §6).
 */
export async function getStampMarketValues(
  ownerId: string,
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, StampMarketValue[]>> {
  await assertCollectionOwner(ownerId, collectionId);
  return readStampMarketValues(collectionId, stampIds);
}

/**
 * {@link getStampMarketValues} without the ownership check, for server reads that have **already**
 * resolved the collection for the owner — the auction lot anchors (#510) are one. Split out rather
 * than threading an `ownerId` through modules that have no other use for one; the caller owns the
 * check, exactly as `readCollectionAreas` is split from `getCollectionAreas`.
 */
export async function readStampMarketValues(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, StampMarketValue[]>> {
  const wanted = new Set(stampIds);
  if (wanted.size === 0) return new Map();

  const lots = await prisma.auctionLot.findMany({
    where: {
      // The filter is the lifecycle plus a price, and nothing else (ADR-0022 §2): the derived
      // outcome is not consulted, so a lot that was won, lost or merely observed all count.
      status: "closed",
      finalPrice: { not: null },
      auctionSale: { collectionId },
      lines: { some: { stampId: { in: [...wanted] } } },
    },
    select: MARKET_LOT_SELECT,
  });
  if (lots.length === 0) return new Map();

  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  // Every line of every one of those lots, valued in one pass — the lines pointing elsewhere are
  // what the pro-rata split weighs this stamp's share against.
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

  // What a key is *called*, what it is worth in the catalogue, and where it sorts — all read off
  // any line carrying it, since every line with the same key resolves identically.
  const labels = new Map<string, MarketLineRow>();
  const catalogueValues = new Map<string, number | null>();
  const lotRows = new Map<string, MarketLotRow>();
  const lineRows = new Map<string, MarketLineRow>();
  for (const lot of lots) {
    lotRows.set(lot.id, lot);
    for (const line of lot.lines) {
      lineRows.set(line.id, line);
      const id = marketKeyOf(line);
      if (!labels.has(id)) {
        labels.set(id, line);
        catalogueValues.set(id, valuations.get(line.id)?.baseAmount ?? null);
      }
    }
  }

  const input = lots.map<MarketLotInput>((lot) => ({
    lotId: lot.id,
    status: "closed",
    endsAt: lot.endsAt,
    finalPrice: lot.finalPrice?.toString() ?? null,
    fxRateToBase: lot.fxRateToBase?.toString() ?? null,
    // `fxRateToBase` is null both when no conversion was needed and when none could be had; only
    // the sale's currency tells the two apart.
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

  const now = new Date();
  const byStamp = new Map<string, StampMarketValue[]>();
  for (const value of valuateMarket(input, now)) {
    // Lots reach here because they mention a wanted stamp; their other lines were carried along for
    // the split alone and are not what was asked about.
    if (!wanted.has(value.key.stampId)) continue;

    const id = marketKeyOf(value.key);
    const line = labels.get(id)!;
    const catalogueValue = catalogueValues.get(id) ?? null;

    const entry: StampMarketValue = {
      ...value.key,
      conditionName: line.condition.name,
      conditionAbbreviation: line.condition.abbreviation,
      certificateStatusName: line.certificateStatus?.name ?? null,
      certificateStatusAbbreviation: line.certificateStatus?.abbreviation ?? null,
      formatName: line.format?.name ?? null,
      formatAbbreviation: line.format?.abbreviation ?? null,
      baseCurrency,
      median: value.median.toFixed(2),
      mean: value.mean.toFixed(2),
      min: value.min.toFixed(2),
      max: value.max.toFixed(2),
      n: value.n,
      splitCount: value.splitCount,
      latestAt: value.latestAt,
      earliestAt: value.earliestAt,
      confidence: { score: value.confidence.score, badge: value.confidence.badge },
      catalogueValue: catalogueValue === null ? null : catalogueValue.toFixed(2),
      realizationRatio: realizationRatio(value.median, catalogueValue),
      lots: value.datapoints
        .map((point) => {
          const lot = lotRows.get(point.lotId)!;
          const evidence = lineRows.get(point.lineId)!;
          const finalPrice = Number(lot.finalPrice);
          const rate = lot.fxRateToBase === null ? 1 : Number(lot.fxRateToBase);
          return {
            lotId: lot.id,
            auctionLotNo: lot.auctionLotNo,
            lotNo: lot.lotNo,
            lotTitle: lot.title,
            saleId: lot.auctionSale.id,
            saleName: lot.auctionSale.name,
            endsAt: lot.endsAt,
            finalPrice: (finalPrice * rate).toFixed(2),
            saleCurrency: lot.auctionSale.currency,
            quantity: evidence.quantity,
            amount: point.amount.toFixed(2),
            split: point.split,
          };
        })
        .sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime()),
    };

    const list = byStamp.get(value.key.stampId);
    if (list) list.push(entry);
    else byStamp.set(value.key.stampId, [entry]);
  }

  for (const list of byStamp.values()) {
    list.sort((a, b) => {
      const x = sortRank(labels.get(marketKeyOf(a))!);
      const y = sortRank(labels.get(marketKeyOf(b))!);
      return x[0] - y[0] || x[1] - y[1] || x[2] - y[2];
    });
  }
  return byStamp;
}

/** {@link getStampMarketValues} for one stamp. Empty when it has no evidence. */
export async function getStampMarketValue(
  ownerId: string,
  collectionId: string,
  stampId: string
): Promise<StampMarketValue[]> {
  const byStamp = await getStampMarketValues(ownerId, collectionId, [stampId]);
  return byStamp.get(stampId) ?? [];
}
