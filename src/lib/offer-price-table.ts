// **The offer's price area as a small table** (#1829). Pure — no Prisma import — so the rules below
// are unit-tested on their own, exactly as `realization-ratio.ts` beside it.
//
// The header used to weigh the price against two figures on one line (#1295): the platform's floor
// and the catalogue value. Catalogues run several times above what stamps fetch (#1828), so the
// catalogue figure was a poor *suggestion*, and the collector wanted the figures that matter side by
// side instead: the minimum, the catalogue value, **Estimated value** (catalogue × the learned
// realisation ratio, #602), what the market paid, and what the copies cost — each price with the
// margin it would give over that cost.
//
// **Every figure is per set**, because a buyer takes one set and a set is what the price is asked
// for: an average over the sets that carry the figure, never over every set, for #378's reason — an
// unpriced set is a gap in the data, not a set worth nothing.
//
// **Estimated value is the suggestion** (decided with the collector, 2026-10-12). It is catalogue ×
// ratio over every held copy with a catalogue value — including a copy whose key has a measured
// market median, unlike the Valuation dialog's grid (#602), which leaves such a cell empty because
// it is printed beside the measurement. Here the market figure is a row of its own, and an estimate
// that skipped the measured copies would price the set as though they were worth nothing. A piece
// valued by its method (#2359) is left out: the ratio is learned from stamps, not covers.
//
// **The table reads without its tooltips** (#1839): three headed columns — the row's name, *Price*,
// *Profit over cost* — a short note in brackets after a name saying what the figure is and nothing
// more, a Market row that is always there (empty, with its reason, when nothing was recorded), and
// the offer's own price as the last row. What a figure rests on beyond that note — the ratio's
// bucket and sample, the sets a figure leaves out — is the tooltip's.
//
// **#1843 shrank the notes further**: only Estimated (its share of the catalogue) and Cost (*estimate*,
// while it is one) keep one. The catalogue a value was read in and Market's *no recorded results*
// moved to their rows' tooltips. Minimum joined the rows that are always drawn — `—` on a platform
// that sets none — and Cost became a price that can be clicked like the others. #2333 drew Cost always,
// `—` with why when it is missing, and marked it *incl. opening value* when an opening value is under it.
//
// **#2461 added Market trend under Market**: the same copies' results, each brought to today by its
// stamp's price trend (#2460's rule, `market-trend.ts`) — so a stamp whose price keeps rising is not
// priced against a median years behind its market. Market itself stays the plain median. The row is
// drawn only when a trend applies to at least one copy; it is not a suggestion — Estimated is.

import { offerCostTotals, type OfferSetCost } from "./offer-cost";
import { formatTrendRate, type TrendStatementInput } from "./price-trend";
import { isStatedRatio, type RatioBucketLevel } from "./realization-ratio";

/** One held copy's estimate: its catalogue value and the ratio its bucket resolved to. */
export interface CopyEstimateInput {
  /** The copy's catalogue value in the base currency, already lowered for its faults (#1560). */
  catalogueBase: number;
  /** Unitless: the catalogue value is multiplied by this. */
  ratio: number;
  level: RatioBucketLevel;
  /** The bucket as it is named elsewhere — `Polska Ludowa, MNH, 1945–1949`. */
  bucketLabel: string;
  /** Observations behind the bucket's median; zero at the two stated rungs. */
  n: number;
  /** The book the catalogue value was read in — `Michel / Online` — named on the Catalogue row
   *  (#1839). Null where the collection has no such book on record. */
  catalogueName: string | null;
}

/**
 * What an estimate's ratio rests on — the bucket and its `n`, or the manual factor (#1828).
 *
 * Named only when every copy resolved the **same** bucket; copies across areas or conditions
 * resolve several, and then only how many is said, the rule the Valuation dialog's set rows follow
 * (#602) — naming one of several would be naming the wrong one for the rest.
 */
export interface EstimateSource {
  /** Null when the copies resolved different buckets. */
  level: RatioBucketLevel | null;
  bucketLabel: string | null;
  bucketCount: number;
  /** The one ratio, or null when there were several. */
  ratio: number | null;
  /** The one bucket's `n`; zero when there were several, or at a stated rung. */
  n: number;
}

/**
 * The source as one line — `Polska Ludowa, MNH · 34% · n = 6`. The two stated rungs say they are
 * not evidence, the Valuation dialog's own words (#602, #1828), since an estimate resting on a
 * figure the collector typed must never read as one learned from results.
 */
export function describeEstimateSource(source: EstimateSource): string {
  if (source.level === null || source.bucketLabel === null) {
    return `${source.bucketCount} ratio buckets`;
  }
  const parts = [source.bucketLabel];
  if (source.ratio !== null) parts.push(`${Math.round(source.ratio * 100)}%`);
  if (source.n > 0) parts.push(`n = ${source.n}`);
  if (source.level === "fallback") parts.push("policy, not evidence");
  else if (source.level === "catalogue-factor") parts.push("your estimate, not evidence");
  return parts.join(" · ");
}

/**
 * What the estimate rests on, for the Estimated row's tooltip (#1839) — the bucket and how many
 * results, `Second Republic, 26 results`; the manual factor, which its own label names; or how many
 * buckets, when the copies resolved several. The row itself says only the ratio.
 */
export function describeEstimateBasis(source: EstimateSource): string {
  if (source.level === null || source.bucketLabel === null) {
    return `${source.bucketCount} ratio buckets`;
  }
  if (source.level === "catalogue-factor") return `${source.bucketLabel} — your estimate, not evidence`;
  if (source.level === "fallback") return `${source.bucketLabel} — policy, not evidence`;
  return `${source.bucketLabel}, ${source.n} result${source.n === 1 ? "" : "s"}`;
}

/** True when the source is one of the two stated rungs — drawn in the warning tone. */
export function isStatedSource(source: EstimateSource): boolean {
  return source.level !== null && isStatedRatio(source.level);
}

export interface SetsEstimate {
  /** Average per estimated set, base currency, unrounded. */
  averageBase: number;
  /** Sets carrying at least one estimated copy — the average's divisor. */
  valuedSets: number;
  /** Copies behind the figure. */
  copies: number;
  /** The estimate as a share of the catalogue value it was taken from — unitless, the one ratio
   *  when there is one and the weighted one across several buckets. */
  ratio: number;
  /** The books the copies' catalogue values were read in, by name, sorted (#1839). */
  catalogues: string[];
  source: EstimateSource;
}

const bucketKey = (copy: CopyEstimateInput) => `${copy.level}\u0000${copy.bucketLabel}\u0000${copy.ratio}`;

/**
 * Estimated value per set: each set's copies summed at catalogue × ratio, averaged over the sets
 * that have any. Null when no copy of any set can be estimated.
 */
export function estimateSets(sets: readonly (readonly CopyEstimateInput[])[]): SetsEstimate | null {
  let sum = 0;
  let catalogueSum = 0;
  let valuedSets = 0;
  let copies = 0;
  const buckets = new Map<string, CopyEstimateInput>();
  const catalogues = new Set<string>();
  for (const set of sets) {
    if (set.length === 0) continue;
    for (const copy of set) {
      sum += copy.catalogueBase * copy.ratio;
      catalogueSum += copy.catalogueBase;
      buckets.set(bucketKey(copy), copy);
      if (copy.catalogueName !== null) catalogues.add(copy.catalogueName);
    }
    copies += set.length;
    valuedSets++;
  }
  if (valuedSets === 0) return null;
  const only = buckets.size === 1 ? [...buckets.values()][0] : null;
  return {
    averageBase: sum / valuedSets,
    valuedSets,
    copies,
    ratio: only?.ratio ?? (catalogueSum > 0 ? sum / catalogueSum : 0),
    catalogues: [...catalogues].sort((a, b) => a.localeCompare(b)),
    source: {
      level: only?.level ?? null,
      bucketLabel: only?.bucketLabel ?? null,
      bucketCount: buckets.size,
      ratio: only?.ratio ?? null,
      n: only?.n ?? 0,
    },
  };
}

/** One held copy with recorded results, as the Market trend row reads it (#2461). A copy with none is
 *  absent, as it adds nothing to Market either. */
export interface CopyMarketTrendInput {
  /** What the copy counts as under Market — its plain median, lowered for its faults — base currency. */
  market: number;
  /** The same brought to today by its stamp's trend, lowered for its faults the same way; equal to
   *  {@link market} when no trend applies, and the copy then counts at its plain median. */
  trended: number;
  /** The trend applied; null when there is none. */
  trend: TrendStatementInput | null;
}

export interface SetsMarketTrend {
  /** Average per set with results, base currency, unrounded — the divisor Market uses. */
  averageBase: number;
  valuedSets: number;
  /** Copies with results behind the figure, and how many of them a trend moved. */
  copies: number;
  trendedCopies: number;
  /** The distinct trends applied, steepest first. */
  trends: TrendStatementInput[];
}

const trendKey = (t: TrendStatementInput) =>
  [t.rate, t.capped, t.borrowed?.bucketLabel ?? "", t.n, String(t.earliestAt), String(t.latestAt)].join("\u0000");

/**
 * Market trend per set (#2461): each set's copies summed at their trend-adjusted figures, averaged
 * over the sets with any recorded result — Market's own sets, so the two rows are over the same
 * copies. A copy with results but no trend counts at its plain median. Null when no copy of any set
 * has a trend, which is when the row is not drawn.
 */
export function marketTrendSets(sets: readonly (readonly CopyMarketTrendInput[])[]): SetsMarketTrend | null {
  let sum = 0;
  let valuedSets = 0;
  let copies = 0;
  let trendedCopies = 0;
  const trends = new Map<string, TrendStatementInput>();
  for (const set of sets) {
    if (set.length === 0) continue;
    for (const copy of set) {
      sum += copy.trended;
      if (copy.trend) {
        trendedCopies++;
        trends.set(trendKey(copy.trend), copy.trend);
      }
    }
    copies += set.length;
    valuedSets++;
  }
  if (trendedCopies === 0) return null;
  return {
    averageBase: sum / valuedSets,
    valuedSets,
    copies,
    trendedCopies,
    trends: [...trends.values()].sort((a, b) => b.rate - a.rate),
  };
}

/**
 * The Market trend row's note (#2461): the rate — `+14%/yr`, `borrowed, +9%/yr` when the trend comes
 * from the stamp's group, `capped` where the ±30% cap held it. Copies trending differently give the
 * range, `+5%/yr to +14%/yr`, and the tooltip names each.
 */
export function describeMarketTrendNote(trends: readonly TrendStatementInput[]): string {
  if (trends.length === 0) return "";
  const rates = [...new Set(trends.map((t) => formatTrendRate(t.rate)))];
  if (rates.length > 1) {
    const sorted = [...trends].sort((a, b) => a.rate - b.rate);
    return `${formatTrendRate(sorted[0].rate)} to ${formatTrendRate(sorted[sorted.length - 1].rate)}`;
  }
  const borrowed = trends.every((t) => t.borrowed !== null);
  const capped = trends.some((t) => t.capped);
  return `${borrowed ? "borrowed, " : ""}${rates[0]}${capped ? ", capped" : ""}`;
}

/** What a price would make over what the copies cost: the difference, and that difference as a
 *  share of the cost — null where the cost is zero, which no share can be taken of. */
export interface PriceMargin {
  /** Signed 2-dp string, in the price's currency. */
  amount: string;
  /** Whole percent, signed. */
  percent: number | null;
}

export function priceMargin(price: number, cost: number): PriceMargin {
  const difference = Math.round((price - cost) * 100) / 100;
  return {
    amount: difference.toFixed(2),
    percent: cost > 0 ? Math.round((difference / cost) * 100) : null,
  };
}

/** A margin as the table prints it — one figure with its percentage (#1839): `+12.00 (+40%)`,
 *  `−3.50 (−10%)`. */
export function formatPriceMargin(margin: PriceMargin): string {
  const signed = (value: string) => (value.startsWith("-") ? `−${value.slice(1)}` : `+${value}`);
  const amount = signed(margin.amount);
  return margin.percent === null ? amount : `${amount} (${signed(String(margin.percent))}%)`;
}

/** Which way a margin goes, for its colour: a loss, a profit, or neither. */
export function marginSign(margin: PriceMargin): -1 | 0 | 1 {
  const value = Number(margin.amount);
  return value < 0 ? -1 : value > 0 ? 1 : 0;
}

/** The book the catalogue value was read in, for the Catalogue row's tooltip — a bracketed note on the
 *  row until #1843. Several books are counted and then listed; null when none can be named. */
export function describeCatalogueSource(catalogues: readonly string[]): string | null {
  if (catalogues.length === 0) return null;
  if (catalogues.length === 1) return `Read in ${catalogues[0]}`;
  return `Read in ${catalogues.length} catalogues: ${catalogues.join(", ")}`;
}

/** The Estimated row's note (#1839): the ratio and nothing more — `58% of catalogue`. */
export function describeEstimateNote(ratio: number): string {
  return `${Math.round(ratio * 100)}% of catalogue`;
}

/** `own` is the offer's own price — the table's last row since #1839. */
export type OfferPriceRowKey = "minimum" | "catalogue" | "estimated" | "market" | "marketTrend" | "cost" | "own";

export interface OfferPriceRow {
  key: OfferPriceRowKey;
  /** 2-dp string in the offer's currency; null only on the rows that are always drawn — Minimum on a
   *  platform that sets none, Market with nothing recorded, Cost while no copy's is known, and the
   *  offer's own price while it has none. */
  amount: string | null;
  /** Over the cost row; null on the cost row itself and wherever the cost is unknown. */
  margin: PriceMargin | null;
}

/** The figures the table is drawn from, every one per set and in the offer's currency, null when it
 *  does not exist. */
export interface OfferPriceFigures {
  minimum: string | null;
  catalogue: string | null;
  estimated: string | null;
  market: string | null;
  /** Market brought to today by the price trend (#2461); null when no trend applies, and the row is
   *  then not drawn. Absent reads as null. */
  marketTrend?: string | null;
  cost: string | null;
  /** The offer's own price; null while it has none. */
  own: string | null;
}

const ROW_ORDER: readonly OfferPriceRowKey[] = [
  "minimum",
  "catalogue",
  "estimated",
  "market",
  "marketTrend",
  "cost",
  "own",
];

/** The rows drawn whether or not they have a figure: Minimum (#1843), Market (#1839) and Cost (#2333),
 *  whose absence is itself worth saying — a missing cost says why — and the offer's own price, which is
 *  where it is set. */
const ALWAYS_DRAWN: ReadonlySet<OfferPriceRowKey> = new Set(["minimum", "market", "cost", "own"]);

/**
 * The table's rows, in the order the collector named them, the offer's own price last. A figure that
 * does not exist is left out, never drawn as `0.00` (#1184) — and a price of zero is no price, so the
 * prices drop out at zero too — except Minimum, Market, Cost and the offer's own price, which are drawn
 * empty.
 * **A cost of zero is kept**: copies that cost nothing are a known cost, and every margin then reads
 * as the whole price.
 */
export function offerPriceRows(figures: OfferPriceFigures): OfferPriceRow[] {
  const cost = figures.cost === null ? null : Number(figures.cost);
  const known = cost !== null && Number.isFinite(cost) && cost >= 0;
  const rows: OfferPriceRow[] = [];
  for (const key of ROW_ORDER) {
    const amount = figures[key] ?? null;
    const value = amount === null ? NaN : Number(amount);
    if (key === "cost") {
      rows.push({ key, amount: known ? amount : null, margin: null });
      continue;
    }
    if (!(Number.isFinite(value) && value > 0)) {
      if (ALWAYS_DRAWN.has(key)) rows.push({ key, amount: null, margin: null });
      continue;
    }
    rows.push({ key, amount, margin: known ? priceMargin(value, cost) : null });
  }
  return rows;
}

/**
 * **Your price vs** a reference row (#2477): how far the offer's own price is above or below that
 * row's price, as an amount and that amount as a share of the row's price — `+0.14 (+280%)` for 0.19
 * against a Minimum of 0.05 — in {@link PriceMargin}'s form, so it prints and colours as *Profit over
 * cost* does (above is green, below is the warning colour).
 *
 * Null while the offer has no price of its own — the column is then empty — and `"unknown"` for a row
 * whose price is not known, drawn `—`. A reference of zero (a cost of nothing) gives the amount with no
 * share, as a margin over a zero cost does.
 */
export function priceVsOwn(own: string | null, reference: string | null): PriceMargin | "unknown" | null {
  const ownValue = own === null ? NaN : Number(own);
  if (!(Number.isFinite(ownValue) && ownValue > 0)) return null;
  const value = reference === null ? NaN : Number(reference);
  if (!(Number.isFinite(value) && value >= 0)) return "unknown";
  return priceMargin(ownValue, value);
}

/** A reference row as the price scale names it — short, since its labels share one line. */
export type PriceScaleKey = Exclude<OfferPriceRowKey, "own">;

export const PRICE_SCALE_LABEL: Record<PriceScaleKey, string> = {
  minimum: "Min",
  catalogue: "Cat.",
  estimated: "Est.",
  market: "Market",
  marketTrend: "Market trend",
  cost: "Cost",
};

export interface PriceScaleTick {
  key: PriceScaleKey;
  amount: string;
  /** Where on the axis, 0 at the left end (a price of zero) to 1 at the right (the highest price). */
  position: number;
  /** Which side of the axis its label sits on: close ticks alternate so no two labels overlap. */
  side: "above" | "below";
}

/**
 * The five zones the scale is coloured in (#2497), left to right: below both Minimum and Cost, between
 * the two, Cost to Estimated, Estimated to Catalogue, above Catalogue.
 */
export type PriceScaleZoneKey = "below" | "minimumCost" | "costEstimated" | "estimatedCatalogue" | "aboveCatalogue";

export interface PriceScaleZone {
  key: PriceScaleZoneKey;
  /** Where it starts and ends on the axis, as a tick's `position`; never empty. */
  start: number;
  end: number;
  /** The legend's name for it, from the prices that actually bound it — `Cost–Cat.` with no Estimated. */
  label: string;
}

export interface PriceScale {
  ticks: PriceScaleTick[];
  /** The offer's own price, marked apart from the ticks; null while it has none. */
  own: { amount: string; position: number } | null;
  /** The coloured zones in axis order, each one only where it has width; empty when no price that
   *  bounds a zone (Minimum, Cost, Estimated, Catalogue) is known. */
  zones: PriceScaleZone[];
}

/** How close two ticks may sit, as a share of the axis, before their labels go to opposite sides. */
export const PRICE_SCALE_MIN_GAP = 0.16;

/** How far the axis runs past Catalogue, as a share of it, when Catalogue is the highest price — so the
 *  zone above it shows (#2497). */
export const PRICE_SCALE_HEADROOM = 0.1;

type ScaleBound = { key: PriceScaleKey; value: number };

/**
 * **The scale's zones** (#2497), each bounded by reference prices as the collector settled them on
 * 2026-11-13: red below both Minimum and Cost, coral between them (whichever is lower first), a pale
 * teal from Cost to Estimated — acceptable, not a warning — green from Estimated to Catalogue, blue
 * above Catalogue.
 *
 * A zone whose bounding price is unknown is not drawn and its neighbour runs on to the next known
 * price: with no Estimated, pale teal runs from Cost to Catalogue; with no Cost, red ends at Minimum;
 * with no Catalogue, the last zone runs to the end of the axis. Where Estimated is at or above
 * Catalogue there is no green: pale teal runs to Catalogue, then blue. Market and Market trend bound
 * nothing. The zones are contiguous from 0 to `max`, each starting where the one before ends, so an
 * Estimated below Cost cannot run a zone backwards — it just leaves no pale teal; a zone with no width
 * is dropped. No zone at all when none of the four bounding prices is known.
 */
function scaleZones(bounds: Partial<Record<PriceScaleKey, number>>, max: number): PriceScaleZone[] {
  const bound = (key: PriceScaleKey): ScaleBound | null => (bounds[key] === undefined ? null : { key, value: bounds[key]! });
  const minimum = bound("minimum");
  const cost = bound("cost");
  const estimated = bound("estimated");
  const catalogue = bound("catalogue");
  if (!minimum && !cost && !estimated && !catalogue) return [];

  const floor = [minimum, cost].filter((b): b is ScaleBound => b !== null).sort((a, b) => a.value - b.value);
  const green = estimated && (!catalogue || estimated.value < catalogue.value) ? estimated : null;
  const name = (key: PriceScaleKey) => PRICE_SCALE_LABEL[key];
  const span = (from: ScaleBound | null, to: ScaleBound | null) =>
    from && to ? `${name(from.key)}–${name(to.key)}` : from ? `Above ${name(from.key)}` : to ? `Below ${name(to.key)}` : "";

  // Each drawn zone, with the price that ends it (null: runs to the end of the axis).
  const plan: Array<{ key: PriceScaleZoneKey; to: ScaleBound | null; label: (from: ScaleBound | null) => string }> = [];
  if (floor.length > 0)
    plan.push({
      key: "below",
      to: floor[0],
      label: () => (floor.length === 2 ? `Below ${name("minimum")} and ${name("cost")}` : `Below ${name(floor[0].key)}`),
    });
  if (floor.length === 2) plan.push({ key: "minimumCost", to: floor[1], label: (from) => span(from, floor[1]) });
  const tealTo = green ?? catalogue;
  plan.push({ key: "costEstimated", to: tealTo, label: (from) => span(from, tealTo) });
  if (green) plan.push({ key: "estimatedCatalogue", to: catalogue, label: (from) => span(from, catalogue) });
  if (catalogue) plan.push({ key: "aboveCatalogue", to: null, label: () => `Above ${name("catalogue")}` });

  const zones: PriceScaleZone[] = [];
  let from: ScaleBound | null = null;
  let start = 0;
  for (const step of plan) {
    const endValue = step.to ? Math.min(max, Math.max(start * max, step.to.value)) : max;
    const end = endValue / max;
    if (end > start) zones.push({ key: step.key, start, end, label: step.label(from) });
    start = Math.max(start, end);
    from = step.to;
  }
  return zones;
}

/**
 * **The price scale under the table** (#2477): a linear axis from 0 to the highest price on it — the
 * offer's own price included — with a tick for every reference row whose price is known and a marker
 * for the offer's own price, so where it sits among them reads at a glance, over the coloured zones of
 * {@link scaleZones} (#2497). Where Catalogue is the highest price the axis runs `PRICE_SCALE_HEADROOM`
 * past it, so the zone above Catalogue has width. A row with no price has no tick. Labels go above the axis unless the tick sits within `minGap` of the last label there, then
 * below, so ticks close together alternate; ticks in price order, a tie in the table's order.
 *
 * Null when there is nothing to draw: no known price at all, or every price zero.
 */
export function priceScale(rows: readonly OfferPriceRow[], minGap = PRICE_SCALE_MIN_GAP): PriceScale | null {
  const known = (amount: string | null) => {
    const value = amount === null ? NaN : Number(amount);
    return Number.isFinite(value) && value >= 0 ? value : null;
  };
  const references = rows
    .filter((row): row is OfferPriceRow & { key: PriceScaleKey } => row.key !== "own")
    .flatMap((row) => {
      const value = known(row.amount);
      return value === null ? [] : [{ key: row.key, amount: row.amount!, value }];
    });
  const ownRow = rows.find((row) => row.key === "own");
  const ownValue = ownRow ? known(ownRow.amount) : null;
  const own = ownValue !== null && ownValue > 0 ? { amount: ownRow!.amount!, value: ownValue } : null;
  const highest = Math.max(0, own?.value ?? 0, ...references.map((r) => r.value));
  if (highest <= 0) return null;
  const catalogueValue = references.find((r) => r.key === "catalogue")?.value;
  // With Catalogue the highest price, the axis runs a little past it so the zone above shows (#2497).
  const max = catalogueValue !== undefined && catalogueValue >= highest && catalogueValue > 0
    ? catalogueValue * (1 + PRICE_SCALE_HEADROOM)
    : highest;
  const at = (value: number) => value / max;

  let lastAbove = -Infinity;
  let lastBelow = -Infinity;
  const ticks = [...references]
    .sort((a, b) => a.value - b.value)
    .map((reference): PriceScaleTick => {
      const position = at(reference.value);
      let side: PriceScaleTick["side"];
      if (position - lastAbove >= minGap) side = "above";
      else if (position - lastBelow >= minGap) side = "below";
      else side = lastAbove <= lastBelow ? "above" : "below";
      if (side === "above") lastAbove = position;
      else lastBelow = position;
      return { key: reference.key, amount: reference.amount, position, side };
    });
  const bounds: Partial<Record<PriceScaleKey, number>> = {};
  for (const r of references) if (r.key !== "market" && r.key !== "marketTrend") bounds[r.key] = r.value;
  return {
    ticks,
    own: own ? { amount: own.amount, position: at(own.value) } : null,
    zones: scaleZones(bounds, max),
  };
}

/** One set as {@link offerPriceFigures} reads it: the set's holdings summary (catalogue and market,
 *  base currency), its COST (#1736) and its copies' estimates (#1829). Structural, so this module
 *  stays pure. */
export interface PriceFigureSet {
  holdings: {
    pricedCount: number;
    totalBaseAmount: string;
    faultReductionBaseAmount: string;
    faultReducedCount: number;
    market: { valuedCount: number; totalBaseAmount: string; noEvidenceCount: number };
  };
  /** The set's COST (#1736), base currency. */
  cost: OfferSetCost;
  estimates: readonly CopyEstimateInput[];
  /** Its copies with recorded results, for Market trend (#2461). Absent reads as none. */
  marketTrends?: readonly CopyMarketTrendInput[];
}

/** The price table's figures over an offer's sets, in the offer's currency — every one per set. */
export interface OfferPriceFigureSummary {
  /** Catalogue value per set; null when nothing is valued or no rate converts it. */
  catalogPrice: string | null;
  /** {@link catalogPrice} without the copies' fault reductions (#1560); null when nothing was lowered. */
  catalogFullPrice: string | null;
  catalogUnpricedSets: number;
  catalogFaultReducedCount: number;
  /** Estimated value per set — the suggestion (#1829). */
  suggestedPrice: string | null;
  suggestedEstimate: { valuedSets: number; copies: number; ratio: number; source: EstimateSource } | null;
  catalogNames: string[];
  marketPrice: { amount: string; valuedSets: number; copies: number; noEvidenceCopies: number } | null;
  marketUnconvertible: boolean;
  /** Market brought to today by the price trend, per set (#2461); null when no trend applies to any
   *  copy, or no rate converts it. */
  marketTrendPrice: { amount: string; copies: number; trendedCopies: number; trends: TrendStatementInput[] } | null;
  /** The COST per set; null when no set's cost is known or no rate converts it. */
  costPrice: string | null;
  /** There is a COST, but no rate converts it into the offer's currency (#2436). */
  costUnconvertible: boolean;
  /** The base-currency sums the catalogue figure was taken from, for the offer's totals (#378). */
  catalogue: { sumBase: number; reductionBase: number; valuedSets: number };
  /** The COST per set, base currency (#1736). */
  costAverageBase: number | null;
}

/**
 * The figures the price table is drawn from (#1829/#1839/#1843), over an offer's sets.
 *
 * One function for every surface that draws the table — the offer's own screen and the Prepare
 * screen (#1894) — so a figure cannot read one way on the offer and another beside it in a batch.
 * `toOffer` converts base to the offer's currency: 1 when the offer prices in the base currency, null
 * when no rate is known, which leaves every figure null rather than one in the wrong currency.
 *
 * A set counts towards the catalogue figure when *some* copy of it priced (#378), towards the market
 * one when some copy has recorded results (#458), and towards the COST when its cost is known.
 */
export function offerPriceFigures(
  sets: readonly PriceFigureSet[],
  toOffer: number | null
): OfferPriceFigureSummary {
  const inOffer = (base: number | null) => (base === null || toOffer === null ? null : (base * toOffer).toFixed(2));

  let sumSetCV = 0;
  let valuedSets = 0;
  let sumSetReduction = 0;
  let faultReducedCount = 0;
  for (const s of sets) {
    if (s.holdings.pricedCount === 0) continue;
    sumSetCV += Number(s.holdings.totalBaseAmount);
    sumSetReduction += Number(s.holdings.faultReductionBaseAmount);
    faultReducedCount += s.holdings.faultReducedCount;
    valuedSets++;
  }
  const catalogPrice = valuedSets > 0 ? inOffer(sumSetCV / valuedSets) : null;
  const catalogFullPrice =
    valuedSets > 0 && faultReducedCount > 0 ? inOffer((sumSetCV + sumSetReduction) / valuedSets) : null;

  const estimate = estimateSets(sets.map((s) => s.estimates));
  const suggestedPrice = estimate ? inOffer(estimate.averageBase) : null;

  let sumSetMarket = 0;
  let marketSets = 0;
  let marketCopies = 0;
  let noEvidenceCopies = 0;
  for (const s of sets) {
    noEvidenceCopies += s.holdings.market.noEvidenceCount;
    if (s.holdings.market.valuedCount === 0) continue;
    sumSetMarket += Number(s.holdings.market.totalBaseAmount);
    marketCopies += s.holdings.market.valuedCount;
    marketSets++;
  }
  const marketAmount = marketSets > 0 ? inOffer(sumSetMarket / marketSets) : null;

  const trend = marketTrendSets(sets.map((s) => s.marketTrends ?? []));
  const marketTrendAmount = trend ? inOffer(trend.averageBase) : null;

  const costAverageBase = offerCostTotals(sets.map((s) => s.cost)).average;

  return {
    catalogPrice,
    catalogFullPrice,
    catalogUnpricedSets: sets.length - valuedSets,
    catalogFaultReducedCount: faultReducedCount,
    suggestedPrice,
    suggestedEstimate:
      estimate && suggestedPrice !== null
        ? { valuedSets: estimate.valuedSets, copies: estimate.copies, ratio: estimate.ratio, source: estimate.source }
        : null,
    catalogNames: estimate?.catalogues ?? [],
    marketPrice:
      marketAmount === null
        ? null
        : { amount: marketAmount, valuedSets: marketSets, copies: marketCopies, noEvidenceCopies },
    marketUnconvertible: marketSets > 0 && marketAmount === null,
    marketTrendPrice:
      trend === null || marketTrendAmount === null
        ? null
        : {
            amount: marketTrendAmount,
            copies: trend.copies,
            trendedCopies: trend.trendedCopies,
            trends: trend.trends,
          },
    costPrice: inOffer(costAverageBase),
    costUnconvertible: costAverageBase !== null && toOffer === null,
    catalogue: { sumBase: sumSetCV, reductionBase: sumSetReduction, valuedSets },
    costAverageBase,
  };
}
