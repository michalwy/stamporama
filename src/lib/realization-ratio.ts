// **What fraction of catalogue a stamp actually fetches, learned from recorded results** (#520;
// ADR-0029 §2). No Prisma import — kept apart from the domain layer so it is unit-testable, exactly
// as `market-value.ts` and `bid-recommendation.ts` beside it.
//
// ADR-0022 turns closed lots into datapoints, and ADR-0063 adds the exact price observations from
// other people's auctions (#1633); every one of those carries both halves of a ratio:
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
//   4. catalogue                      every ratio read against the same catalogue (#1828)
//   5. the catalogue's manual factor  the collector's own estimate, `CatalogName.manualFactor`
//   6. collection                     every ratio recorded
//   7. `bidFallbackPercent` (#508)    nothing has been learned yet
//
// **The catalogue is a bucket because catalogues overstate by different amounts** (#1828): a Michel
// figure ten times the realised price is nothing unusual, while Fischer typically runs two to five
// times, and the collection bucket would fold the two into one median. It sits below area because an
// area is almost always priced from one catalogue anyway, so the area bucket already *is* a
// catalogue bucket, narrower. **The manual factor sits before the collection bucket**, decided with
// the collector: placed after it, three results from any catalogue would silence every manual factor
// and bring back the very blur the bucket removes. It is a stated estimate, not evidence, and is
// named as such wherever the bucket is.
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

import type { MarketDatapointSource } from "./market-value";

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
  /** Where the datapoint came from: a lot's line — the lot being what split-derived ratios are
   * deduplicated by, the line what a caller expanding a bucket names the stamp from (#602) — or a
   * price observation from someone else's auction (#1633), which is never split. */
  source: MarketDatapointSource;
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
  /** The catalogue the datapoint's catalogue value was read in (#1828) — `CopyValuation.catalogNameId`,
   * the area's primary book. Null only where no catalogue value was read, which yields no ratio. */
  catalogNameId: string | null;
}

/** The line being anchored, on the axes the ladder buckets on. */
export interface RatioSubject {
  /** The stamp's primary area, or null — which skips the three buckets that need one. */
  areaId: string | null;
  conditionId: string;
  /** The stamp's issue year, or null — which skips the period bucket. */
  issuedYear: number | null;
  /** The catalogue the stamp's catalogue value is read in (#1828), or null — which skips the
   * catalogue bucket and its manual factor. */
  catalogNameId: string | null;
}

/** Which bucket a ratio was resolved from. Ordered most specific first. Two are not buckets at all
 * but a figure the collector stated: `catalogue-factor` is the catalogue's manual factor (#1828), and
 * `fallback` the configured `bidFallbackPercent` (#508), consulted only while nothing has been
 * learned. Neither carries evidence. */
export type RatioBucketLevel =
  | "area-condition-period"
  | "area-condition"
  | "area"
  | "catalogue"
  | "catalogue-factor"
  | "collection"
  | "fallback";

/** True for the two rungs that are a stated figure rather than a median of recorded results — the
 * ones every surface marks as *not evidence*. */
export function isStatedRatio(level: RatioBucketLevel): boolean {
  return level === "catalogue-factor" || level === "fallback";
}

/** A resolved ratio and the evidence #511 renders beside it. Naming the bucket is what makes a
 * learned ratio arguable rather than magic: *"55% — Polska Ludowa, MNH, 1945–1949, n = 6"* can be
 * disagreed with; *"55%"* cannot. */
export interface ResolvedRatio {
  /** Unitless: multiply a catalogue value by this. */
  ratio: number;
  level: RatioBucketLevel;
  /** Observations behind the median, **after** the split-lot dedup. Zero at the two stated rungs. */
  n: number;
  /** Those observations themselves, in the order they were read — what a caller expands the figure
   * into (#602). The bucket, not the key, is an estimated cell's evidence: there is nothing else,
   * since a cell that has datapoints of its own is a *measurement* and never estimated. Empty at
   * the two stated rungs, where the figure is policy rather than evidence and there is nothing to
   * show. */
  observations: RatioObservation[];
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
function ratiosOf(observations: RatioObservation[]): RatioObservation[] {
  const out: RatioObservation[] = [];
  const seenLots = new Set<string>();
  for (const observation of observations) {
    if (observation.split && observation.source.kind === "lot") {
      if (seenLots.has(observation.source.lotId)) continue;
      seenLots.add(observation.source.lotId);
    }
    out.push(observation);
  }
  return out;
}

/** True when a manual factor can be applied: a positive, finite *catalogue ÷ realised*. */
export function isUsableFactor(factor: number | null): factor is number {
  return factor !== null && Number.isFinite(factor) && factor > 0;
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
 * bucket — not even the whole collection's — holds {@link MIN_RATIO_SAMPLE} ratios, and the
 * subject's catalogue has no manual factor. It defaults to 100 there, so until anything has been
 * learned a catalogue-anchored figure is exactly what #370's catalogue quick fill already writes and
 * nothing silently changes meaning.
 *
 * `catalogueFactor` is the subject's catalogue's manual factor (#1828), *catalogue ÷ realised* as
 * the collector typed it, or null for none; it is applied as its inverse.
 *
 * `observations` is every ratio the collection has recorded, unfiltered: each bucket is a narrowing
 * of it, and the broadest one is the whole list.
 */
export function resolveRealizationRatio(
  subject: RatioSubject,
  observations: RatioObservation[],
  fallbackPercent: number,
  catalogueFactor: number | null = null
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

  const inCatalogue =
    subject.catalogNameId === null
      ? null
      : usable.filter((o) => o.catalogNameId === subject.catalogNameId);

  const ladder: (
    | { level: RatioBucketLevel; observations: RatioObservation[] | null }
    | { level: "catalogue-factor" }
  )[] = [
    { level: "area-condition-period", observations: inPeriod },
    { level: "area-condition", observations: inAreaCondition },
    { level: "area", observations: inArea },
    { level: "catalogue", observations: inCatalogue },
    { level: "catalogue-factor" },
    { level: "collection", observations: usable },
  ];

  for (const rung of ladder) {
    if (!("observations" in rung)) {
      // A factor belongs to a catalogue, so a subject read in none has none to apply.
      if (subject.catalogNameId === null || !isUsableFactor(catalogueFactor)) continue;
      return {
        ratio: 1 / catalogueFactor,
        level: "catalogue-factor",
        n: 0,
        observations: [],
        fromYear: null,
        toYear: null,
      };
    }
    if (rung.observations === null) continue;
    const counted = ratiosOf(rung.observations);
    if (counted.length < MIN_RATIO_SAMPLE) continue;
    return {
      ratio: medianOf(counted.map((o) => o.ratio)),
      level: rung.level,
      n: counted.length,
      observations: counted,
      fromYear: rung.level === "area-condition-period" ? fromYear : null,
      toYear: rung.level === "area-condition-period" ? toYear : null,
    };
  }

  return {
    ratio: fallbackPercent / 100,
    level: "fallback",
    n: 0,
    observations: [],
    fromYear: null,
    toYear: null,
  };
}

/**
 * What one catalogue's own results say on their own (#1828) — the catalogue bucket's median over
 * every usable ratio read in it, deduplicated as the bucket is, **with no minimum sample**: the
 * catalogue settings show it beside the manual factor with its `n`, so the collector can see when
 * the data has overtaken the guess, and a figure of one result is still a fact worth seeing there.
 * Whether the ladder would *use* it is {@link MIN_RATIO_SAMPLE}'s question, not this one's.
 */
export function learnedCatalogueRatio(
  catalogNameId: string,
  observations: RatioObservation[]
): { ratio: number | null; n: number } {
  const counted = ratiosOf(
    observations.filter((o) => isUsableRatio(o.ratio) && o.catalogNameId === catalogNameId)
  );
  return {
    ratio: counted.length === 0 ? null : medianOf(counted.map((o) => o.ratio)),
    n: counted.length,
  };
}

/** The names a bucket is stated with. Resolved by the domain layer, since only it knows what an
 * area and a condition are called. */
export interface RatioBucketNames {
  areaName: string | null;
  conditionName: string | null;
  /** The subject's catalogue as it is named elsewhere — `Michel / Online` (#1828). */
  catalogueName?: string | null;
}

/** The largest factor the column holds (`Decimal(6, 2)`). */
export const MAX_CATALOGUE_FACTOR = 9999.99;

/**
 * A manual factor as typed into the catalogue settings (#1828): blank is *none* (null), a decimal
 * comma is accepted beside a point, and anything that is not a positive number the column can hold
 * is `"invalid"` — never silently clamped, since a factor is a claim the collector is making.
 * Rounded to the column's two places.
 */
export function parseCatalogueFactor(raw: string): number | null | "invalid" {
  const trimmed = raw.trim();
  if (trimmed === "") return null;
  if (!/^\d+([.,]\d+)?$/.test(trimmed)) return "invalid";
  const value = Math.round(Number(trimmed.replace(",", ".")) * 100) / 100;
  if (!(value > 0) || value > MAX_CATALOGUE_FACTOR) return "invalid";
  return value;
}

/** A manual factor as the collector typed it: `10`, `2.5` — never `10.00`. */
export function formatCatalogueFactor(factor: number): string {
  return String(Math.round(factor * 100) / 100);
}

/**
 * What a bucket is called on screen — `Polska Ludowa, MNH, 1945–1949`.
 *
 * A name a level needs but that the caller could not resolve is simply left out rather than
 * rendered as a blank: the level is still the honest answer to "where did this come from".
 */
export function ratioBucketLabel(resolved: ResolvedRatio, names: RatioBucketNames): string {
  const catalogue = names.catalogueName ?? null;
  // The two catalogue rungs say which catalogue, and the factor says it is the collector's own — a
  // stated figure printed as though it were learned is exactly what the ladder must never do.
  if (resolved.level === "catalogue") {
    return catalogue ? `${catalogue} results` : "Results in this catalogue";
  }
  if (resolved.level === "catalogue-factor") {
    const factor = `your factor, catalogue ÷ ${formatCatalogueFactor(1 / resolved.ratio)}`;
    return catalogue ? `${catalogue} — ${factor}` : `This catalogue — ${factor}`;
  }
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
