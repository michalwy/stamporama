import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import {
  marketKeyOf,
  realizationRatio,
  valuateMarketWithHints,
  type MarketConfidenceBadge,
  type MarketDatapoint,
  type MarketLotInput,
  type MarketValueKey,
} from "./market-value";
import { countByMarket, resultMarket, type MarketCode, type MarketCount } from "./market-anchoring";
import { loadAnchoring } from "./market-anchorings";
import { valuateItemRows, type ValuationRow } from "./item-valuation";
import { getCollectionBaseCurrency } from "./pricing";
import { isUnknownVariantStamp, VARIANT_FLAG_SELECT } from "./variant-classification";
import { onlySettledLots, type SettledConditionLot } from "./auction-line-condition";
import { observationInput, readObservationRows, type ObservationRow } from "./price-observations";
import type { PriceBasis } from "./price-observation";

// **What a stamp fetches, read out of the lots already recorded** (#456; ADR-0022 §7) — and out of
// the exact price observations recorded from other people's auctions (#1633; ADR-0063), which are
// datapoints of the same standing.
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
  /** Where it was sold (#1634): the sale's seller's market, else its platform's; null when neither
   * names one, which counts as the home market. */
  market: MarketCode | null;
}

/** One price observation behind a figure (#1633) — a realised price from someone else's auction. */
export interface MarketValueObservation {
  observationId: string;
  /** The day of the sale, which is the date the datapoint carries. */
  soldOn: Date;
  platformName: string;
  auctionHouseName: string | null;
  auctionName: string | null;
  lotNo: string | null;
  url: string | null;
  /** As observed, in its own currency. */
  price: string;
  currency: string;
  priceBasis: PriceBasis;
  /** What it counted as: the hammer, in the base currency at the rate of its day. */
  amount: string;
  /** Its house's market, else its platform's (#1634); null when neither names one. */
  market: MarketCode | null;
}

/** What the market paid for one `stamp × condition × certificate × format`, with its evidence. */
export interface StampMarketValue extends MarketValueKey {
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  /** Where the collector put these axes in their own lists — carried so the Valuation dialog can
   * lay market value out on the same conditions × certificates grid the catalogue tables use, with
   * the columns lining up across all of them. `-1` for a null certificate and a null format: both
   * are the unmarked default and both lead, which is the order every other read here sorts by. */
  conditionSortOrder: number;
  certificateSortOrder: number;
  formatSortOrder: number;
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
  /** The price observations among the results (#1633), newest first. `n` counts both lists. */
  observations: MarketValueObservation[];
  /** What the figure stands on (#1634; ADR-0064 §5): its results counted by market. */
  markets: MarketCount[];
  /** The results at this key from markets that do not anchor the stamp — left out of every figure
   * above and counted here by market, so the figure can say what it did not use. */
  hintMarkets: MarketCount[];
}

/** One result left out of a stamp's market value because its market does not anchor the stamp's area
 * (#1634). Listed beside the figures, never in them. */
export type MarketValueHint = KeyLabel &
  MarketValueKey &
  (
    | { kind: "lot"; lot: MarketValueLot }
    | { kind: "observation"; observation: MarketValueObservation }
  );

/** A stamp's market value with what it was judged by and what it left out. */
export interface StampMarketEvidence {
  /** The markets this stamp's results have to come from to count — its area's, inherited. */
  anchoringMarkets: MarketCode[];
  /** The collection's home market: what a result with no market of its own counts as. */
  homeMarket: MarketCode;
  /** Every amount here and in the hints is in this currency. */
  baseCurrency: string;
  values: StampMarketValue[];
  /** Every result from another market, newest first, whatever its key. */
  hints: MarketValueHint[];
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

type MarketLotPayload = Prisma.AuctionLotGetPayload<{ select: typeof MARKET_LOT_SELECT }>;
/** A lot whose every line has its condition settled — the only kind that is evidence (#1623). */
type MarketLotRow = SettledConditionLot<MarketLotPayload>;
type MarketLineRow = MarketLotRow["lines"][number];

/** What a key is called and where it sorts, read off any line or observation carrying it — every
 * row with the same key resolves identically. */
export interface KeyLabel {
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusName: string | null;
  certificateStatusAbbreviation: string | null;
  formatName: string | null;
  formatAbbreviation: string | null;
  // A null certificate is "none" and a null format is the single: both are the unmarked default,
  // so both sort ahead of anything configured.
  conditionSortOrder: number;
  certificateSortOrder: number;
  formatSortOrder: number;
}

function labelOf(row: {
  condition: { name: string; abbreviation: string; sortOrder: number };
  certificateStatus: { name: string; abbreviation: string; sortOrder: number } | null;
  format: { name: string; abbreviation: string; sortOrder: number } | null;
}): KeyLabel {
  return {
    conditionName: row.condition.name,
    conditionAbbreviation: row.condition.abbreviation,
    certificateStatusName: row.certificateStatus?.name ?? null,
    certificateStatusAbbreviation: row.certificateStatus?.abbreviation ?? null,
    formatName: row.format?.name ?? null,
    formatAbbreviation: row.format?.abbreviation ?? null,
    conditionSortOrder: row.condition.sortOrder,
    certificateSortOrder: row.certificateStatus?.sortOrder ?? -1,
    formatSortOrder: row.format?.sortOrder ?? -1,
  };
}

/** How a key sorts on screen: the collector's own condition order first, then certificate, then
 * format — the same axes the catalogue-price grid is laid out on, in the same order. */
function sortRank(label: KeyLabel): [number, number, number] {
  return [label.conditionSortOrder, label.certificateSortOrder, label.formatSortOrder];
}

/** An observation that names a condition — the only kind that can carry a key at all. */
type KeyedObservationRow = ObservationRow & {
  conditionId: string;
  condition: NonNullable<ObservationRow["condition"]>;
};

function hasCondition(row: ObservationRow): row is KeyedObservationRow {
  return row.conditionId !== null && row.condition !== null;
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
  const evidence = await readStampMarketEvidence(collectionId, stampIds);
  return new Map([...evidence].map(([stampId, e]) => [stampId, e.values]));
}

/**
 * {@link readStampMarketValues} with what each stamp was judged by and what it left out (#1634): its
 * anchoring markets, and the results from every other market as hints. One read, so the figure and
 * the hints listed beside it are always over the same results.
 *
 * A stamp is present when it has any result at all, counted or not.
 */
export async function readStampMarketEvidence(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, StampMarketEvidence>> {
  const wanted = new Set(stampIds);
  if (wanted.size === 0) return new Map();

  const [lots, observationRows] = await Promise.all([
    prisma.auctionLot
      .findMany({
        where: {
          // The filter is the lifecycle plus a price, and nothing else (ADR-0022 §2): the derived
          // outcome is not consulted, so a lot that was won, lost or merely observed all count —
          // once every line's condition is settled (#1623), since a price cannot be attributed to a
          // key a line has not committed to.
          status: "closed",
          finalPrice: { not: null },
          auctionSale: { collectionId },
          AND: [
            { lines: { some: { stampId: { in: [...wanted] } } } },
            { lines: { none: { conditionId: null } } },
          ],
        },
        select: MARKET_LOT_SELECT,
      })
      .then(onlySettledLots),
    // Every observation of these stamps (#1633): the extraction is what drops the uncertain and the
    // unconvertible ones, so they are not filtered here a second time.
    readObservationRows(collectionId, [...wanted]),
  ]);
  if (lots.length === 0 && observationRows.length === 0) return new Map();

  const [baseCurrency, anchoring] = await Promise.all([
    getCollectionBaseCurrency(collectionId),
    loadAnchoring(collectionId, [...wanted]),
  ]);
  const observations = observationRows.filter(hasCondition);
  // Every line of every one of those lots, valued in one pass — the lines pointing elsewhere are
  // what the pro-rata split weighs this stamp's share against — and every observation with a key,
  // whose catalogue value is what its ratio is read against.
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
      }))
    ),
    ...observations.map<ValuationRow>((row) => ({
      id: row.id,
      stampId: row.stampId,
      conditionId: row.conditionId,
      certificateStatusId: row.certificateStatusId,
      formatId: row.formatId,
      unknownVariant: isUnknownVariantStamp(row.stamp),
      carrier: null,
      faultReductionPercent: null,
    })),
  ]);

  // What a key is *called*, what it is worth in the catalogue, and where it sorts — all read off
  // any line or observation carrying it, since every row with the same key resolves identically.
  const labels = new Map<string, KeyLabel>();
  const catalogueValues = new Map<string, number | null>();
  const lotRows = new Map<string, MarketLotRow>();
  const lineRows = new Map<string, MarketLineRow>();
  const observationById = new Map<string, KeyedObservationRow>();
  for (const lot of lots) {
    lotRows.set(lot.id, lot);
    for (const line of lot.lines) {
      lineRows.set(line.id, line);
      const id = marketKeyOf(line);
      if (!labels.has(id)) {
        labels.set(id, labelOf(line));
        catalogueValues.set(id, valuations.get(line.id)?.baseAmount ?? null);
      }
    }
  }
  for (const row of observations) {
    observationById.set(row.id, row);
    const id = marketKeyOf(row);
    if (!labels.has(id)) {
      labels.set(id, labelOf(row));
      catalogueValues.set(id, valuations.get(row.id)?.baseAmount ?? null);
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
  const observationInputs = observationRows.map((row) => observationInput(row, baseCurrency));

  const observationEvidenceOf = (
    point: MarketDatapoint & { source: { kind: "observation" } }
  ): MarketValueObservation => {
    const row = observationById.get(point.source.observationId)!;
    return {
      observationId: row.id,
      soldOn: row.soldOn,
      platformName: row.platform.name,
      auctionHouseName: row.auctionHouse?.name ?? null,
      auctionName: row.auctionName,
      lotNo: row.lotNo,
      url: row.url,
      price: row.price.toFixed(2),
      currency: row.currency,
      priceBasis: row.priceBasis === "all_in" ? "all_in" : "hammer",
      amount: point.amount.toFixed(2),
      market: point.market,
    };
  };
  const lotEvidenceOf = (point: MarketDatapoint & { source: { kind: "lot" } }): MarketValueLot => {
    const lot = lotRows.get(point.source.lotId)!;
    const evidence = lineRows.get(point.source.lineId)!;
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
      market: point.market,
    };
  };

  const now = new Date();
  const { valuations: marketValuations, hints } = valuateMarketWithHints(
    input,
    now,
    observationInputs,
    anchoring
  );

  // The hints first, since a figure states how many it left out at its own key. Lots reach here
  // because they mention a wanted stamp; their other lines were carried along for the split alone.
  const hintsByStamp = new Map<string, MarketValueHint[]>();
  const hintMarketsByKey = new Map<string, (MarketCode | null)[]>();
  for (const point of hints) {
    if (!wanted.has(point.key.stampId)) continue;
    const id = marketKeyOf(point.key);
    const hint: MarketValueHint =
      point.source.kind === "observation"
        ? {
            ...point.key,
            ...labels.get(id)!,
            kind: "observation",
            observation: observationEvidenceOf({ ...point, source: point.source }),
          }
        : {
            ...point.key,
            ...labels.get(id)!,
            kind: "lot",
            lot: lotEvidenceOf({ ...point, source: point.source }),
          };
    const list = hintsByStamp.get(point.key.stampId);
    if (list) list.push(hint);
    else hintsByStamp.set(point.key.stampId, [hint]);
    const markets = hintMarketsByKey.get(id);
    if (markets) markets.push(point.market);
    else hintMarketsByKey.set(id, [point.market]);
  }

  const byStamp = new Map<string, StampMarketValue[]>();
  for (const value of marketValuations) {
    if (!wanted.has(value.key.stampId)) continue;

    const id = marketKeyOf(value.key);
    const label = labels.get(id)!;
    const catalogueValue = catalogueValues.get(id) ?? null;

    const lotEvidence: MarketValueLot[] = [];
    const observationEvidence: MarketValueObservation[] = [];
    for (const point of value.datapoints) {
      if (point.source.kind === "observation") {
        observationEvidence.push(observationEvidenceOf({ ...point, source: point.source }));
      } else {
        lotEvidence.push(lotEvidenceOf({ ...point, source: point.source }));
      }
    }

    const entry: StampMarketValue = {
      ...value.key,
      ...label,
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
      lots: lotEvidence.sort((a, b) => b.endsAt.getTime() - a.endsAt.getTime()),
      observations: observationEvidence.sort((a, b) => b.soldOn.getTime() - a.soldOn.getTime()),
      markets: value.markets,
      hintMarkets: countByMarket(hintMarketsByKey.get(id) ?? []),
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

  const result = new Map<string, StampMarketEvidence>();
  for (const stampId of new Set([...byStamp.keys(), ...hintsByStamp.keys()])) {
    result.set(stampId, {
      anchoringMarkets: [...anchoring.anchorsOf(stampId)],
      homeMarket: anchoring.homeMarket,
      baseCurrency,
      values: byStamp.get(stampId) ?? [],
      hints: (hintsByStamp.get(stampId) ?? []).sort(
        (a, b) => hintTime(b).getTime() - hintTime(a).getTime()
      ),
    });
  }
  return result;
}

function hintTime(hint: MarketValueHint): Date {
  return hint.kind === "lot" ? hint.lot.endsAt : hint.observation.soldOn;
}

/**
 * The medians alone, keyed by {@link marketKeyOf} — what a **total** over a copy set is built from
 * (#458), where each held copy is valued at the median for its own key.
 *
 * A thin projection of {@link readStampMarketValues} rather than a query of its own, deliberately:
 * the figure a collection total is summed from and the figure the stamp's own Valuation tab prints
 * have to be the same number, and two reads of one thing is how they stop being.
 *
 * Ownership is the caller's to assert, exactly as {@link readStampMarketValues} has it. A key with
 * no datapoints is simply absent — the caller counts that as coverage it did not have, never as a
 * zero (ADR-0022 §6).
 */
export async function readMarketMedians(
  collectionId: string,
  stampIds: string[]
): Promise<Map<string, number>> {
  const byStamp = await readStampMarketValues(collectionId, stampIds);
  const medians = new Map<string, number>();
  for (const values of byStamp.values()) {
    for (const value of values) {
      medians.set(marketKeyOf(value), Number(value.median));
    }
  }
  return medians;
}

/**
 * One stamp's market evidence for a caller that holds only the stamp — what the Valuation dialog reads
 * (#1634): the figures, what they were judged by, and the results from other markets left out of them.
 * Owner-checked through the stamp's collection, exactly as {@link getStampMarketValueByStamp} is.
 */
export async function getStampMarketEvidenceByStamp(
  ownerId: string,
  stampId: string
): Promise<StampMarketEvidence> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { collectionId: true },
  });
  if (!stamp) throw new Error("Stamp not found");
  await assertCollectionOwner(ownerId, stamp.collectionId);
  const evidence = (await readStampMarketEvidence(stamp.collectionId, [stampId])).get(stampId);
  if (evidence) return evidence;
  // No result at all: still say what would have counted, so the empty state can name it.
  const [anchoring, baseCurrency] = await Promise.all([
    loadAnchoring(stamp.collectionId, [stampId]),
    getCollectionBaseCurrency(stamp.collectionId),
  ]);
  return {
    anchoringMarkets: [...anchoring.anchorsOf(stampId)],
    homeMarket: anchoring.homeMarket,
    baseCurrency,
    values: [],
    hints: [],
  };
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

/**
 * {@link getStampMarketValue} for a caller that holds only the stamp (#457).
 *
 * The Valuation dialog opens off a row's `⋮` menu and is handed a stamp id and nothing else — the
 * same shape `getStampPriceDetails` is called in. The collection is resolved from the stamp and
 * then owner-checked, so the authorization is identical; what differs is only which of the two the
 * caller happened to have.
 */
export async function getStampMarketValueByStamp(
  ownerId: string,
  stampId: string
): Promise<StampMarketValue[]> {
  const stamp = await prisma.stamp.findUnique({
    where: { id: stampId },
    select: { collectionId: true },
  });
  if (!stamp) throw new Error("Stamp not found");
  return getStampMarketValue(ownerId, stamp.collectionId, stampId);
}

// ── One checklist's market value (#457) ─────────────────────────────────────

/** What the market paid for a whole set, at one `condition × certificate × format` key. */
export interface ChecklistMarketCell extends Omit<MarketValueKey, "stampId"> {
  conditionName: string;
  conditionAbbreviation: string;
  certificateStatusAbbreviation: string | null;
  formatAbbreviation: string | null;
  /** As on {@link StampMarketValue} — the dialog's grid is laid out on these. */
  conditionSortOrder: number;
  certificateSortOrder: number;
  formatSortOrder: number;
  /** Σ of the contributing stamps' medians, in the base currency. */
  totalBaseAmount: string;
  /** How many of the checklist's required stamps have evidence at this key. Never implied: a total
   * over 3 of 40 stamps is not the set's worth, and only this number says which it is. */
  stampCount: number;
  /** Results behind the whole figure, and the span they were struck over. */
  n: number;
  latestAt: Date;
  earliestAt: Date;
}

/**
 * The set's own market value, beside its catalogue totals (#457).
 *
 * Built out of the **same** per-stamp figures the stamp half of the dialog prints — one read over
 * every required stamp, then the medians summed per key. A set's worth is the sum of its members'
 * worth, so nothing new is computed here and nothing can disagree with a member opened on its own.
 *
 * There is deliberately **no** confidence badge on a set. The score answers "how good is the
 * evidence behind this one figure" (ADR-0022 §5), and averaging forty of them would produce a badge
 * that describes nothing in particular. What a set needs instead is **coverage**, which is
 * `stampCount` against `requiredCount`: a total standing on three stamps out of forty is the thing
 * a reader has to know, and no single badge can say it.
 */
export interface ChecklistMarketValue {
  baseCurrency: string;
  checklistName: string;
  requiredCount: number;
  /** Only keys some required stamp has evidence at; the collector's own axis order. */
  cells: ChecklistMarketCell[];
}

export async function getChecklistMarketValue(
  ownerId: string,
  collectionId: string,
  checklistId: string
): Promise<ChecklistMarketValue> {
  await assertCollectionOwner(ownerId, collectionId);
  const checklist = await prisma.checklist.findFirst({
    where: { id: checklistId, collectionId },
    select: { name: true },
  });
  if (!checklist) throw new Error("Checklist not found.");

  const members = await prisma.checklistStamp.findMany({
    where: { checklistId },
    select: { stampId: true },
  });
  const baseCurrency = await getCollectionBaseCurrency(collectionId);
  const byStamp = await readStampMarketValues(
    collectionId,
    members.map((m) => m.stampId)
  );

  // Accumulated per key across the members. A stamp contributes at most once to a key — it has one
  // median there — so this is a sum of member worths and never a sum of results.
  const cells = new Map<string, ChecklistMarketCell>();
  for (const values of byStamp.values()) {
    for (const value of values) {
      const id = `${value.conditionId}~${value.certificateStatusId ?? ""}~${value.formatId ?? ""}`;
      const cell = cells.get(id);
      if (!cell) {
        cells.set(id, {
          conditionId: value.conditionId,
          certificateStatusId: value.certificateStatusId,
          formatId: value.formatId,
          conditionName: value.conditionName,
          conditionAbbreviation: value.conditionAbbreviation,
          certificateStatusAbbreviation: value.certificateStatusAbbreviation,
          formatAbbreviation: value.formatAbbreviation,
          conditionSortOrder: value.conditionSortOrder,
          certificateSortOrder: value.certificateSortOrder,
          formatSortOrder: value.formatSortOrder,
          totalBaseAmount: value.median,
          stampCount: 1,
          n: value.n,
          latestAt: value.latestAt,
          earliestAt: value.earliestAt,
        });
        continue;
      }
      cell.totalBaseAmount = (Number(cell.totalBaseAmount) + Number(value.median)).toFixed(2);
      cell.stampCount += 1;
      cell.n += value.n;
      if (value.latestAt > cell.latestAt) cell.latestAt = value.latestAt;
      if (value.earliestAt < cell.earliestAt) cell.earliestAt = value.earliestAt;
    }
  }

  return {
    baseCurrency,
    checklistName: checklist.name,
    requiredCount: members.length,
    // The collector's own axis order, the one the catalogue tables are already laid out in.
    cells: [...cells.values()].sort(
      (a, b) =>
        a.conditionSortOrder - b.conditionSortOrder ||
        a.certificateSortOrder - b.certificateSortOrder ||
        a.formatSortOrder - b.formatSortOrder
    ),
  };
}
