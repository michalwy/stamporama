// **A stamp's price trend, and its results brought to today's money** (#2460). No Prisma import —
// kept apart from the domain layer so it is unit-testable, exactly as `realization-ratio.ts` and
// `bid-recommendation.ts` beside it.
//
// A bid's `fair` used to be the plain median of every result recorded for its key, however old
// (ADR-0029 §1). A stamp whose price keeps rising then always has a median behind today's market,
// and bidding at fair — or even at walk-away — loses every lot of it. So the market rung of a bid
// anchor brings each result to today by the stamp's yearly trend first, and takes the median of
// those:
//
//     trend  = median over every pair of results (i earlier than j) of (vⱼ ÷ vᵢ)^(1 / years) − 1
//     fair   = median over the results of  v × (1 + trend)^(years since it was sold)
//
// **The trend is robust**, settled with the collector on 2026-11-05: the median of the yearly rates
// of change between every pair of results — the Theil–Sen estimator, on rates rather than on
// amounts so that stamps of different prices trend alike. One wild result enters as many pairs as
// any other and moves the median of them no further than it moves the plain median today. **It works
// both ways**: a stamp getting cheaper gets a fair below its median.
//
// **Only the bid recommendation reads this.** Market value stays the plain median everywhere it is
// shown — holdings, copies, offers, sales — because it is the measurement; the trend is a projection
// made for one purpose, a bid placed now.
//
// The constants are code, not settings, for #520's reason: they describe how thin this evidence is,
// and a collector asked to tune them would have no way to tell a better value from a worse one.

/** Results a trend needs before it is measured at all — a stamp's own or its group's (#2460). */
export const TREND_MIN_RESULTS = 4;

/** How far apart the first and the last of them must be: twelve months. Four results inside one
 * season say nothing about a year. */
export const TREND_MIN_SPAN_DAYS = 365;

/** The trend is held within ±30% a year, so that a short or noisy history cannot produce an absurd
 * projection. A capped trend says so wherever it is shown. */
export const TREND_CAP = 0.3;

const DAY_MS = 86_400_000;
const YEAR_MS = 365.25 * DAY_MS;

/** One result as a trend reads it: a positive figure and the day it was sold. The figure is an
 * amount for a stamp's own trend and a share of catalogue for a group's — the trend is a rate, so
 * either unit gives the same answer. */
export interface TrendPoint {
  value: number;
  at: Date;
}

/** A measured trend. */
export interface PriceTrend {
  /** The yearly rate applied, after the cap — `0.14` is +14% a year. */
  rate: number;
  /** The rate before the cap; equal to {@link rate} unless {@link capped}. */
  measuredRate: number;
  capped: boolean;
  /** Results it was measured over. */
  n: number;
  earliestAt: Date;
  latestAt: Date;
}

/** Median of a non-empty list: the middle value, or the mean of the two middle ones. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function usable(points: readonly TrendPoint[]): TrendPoint[] {
  return points.filter((p) => Number.isFinite(p.value) && p.value > 0 && Number.isFinite(p.at.getTime()));
}

/**
 * The yearly trend of a set of results, or null when there are too few of them — fewer than
 * {@link TREND_MIN_RESULTS}, or spread over less than {@link TREND_MIN_SPAN_DAYS}.
 *
 * Every pair sold on different days contributes one rate; two sold at the same moment say nothing
 * about time and are left out. The median of the rates is then held within ±{@link TREND_CAP}.
 */
export function priceTrendOf(points: readonly TrendPoint[]): PriceTrend | null {
  const counted = usable(points);
  if (counted.length < TREND_MIN_RESULTS) return null;
  const times = counted.map((p) => p.at.getTime());
  const earliest = Math.min(...times);
  const latest = Math.max(...times);
  if (latest - earliest < TREND_MIN_SPAN_DAYS * DAY_MS) return null;

  const rates: number[] = [];
  for (let i = 0; i < counted.length; i++) {
    for (let j = i + 1; j < counted.length; j++) {
      const [early, late] =
        counted[i].at.getTime() <= counted[j].at.getTime() ? [counted[i], counted[j]] : [counted[j], counted[i]];
      const years = (late.at.getTime() - early.at.getTime()) / YEAR_MS;
      if (years <= 0) continue;
      const rate = Math.pow(late.value / early.value, 1 / years) - 1;
      if (Number.isFinite(rate)) rates.push(rate);
    }
  }
  // The span guarantees the first and the last are a pair; a non-finite rate is the only way out.
  if (rates.length === 0) return null;

  const measuredRate = medianOf(rates);
  const rate = Math.max(-TREND_CAP, Math.min(TREND_CAP, measuredRate));
  return {
    rate,
    measuredRate,
    capped: rate !== measuredRate,
    n: counted.length,
    earliestAt: new Date(earliest),
    latestAt: new Date(latest),
  };
}

/** One result brought to `now` at a yearly `rate`: compounded over the years since it was sold. */
export function bringToToday(value: number, at: Date, rate: number, now: Date): number {
  const years = (now.getTime() - at.getTime()) / YEAR_MS;
  return value * Math.pow(1 + rate, years);
}

/**
 * The median of the results once each is brought to `now` at `rate` — a trend-adjusted fair
 * (#2460). Null for no usable result. The median of the brought-forward results, not the plain
 * median brought forward: each result travels its own distance.
 */
export function trendAdjustedMedian(points: readonly TrendPoint[], rate: number, now: Date): number | null {
  const counted = usable(points);
  if (counted.length === 0) return null;
  return medianOf(counted.map((p) => bringToToday(p.value, p.at, rate, now)));
}

/** A rate as the recommendation states it: `+14%/yr`, `−8%/yr`, `0%/yr`. */
export function formatTrendRate(rate: number): string {
  const percent = Math.round(rate * 100);
  if (percent === 0) return "0%/yr";
  return `${percent > 0 ? "+" : "−"}${Math.abs(percent)}%/yr`;
}

/** A trend as a surface states it — what both the evidence popover and `recommend_bid` print. */
export interface TrendStatementInput {
  rate: number;
  measuredRate: number;
  capped: boolean;
  n: number;
  earliestAt: Date | string;
  latestAt: Date | string;
  /** The group it was borrowed from, or null for the stamp's own. */
  borrowed: { bucketLabel: string } | null;
}

/** The years a trend was measured over: `2022–2025`, or `2025` inside one. */
function yearSpan(earliest: Date | string, latest: Date | string): string {
  const from = new Date(earliest).getUTCFullYear();
  const to = new Date(latest).getUTCFullYear();
  return from === to ? String(from) : `${from}–${to}`;
}

/**
 * `trend +14%/yr, 4 results 2022–2025` — or, borrowed, `trend +12%/yr borrowed from Polska Ludowa,
 * MNH, 1948–1952 (9 results 2021–2025)` — with `capped, measured +45%/yr` where the cap applied
 * (#2460). A borrowed trend is always named as borrowed, and a capped one as capped.
 */
export function trendStatement(trend: TrendStatementInput): string {
  const evidence = `${trend.n} result${trend.n === 1 ? "" : "s"} ${yearSpan(trend.earliestAt, trend.latestAt)}`;
  const capped = trend.capped ? `, capped — measured ${formatTrendRate(trend.measuredRate)}` : "";
  return trend.borrowed
    ? `trend ${formatTrendRate(trend.rate)}${capped}, borrowed from ${trend.borrowed.bucketLabel} (${evidence})`
    : `trend ${formatTrendRate(trend.rate)}${capped}, ${evidence}`;
}
