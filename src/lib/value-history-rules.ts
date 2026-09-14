/**
 * The pure half of the Overview's value-over-time chart (#653; ADR-0053): the stored daily snapshots
 * (#652) turned into the series the chart draws — which days it can draw, where the series breaks,
 * which areas split it, and the value axis. The read is `getOverviewValueHistory` in `overview.ts`.
 *
 * Nothing here values anything. Every figure is a stored row as it was written on its day; the
 * chart never re-derives a past point from current state (ADR-0053's whole reason to record).
 */

/** One stored collection row, as the read hands it over — money as 2 dp strings. */
export interface SnapshotRowInput {
  day: Date;
  baseCurrency: string;
  catalogueValue: string;
  acquisitionCost: string;
  marketValue: string;
  marketValuedCount: number;
  copiesHeld: number;
  catalogueUnpricedCount: number;
  catalogueUnconvertibleCount: number;
  costPendingCount: number;
  costNoneCount: number;
  areas: { collectionAreaId: string; catalogueValue: string }[];
}

export interface ValueHistoryPoint {
  /** `YYYY-MM-DD`, the UTC day the row stands for. */
  day: string;
  catalogueValue: string;
  acquisitionCost: string;
  marketValue: string;
  marketValuedCount: number;
  copiesHeld: number;
  unpricedCount: number;
  unconvertibleCount: number;
  costPendingCount: number;
  costNoneCount: number;
  /** Catalogue value of each split area's subtree that day. An area with no row that day (it did
   * not exist yet) is absent, and its line breaks there. */
  areaValues: Record<string, string>;
}

export interface ValueHistoryArea {
  areaId: string;
  name: string;
}

export interface ValueHistory {
  baseCurrency: string;
  /** Oldest first, one per recorded day in the current base currency. Missing days are not filled. */
  points: ValueHistoryPoint[];
  /** Days recorded while the collection had another base currency. Their amounts cannot share an
   * axis with these, and re-converting them at today's rate would be today's claim — so they are
   * left out and counted, never silently dropped. */
  otherCurrencyDays: number;
  /** The top-level areas the chart can split by, in the tree's own order — only those with a
   * non-zero point somewhere, since a line lying on the axis for its whole length says nothing. */
  areas: ValueHistoryArea[];
}

/** Fewer points than this and there is no line to draw — the chart shows its waiting state. */
export const MIN_HISTORY_POINTS = 2;

export function hasEnoughHistory(history: Pick<ValueHistory, "points">): boolean {
  return history.points.length >= MIN_HISTORY_POINTS;
}

/** `YYYY-MM-DD` for a stored `DATE` (UTC midnight). */
export function dayKey(date: Date): string {
  return date.toISOString().slice(0, 10);
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/** Whole UTC days since the epoch for a `YYYY-MM-DD` key — the chart's time axis. */
export function dayNumber(day: string): number {
  return Math.round(Date.parse(`${day}T00:00:00.000Z`) / MS_PER_DAY);
}

/**
 * The chart's series from the stored rows. `rootAreas` are the collection's top-level areas in tree
 * order: the split is by the areas a collection is scanned at, each carrying its whole subtree, and
 * area lines are never stacked — a stamp filed in two areas counts under both (ADR-0053 §3), so they
 * need not add up to the total.
 */
export function buildValueHistory(
  rows: SnapshotRowInput[],
  baseCurrency: string,
  rootAreas: ValueHistoryArea[]
): ValueHistory {
  const rootIds = new Set(rootAreas.map((a) => a.areaId));
  const valued = new Set<string>();
  let otherCurrencyDays = 0;
  const points: ValueHistoryPoint[] = [];

  for (const row of [...rows].sort((a, b) => a.day.getTime() - b.day.getTime())) {
    if (row.baseCurrency !== baseCurrency) {
      otherCurrencyDays += 1;
      continue;
    }
    const areaValues: Record<string, string> = {};
    for (const area of row.areas) {
      if (!rootIds.has(area.collectionAreaId)) continue;
      areaValues[area.collectionAreaId] = area.catalogueValue;
      if (Number(area.catalogueValue) !== 0) valued.add(area.collectionAreaId);
    }
    points.push({
      day: dayKey(row.day),
      catalogueValue: row.catalogueValue,
      acquisitionCost: row.acquisitionCost,
      marketValue: row.marketValue,
      marketValuedCount: row.marketValuedCount,
      copiesHeld: row.copiesHeld,
      unpricedCount: row.catalogueUnpricedCount,
      unconvertibleCount: row.catalogueUnconvertibleCount,
      costPendingCount: row.costPendingCount,
      costNoneCount: row.costNoneCount,
      areaValues,
    });
  }

  return {
    baseCurrency,
    points,
    otherCurrencyDays,
    areas: rootAreas.filter((a) => valued.has(a.areaId)),
  };
}

/**
 * The unbroken stretches of a series, in order: a new run starts wherever a day is missing (the app
 * was down, ADR-0053 §5) or where `has` says the point carries no value for this line. A gap is drawn
 * as a gap — nothing is interpolated across it. A run of one point is still a run; the chart marks it
 * with a dot, since a line of one point is invisible.
 */
export function splitIntoRuns<T extends { day: string }>(
  points: T[],
  has: (point: T) => boolean = () => true
): T[][] {
  const runs: T[][] = [];
  let current: T[] = [];
  let previousDay: number | null = null;
  for (const point of points) {
    if (!has(point)) {
      if (current.length > 0) runs.push(current);
      current = [];
      previousDay = null;
      continue;
    }
    const day = dayNumber(point.day);
    if (previousDay !== null && day - previousDay > 1 && current.length > 0) {
      runs.push(current);
      current = [];
    }
    current.push(point);
    previousDay = day;
  }
  if (current.length > 0) runs.push(current);
  return runs;
}

export interface ValueScale {
  /** The top of the axis — at or above the largest value, on a round step. */
  max: number;
  /** From 0 to `max` inclusive, evenly spaced. */
  ticks: number[];
}

/**
 * A value axis from zero to a round number at or above `maxValue`, in about `targetTicks` steps of
 * 1, 2, 2.5 or 5 × 10ⁿ. Money is never negative on this chart, so the axis always starts at zero —
 * a floor above zero would exaggerate every movement. An all-zero series still gets an axis.
 */
export function valueScale(maxValue: number, targetTicks = 4): ValueScale {
  if (!(maxValue > 0)) return { max: 1, ticks: [0, 1] };
  const rough = maxValue / targetTicks;
  const magnitude = 10 ** Math.floor(Math.log10(rough));
  const step =
    [1, 2, 2.5, 5, 10].map((m) => m * magnitude).find((candidate) => candidate >= rough) ??
    10 * magnitude;
  const count = Math.ceil(maxValue / step - 1e-9);
  const ticks = Array.from({ length: count + 1 }, (_, i) => Number((i * step).toPrecision(12)));
  return { max: ticks[ticks.length - 1], ticks };
}

/**
 * Up to `count` days spread evenly over the series' span for the time axis labels, first and last
 * always included, never the same day twice.
 */
export function dayTicks(firstDay: string, lastDay: string, count = 5): string[] {
  const first = dayNumber(firstDay);
  const last = dayNumber(lastDay);
  const span = last - first;
  if (span <= 0) return [firstDay];
  const steps = Math.min(count - 1, span);
  const out = new Set<number>();
  for (let i = 0; i <= steps; i += 1) out.add(first + Math.round((span * i) / steps));
  return [...out].map((n) => dayKey(new Date(n * MS_PER_DAY)));
}
