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
// that skipped the measured copies would price the set as though they were worth nothing. A copy
// valued at a **recorded** figure (#747) has no catalogue value to correct, and is left out.
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
// that sets none — and Cost became a price that can be clicked like the others.

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
export type OfferPriceRowKey = "minimum" | "catalogue" | "estimated" | "market" | "cost" | "own";

export interface OfferPriceRow {
  key: OfferPriceRowKey;
  /** 2-dp string in the offer's currency; null only on the rows that are always drawn — Minimum on a
   *  platform that sets none, Market with nothing recorded, and the offer's own price while it has
   *  none. */
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
  cost: string | null;
  /** The offer's own price; null while it has none. */
  own: string | null;
}

const ROW_ORDER: readonly OfferPriceRowKey[] = ["minimum", "catalogue", "estimated", "market", "cost", "own"];

/** The rows drawn whether or not they have a figure: Minimum (#1843) and Market (#1839), whose absence
 *  is itself worth saying, and the offer's own price, which is where it is set. */
const ALWAYS_DRAWN: ReadonlySet<OfferPriceRowKey> = new Set(["minimum", "market", "own"]);

/**
 * The table's rows, in the order the collector named them, the offer's own price last. A figure that
 * does not exist is left out, never drawn as `0.00` (#1184) — and a price of zero is no price, so the
 * prices drop out at zero too — except Minimum, Market and the offer's own price, which are drawn
 * empty.
 * **A cost of zero is kept**: copies that cost nothing are a known cost, and every margin then reads
 * as the whole price.
 */
export function offerPriceRows(figures: OfferPriceFigures): OfferPriceRow[] {
  const cost = figures.cost === null ? null : Number(figures.cost);
  const known = cost !== null && Number.isFinite(cost) && cost >= 0;
  const rows: OfferPriceRow[] = [];
  for (const key of ROW_ORDER) {
    const amount = figures[key];
    const value = amount === null ? NaN : Number(amount);
    if (key === "cost") {
      if (known) rows.push({ key, amount, margin: null });
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
