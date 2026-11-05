// **One key's market results brought to today's money** (#2460, #2461) — the rule a recommended bid's
// fair is anchored on, and the offer's *Market trend* row is priced with. One function for both, so a
// stamp cannot trend one way in the bid popover and another in the offer's price table.
//
// Pure: everything it is given is already loaded, and its imports are types only, so it is
// unit-testable beside `price-trend.ts`.
//
// The trend is the key's **own** when its results are enough for one (`priceTrendOf`), else
// **borrowed** from its group — the ratio ladder's area × condition × period, then area × condition
// (`RealizationRatioResolver.trend`) — else there is none and the caller keeps the plain median.
// **Market value everywhere else stays the plain median** (`market-values.ts` knows nothing of this).

import { marketKeyOf, type MarketValueKey } from "./market-value";
import type { CopyMarketTrendInput } from "./offer-price-table";
import { priceTrendOf, trendAdjustedMedian, type TrendPoint } from "./price-trend";
import type { TrendBucketLevel } from "./realization-ratio";
import type { BorrowedTrend } from "./realization-ratios";

/** A key's results brought to today's money by its stamp's price trend. */
export interface MarketTrend {
  /** The median of the key's results once each is brought to today, base currency, 2-dp. */
  fair: string;
  /** The yearly rate applied, after the ±30% cap — `0.14` is +14% a year. */
  rate: number;
  /** The rate measured, before the cap. */
  measuredRate: number;
  capped: boolean;
  /** Null when the key's own results gave the trend; the group it was borrowed from otherwise,
   * named as its ratio bucket is. */
  borrowed: { level: TrendBucketLevel; bucketLabel: string } | null;
  /** The results the trend was measured over — the key's own, or the group's — and their span. */
  n: number;
  earliestAt: Date;
  latestAt: Date;
}

/** A key's results as the trend reads them — `StampMarketValue`'s two evidence lists. */
export interface MarketTrendEvidence {
  lots: readonly { amount: string; endsAt: Date }[];
  observations: readonly { amount: string; soldOn: Date }[];
}

/** The stamp the trend is borrowed for, when it has to be: what the ratio ladder buckets on. */
export interface MarketTrendSubject {
  areaId: string | null;
  conditionId: string;
  issuedYear: number | null;
}

/** What the trend asks of the ratio ladder: its group's trend. */
export interface GroupTrendLookup {
  trend(subject: MarketTrendSubject): BorrowedTrend | null;
}

/**
 * The key's results brought to `now` (#2460): by the trend of its own results when they are enough
 * for one, else by its group's, else not at all (null). The group is the ratio ladder's, so a stamp
 * is compared with the very stamps its catalogue ratio would be learned from.
 */
export function marketTrendOf(
  value: MarketTrendEvidence,
  subject: MarketTrendSubject,
  ratios: GroupTrendLookup,
  now: Date
): MarketTrend | null {
  const points: TrendPoint[] = [
    ...value.lots.map((lot) => ({ value: Number(lot.amount), at: lot.endsAt })),
    ...value.observations.map((o) => ({ value: Number(o.amount), at: o.soldOn })),
  ];
  const own = priceTrendOf(points);
  const group = own ? null : ratios.trend(subject);
  const trend = own ?? group?.trend ?? null;
  if (trend === null) return null;
  const fair = trendAdjustedMedian(points, trend.rate, now);
  if (fair === null) return null;
  return {
    fair: fair.toFixed(2),
    rate: trend.rate,
    measuredRate: trend.measuredRate,
    capped: trend.capped,
    borrowed: group ? { level: group.level, bucketLabel: group.bucketLabel } : null,
    n: trend.n,
    earliestAt: trend.earliestAt,
    latestAt: trend.latestAt,
  };
}

/** A key's figures as {@link copyMarketTrend} reads them: the plain median and its evidence. */
export interface MarketTrendValue extends MarketTrendEvidence {
  median: string;
}

/**
 * One held copy as the offer's Market trend row counts it (#2461), or null when it has no recorded
 * result — exactly when Market counts it as without evidence (`copyMarketMedian`).
 *
 * `market` is the plain median, `trended` the same brought to today by the trend; both are lowered
 * for the copy's faults by `reduce`, the rule Market applies, so the two rows differ only by the
 * trend. A copy identified as one of several candidates (#1651) is valued at the **lowest** of its
 * candidates' — each trended on its own — and has none when any candidate has none, as under Market.
 * The trend borrowed for a candidate is the copy's own stamp's group: candidates are one issue's
 * variants, filed in one area and one year.
 */
export function copyMarketTrend(
  copy: Omit<MarketValueKey, "conditionId"> & {
    conditionId: string | null;
    candidateStampIds: readonly string[] | null;
    areaId: string | null;
    issuedYear: number | null;
  },
  values: ReadonlyMap<string, MarketTrendValue>,
  ratios: GroupTrendLookup,
  now: Date,
  reduce: (amount: number) => number
): CopyMarketTrendInput | null {
  const { conditionId } = copy;
  if (conditionId === null) return null;
  const subject = { areaId: copy.areaId, conditionId, issuedYear: copy.issuedYear };
  const stampIds =
    copy.candidateStampIds && copy.candidateStampIds.length >= 2 ? copy.candidateStampIds : [copy.stampId];
  let best: CopyMarketTrendInput | null = null;
  for (const stampId of stampIds) {
    const value = values.get(marketKeyOf({ ...copy, conditionId, stampId }));
    if (value === undefined) return null;
    const trend = marketTrendOf(value, subject, ratios, now);
    const median = Number(value.median);
    const candidate: CopyMarketTrendInput = {
      market: reduce(median),
      trended: reduce(trend ? Number(trend.fair) : median),
      trend: trend
        ? {
            rate: trend.rate,
            measuredRate: trend.measuredRate,
            capped: trend.capped,
            n: trend.n,
            earliestAt: trend.earliestAt,
            latestAt: trend.latestAt,
            borrowed: trend.borrowed ? { bucketLabel: trend.borrowed.bucketLabel } : null,
          }
        : null,
    };
    if (best === null || candidate.trended < best.trended) best = candidate;
  }
  return best;
}
