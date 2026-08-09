// **What fraction of catalogue a stamp actually fetches, learned from recorded results** (#520;
// ADR-0029 §2). No Prisma import — kept apart from the domain layer so it is unit-testable, exactly
// as `market-value.ts` and `bid-recommendation.ts` beside it.
//
// ADR-0022 turns closed lots into datapoints; every one of those carries both halves of a ratio:
//
//     ratio(datapoint) = perUnitMarketValue ÷ catalogueValue(key)      both in base currency
//
// A datapoint whose key has no catalogue value yields a market value but no ratio.
//
// What a stamp with no market datapoint of its own is anchored on is the **median** of the ratios
// in the most specific bucket holding at least {@link MIN_RATIO_SAMPLE} of them, otherwise the next
// one down:
//
//   1. area × condition × period      the stamp's primary area, the line's condition, `issuedYear`
//                                     within ±{@link RATIO_PERIOD_RADIUS} years
//   2. area × condition
//   3. area
//   4. collection                     every ratio recorded
//   5. `bidFallbackPercent` (#508)    nothing has been learned yet
//
// **Condition drops out before area on purpose.** The catalogue already prices condition — MNH and
// used are different catalogue entries — so the market ÷ catalogue ratio is comparatively stable
// across conditions. What the catalogue does *not* carry is that a whole area's figures run high or
// low, and that is the effect worth keeping longest.
//
// **The period axis is a sliding window centred on the stamp being anchored**, not a fixed decade
// bucket, so 1949 and 1950 are neighbours rather than falling either side of a boundary. Each line
// therefore resolves its own sample, which is why the resolver takes a subject rather than
// pre-grouping.
//
// **A split lot counts once per bucket.** ADR-0022 §3 splits a mixed lot pro-rata by catalogue
// value, so every line of that lot carries the same ratio *by construction* — the lot's. Counting
// them separately would let one twenty-line dealer lot enter twenty identical ratios and dominate
// the median. Whole (single-line) datapoints are independent observations and count individually.
//
// **Median, not mean**, for the reason ADR-0022 §4 already gives: a philatelic sample always
// contains one wild result, and the median is reproducible by eye from the list beneath it.
//
// Both constants below are code, not settings (ADR-0029 §2): they are properties of how thin this
// evidence is, not preferences, and a collector asked to tune them would have no way to tell a
// better value from a worse one.

/** Ratios a bucket must hold before it is preferred to the broader one beneath it.
 *
 * ADR-0022 §4 refused a minimum sample for a market value and this imposes one, which is not a
 * contradiction: there, the alternative to a thin sample is showing nothing; here it is a broader
 * bucket, which is strictly better than one accidental ratio driving every unrecorded stamp of a
 * decade. Three is the point at which a median stops being a single observation wearing a
 * statistic's name. */
export const MIN_RATIO_SAMPLE = 3;

/** Half-width of the period bucket, in years: `issuedYear ± 2`, centred on the stamp being
 * anchored. */
export const RATIO_PERIOD_RADIUS = 2;

/** One recorded ratio, as the caller reads it off a market datapoint. */
export interface RatioObservation {
  /** The lot the datapoint came from — what split-derived ratios are deduplicated by. */
  lotId: string;
  /** The figure was carved out of a mixed lot's pro-rata split rather than taken whole
   * (ADR-0022 §3), which is exactly when the dedup applies. */
  split: boolean;
  /** `perUnitMarketValue ÷ catalogueValue`, both in the base currency. Unitless. */
  ratio: number;
  /** Primary area of the stamp the datapoint is about; null when it is linked to none. */
  areaId: string | null;
  conditionId: string;
  /** Issue year of the stamp; null when it carries none. */
  issuedYear: number | null;
}

/** The line being anchored, on the three axes the ladder buckets on. */
export interface RatioSubject {
  /** The stamp's primary area, or null — which skips the three buckets that need one. */
  areaId: string | null;
  conditionId: string;
  /** The stamp's issue year, or null — which skips the period bucket. */
  issuedYear: number | null;
}

/** Which bucket a ratio was resolved from. Ordered most specific first; `fallback` is not a bucket
 * at all but the configured `bidFallbackPercent` (#508), consulted only while nothing has been
 * learned. */
export type RatioBucketLevel =
  | "area-condition-period"
  | "area-condition"
  | "area"
  | "collection"
  | "fallback";

/** A resolved ratio and the evidence #511 renders beside it. Naming the bucket is what makes a
 * learned ratio arguable rather than magic: *"55% — Polska Ludowa, MNH, 1945–1949, n = 6"* can be
 * disagreed with; *"55%"* cannot. */
export interface ResolvedRatio {
  /** Unitless: multiply a catalogue value by this. */
  ratio: number;
  level: RatioBucketLevel;
  /** Observations behind the median, **after** the split-lot dedup. Zero at `fallback`. */
  n: number;
  /** The window the period bucket used, inclusive; null at every other level. */
  fromYear: number | null;
  toYear: number | null;
}

/** Median of a non-empty list: the middle value, or the mean of the two middle ones. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * A bucket's ratios, with split-derived ones counted once per lot.
 *
 * The dedup is *per bucket*, so a lot spanning several buckets contributes one observation to each
 * — it is one piece of evidence about each of them, and dropping it from all but the first would
 * make a bucket's sample depend on the order the lots happened to be read in.
 */
function ratiosOf(observations: RatioObservation[]): number[] {
  const out: number[] = [];
  const seenLots = new Set<string>();
  for (const observation of observations) {
    if (observation.split) {
      if (seenLots.has(observation.lotId)) continue;
      seenLots.add(observation.lotId);
    }
    out.push(observation.ratio);
  }
  return out;
}

/** True when an observation is usable at all. A non-finite ratio is arithmetic on a missing figure,
 * and a ratio of zero is a hammer price of nothing — neither says anything about what a stamp
 * fetches. */
export function isUsableRatio(ratio: number): boolean {
  return Number.isFinite(ratio) && ratio > 0;
}

/**
 * Resolve the ladder for one line.
 *
 * `fallbackPercent` is the collection's `bidFallbackPercent` (#508) and is reached only when no
 * bucket — not even the whole collection's — holds {@link MIN_RATIO_SAMPLE} ratios. It defaults to
 * 100 there, so until anything has been learned a catalogue-anchored figure is exactly what #370's
 * catalogue quick fill already writes and nothing silently changes meaning.
 *
 * `observations` is every ratio the collection has recorded, unfiltered: each bucket is a narrowing
 * of it, and the broadest one is the whole list.
 */
export function resolveRealizationRatio(
  subject: RatioSubject,
  observations: RatioObservation[],
  fallbackPercent: number
): ResolvedRatio {
  const usable = observations.filter((o) => isUsableRatio(o.ratio));

  const fromYear = subject.issuedYear === null ? null : subject.issuedYear - RATIO_PERIOD_RADIUS;
  const toYear = subject.issuedYear === null ? null : subject.issuedYear + RATIO_PERIOD_RADIUS;

  const inArea = subject.areaId === null ? null : usable.filter((o) => o.areaId === subject.areaId);
  const inAreaCondition =
    inArea === null ? null : inArea.filter((o) => o.conditionId === subject.conditionId);
  // A stamp with no `issuedYear` and a stamp with no primary area simply skip the buckets that
  // need them — they are not evidence-poor, the axis just does not exist for them.
  const inPeriod =
    inAreaCondition === null || fromYear === null || toYear === null
      ? null
      : inAreaCondition.filter(
          (o) => o.issuedYear !== null && o.issuedYear >= fromYear && o.issuedYear <= toYear
        );

  const ladder: { level: RatioBucketLevel; observations: RatioObservation[] | null }[] = [
    { level: "area-condition-period", observations: inPeriod },
    { level: "area-condition", observations: inAreaCondition },
    { level: "area", observations: inArea },
    { level: "collection", observations: usable },
  ];

  for (const rung of ladder) {
    if (rung.observations === null) continue;
    const ratios = ratiosOf(rung.observations);
    if (ratios.length < MIN_RATIO_SAMPLE) continue;
    return {
      ratio: medianOf(ratios),
      level: rung.level,
      n: ratios.length,
      fromYear: rung.level === "area-condition-period" ? fromYear : null,
      toYear: rung.level === "area-condition-period" ? toYear : null,
    };
  }

  return { ratio: fallbackPercent / 100, level: "fallback", n: 0, fromYear: null, toYear: null };
}

/** The names a bucket is stated with. Resolved by the domain layer, since only it knows what an
 * area and a condition are called. */
export interface RatioBucketNames {
  areaName: string | null;
  conditionName: string | null;
}

/**
 * What a bucket is called on screen — `Polska Ludowa, MNH, 1945–1949`.
 *
 * A name a level needs but that the caller could not resolve is simply left out rather than
 * rendered as a blank: the level is still the honest answer to "where did this come from".
 */
export function ratioBucketLabel(resolved: ResolvedRatio, names: RatioBucketNames): string {
  const parts: string[] = [];
  if (resolved.level !== "collection" && resolved.level !== "fallback") {
    if (names.areaName) parts.push(names.areaName);
    if (resolved.level !== "area" && names.conditionName) parts.push(names.conditionName);
    if (resolved.fromYear !== null && resolved.toYear !== null) {
      parts.push(`${resolved.fromYear}–${resolved.toYear}`);
    }
  }
  if (parts.length > 0) return parts.join(", ");
  return resolved.level === "fallback" ? "No recorded results" : "All recorded results";
}
