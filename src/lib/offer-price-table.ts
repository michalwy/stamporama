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
  source: EstimateSource;
}

const bucketKey = (copy: CopyEstimateInput) => `${copy.level}\u0000${copy.bucketLabel}\u0000${copy.ratio}`;

/**
 * Estimated value per set: each set's copies summed at catalogue × ratio, averaged over the sets
 * that have any. Null when no copy of any set can be estimated.
 */
export function estimateSets(sets: readonly (readonly CopyEstimateInput[])[]): SetsEstimate | null {
  let sum = 0;
  let valuedSets = 0;
  let copies = 0;
  const buckets = new Map<string, CopyEstimateInput>();
  for (const set of sets) {
    if (set.length === 0) continue;
    for (const copy of set) {
      sum += copy.catalogueBase * copy.ratio;
      buckets.set(bucketKey(copy), copy);
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

/** A margin as the table prints it: `+12.00 · +40%`, `−3.50 · −10%`. */
export function formatPriceMargin(margin: PriceMargin): string {
  const signed = (value: string) => (value.startsWith("-") ? `−${value.slice(1)}` : `+${value}`);
  const amount = signed(margin.amount);
  return margin.percent === null ? amount : `${amount} · ${signed(String(margin.percent))}%`;
}

export type OfferPriceRowKey = "minimum" | "catalogue" | "estimated" | "market" | "cost";

export interface OfferPriceRow {
  key: OfferPriceRowKey;
  /** 2-dp string in the offer's currency. */
  amount: string;
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
}

const ROW_ORDER: readonly OfferPriceRowKey[] = ["minimum", "catalogue", "estimated", "market", "cost"];

/**
 * The table's rows, in the order the collector named them. A figure that does not exist is left
 * out, never drawn as `0.00` (#1184) — and a price of zero is no price, so the four prices drop out
 * at zero too. **A cost of zero is kept**: copies that cost nothing are a known cost, and every
 * margin then reads as the whole price.
 */
export function offerPriceRows(figures: OfferPriceFigures): OfferPriceRow[] {
  const cost = figures.cost === null ? null : Number(figures.cost);
  const known = cost !== null && Number.isFinite(cost);
  const rows: OfferPriceRow[] = [];
  for (const key of ROW_ORDER) {
    const amount = figures[key];
    if (amount === null) continue;
    const value = Number(amount);
    if (!Number.isFinite(value)) continue;
    if (key === "cost") {
      if (value < 0) continue;
      rows.push({ key, amount, margin: null });
      continue;
    }
    if (value <= 0) continue;
    rows.push({ key, amount, margin: known ? priceMargin(value, cost) : null });
  }
  return rows;
}
