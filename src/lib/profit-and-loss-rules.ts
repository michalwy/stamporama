// **The profit and loss screen's arithmetic** (#1305). Pure — no Prisma, no `server-only` — so the
// breakdowns are unit-tested without a database and the client can import the wording beside them.
//
// Nothing here computes a sale's profit: that is `sale-profit.ts`, and each sale arrives with the
// figure its own screen shows (#168). What this module adds is how those figures are **grouped** —
// by month, by year, by platform — and the one line no sale carries: the **write-off**, the cost
// basis of copies disposed of as lost, damaged or other (#394/#396), which had no proceeds.
//
// The rules it keeps:
//
//   - A group's sales figure is `sumProfitFigures` over its sales, so every breakdown adds up the
//     same way the Overview tile does, and a copy left out of a sale stays counted by why.
//   - A write-off falls into the period its disposal was **recorded** in, and has no platform.
//   - A write-off copy whose cost is pending or unrecorded adds nothing to the loss and is counted
//     apart — the same rule as a sold copy, never read as zero.
//   - The **result** is the sales profit less the write-off cost, over what could be counted. It is
//     stated as missing only when nothing at all could be counted and something was left out.
//   - Months and years are UTC calendar buckets — a sale's date is a calendar date, and the growth
//     series on the Overview buckets the same way.

import { resolveCostBasis, type CostBasisInput } from "./cost-basis";
import { leftOutTotal, sumProfitFigures, type ProfitFigures } from "./sale-profit";

function toCents(amount: number | string): number {
  return Math.round(Number(amount) * 100);
}

function fromCents(cents: number): string {
  // Never a negative zero: it is not a quantity (see `summary-figure.ts`).
  return (cents === 0 ? 0 : cents / 100).toFixed(2);
}

// ── Date range ───────────────────────────────────────────────────────────────

/** An inclusive calendar-date range, either end open. `YYYY-MM-DD`. */
export interface DateRange {
  from: string | null;
  to: string | null;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/** A `YYYY-MM-DD` that names a real calendar day, or null. Untrusted input (a URL) reads through
 * this, and a malformed end is dropped rather than refused — a stale link then shows more, not an
 * error. */
export function parseIsoDate(value: string | null | undefined): string | null {
  if (!value || !ISO_DATE.test(value)) return null;
  const d = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value ? value : null;
}

export function parseDateRange(from: string | null | undefined, to: string | null | undefined): DateRange {
  return { from: parseIsoDate(from), to: parseIsoDate(to) };
}

/** The range as instants: `gte` the first day's midnight, `lt` the midnight after the last day, so
 * a timestamp recorded any time on the last day is inside it. UTC, as every bucket here is. */
export function dateRangeBounds(range: DateRange): { gte?: Date; lt?: Date } {
  const bounds: { gte?: Date; lt?: Date } = {};
  if (range.from) bounds.gte = new Date(`${range.from}T00:00:00.000Z`);
  if (range.to) {
    const end = new Date(`${range.to}T00:00:00.000Z`);
    end.setUTCDate(end.getUTCDate() + 1);
    bounds.lt = end;
  }
  return bounds;
}

// ── Periods ──────────────────────────────────────────────────────────────────

export const PERIOD_GRANULARITIES = ["month", "year"] as const;
export type PeriodGranularity = (typeof PERIOD_GRANULARITIES)[number];

export function isPeriodGranularity(value: string | null | undefined): value is PeriodGranularity {
  return !!value && (PERIOD_GRANULARITIES as readonly string[]).includes(value);
}

/** The UTC bucket a date falls into: `2026-03` for a month, `2026` for a year. Sortable as text. */
export function periodKey(date: Date | string, granularity: PeriodGranularity): string {
  const iso = new Date(date).toISOString();
  return granularity === "month" ? iso.slice(0, 7) : iso.slice(0, 4);
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

/** `March 2026` for a month key, the year itself for a year key. */
export function periodLabel(key: string): string {
  if (key.length === 4) return key;
  return `${MONTHS[Number(key.slice(5, 7)) - 1]} ${key.slice(0, 4)}`;
}

// ── Write-offs ───────────────────────────────────────────────────────────────

/** One disposed copy as the write-off reads it: when it was recorded gone, and its cost basis. */
export interface WriteOffCopy extends CostBasisInput {
  disposedAt: Date | string;
}

/** The loss on copies that left without proceeds, base currency. */
export interface WriteOffFigures {
  /** Every disposed copy in scope. */
  copyCount: number;
  /** …of which have a known cost basis and are inside {@link cost}. */
  countedCount: number;
  costPending: number;
  noCost: number;
  /** From an opening balance's lot with no opening value (#1324) — no loss to state. */
  noOpeningValue: number;
  /** Σ known cost basis, 2-dp string. A loss, stated positive. */
  cost: string;
}

export function summarizeWriteOffs(copies: readonly CostBasisInput[]): WriteOffFigures {
  let cents = 0;
  let countedCount = 0;
  let costPending = 0;
  let noCost = 0;
  let noOpeningValue = 0;
  for (const copy of copies) {
    const state = resolveCostBasis(copy);
    if (state.state === "known") {
      countedCount++;
      cents += toCents(state.amount);
    } else if (state.state === "pending") costPending++;
    else if (state.reason === "no_opening_value") noOpeningValue++;
    else noCost++;
  }
  return {
    copyCount: copies.length,
    countedCount,
    costPending,
    noCost,
    noOpeningValue,
    cost: fromCents(cents),
  };
}

/** The write-off's uncounted copies as short phrases, zeros dropped — `describeLeftOut`'s wording. */
export function describeWriteOffLeftOut(writeOff: WriteOffFigures): string[] {
  const parts: string[] = [];
  if (writeOff.costPending > 0) parts.push(`${writeOff.costPending} with cost pending`);
  if (writeOff.noCost > 0) parts.push(`${writeOff.noCost} with no cost recorded`);
  if (writeOff.noOpeningValue > 0) {
    parts.push(`${writeOff.noOpeningValue} from an opening balance with no value`);
  }
  return parts;
}

// ── Result ───────────────────────────────────────────────────────────────────

/** One sale as the breakdowns read it: its date, platform and its own profit figure. */
export interface SaleFigureInput {
  soldAt: Date | string;
  platformId: string;
  platformName: string;
  profit: ProfitFigures;
}

/** Sales and write-offs over one scope, and what they come to together. */
export interface ResultFigures {
  saleCount: number;
  sales: ProfitFigures;
  writeOff: WriteOffFigures;
  /** Sales profit less write-off cost, over what was counted. Null only when nothing could be
   * counted on either side and something was left out — zero would claim a figure then. */
  result: string | null;
}

function resultOf(sales: readonly SaleFigureInput[], writeOffs: readonly CostBasisInput[]): ResultFigures {
  const salesFigures = sumProfitFigures(sales.map((s) => s.profit));
  const writeOff = summarizeWriteOffs(writeOffs);
  const nothingCounted =
    salesFigures.countedCount === 0 &&
    writeOff.countedCount === 0 &&
    leftOutTotal(salesFigures.leftOut) +
      writeOff.costPending +
      writeOff.noCost +
      writeOff.noOpeningValue >
      0;
  return {
    saleCount: sales.length,
    sales: salesFigures,
    writeOff,
    result: nothingCounted
      ? null
      : fromCents(toCents(salesFigures.profit ?? 0) - toCents(writeOff.cost)),
  };
}

export interface PeriodResult extends ResultFigures {
  key: string;
  label: string;
}

export interface PlatformResult {
  platformId: string;
  platformName: string;
  saleCount: number;
  sales: ProfitFigures;
}

export interface ProfitAndLossBreakdown {
  total: ResultFigures;
  /** Every period holding a sale or a write-off, oldest first. */
  periods: PeriodResult[];
  /** Every platform with a sale in scope, by name. Write-offs have no platform and are the
   * total's own line. */
  platforms: PlatformResult[];
}

/** The screen's three readings of one scope. See the module header for the rules. */
export function buildProfitAndLoss(
  sales: readonly SaleFigureInput[],
  writeOffs: readonly WriteOffCopy[],
  granularity: PeriodGranularity
): ProfitAndLossBreakdown {
  const salesByPeriod = new Map<string, SaleFigureInput[]>();
  const writeOffsByPeriod = new Map<string, WriteOffCopy[]>();
  for (const sale of sales) {
    const key = periodKey(sale.soldAt, granularity);
    salesByPeriod.set(key, [...(salesByPeriod.get(key) ?? []), sale]);
  }
  for (const copy of writeOffs) {
    const key = periodKey(copy.disposedAt, granularity);
    writeOffsByPeriod.set(key, [...(writeOffsByPeriod.get(key) ?? []), copy]);
  }
  const keys = [...new Set([...salesByPeriod.keys(), ...writeOffsByPeriod.keys()])].sort();

  const byPlatform = new Map<string, SaleFigureInput[]>();
  for (const sale of sales) {
    byPlatform.set(sale.platformId, [...(byPlatform.get(sale.platformId) ?? []), sale]);
  }
  const platforms = [...byPlatform.values()]
    .map((group) => ({
      platformId: group[0].platformId,
      platformName: group[0].platformName,
      saleCount: group.length,
      sales: sumProfitFigures(group.map((s) => s.profit)),
    }))
    .sort((a, b) => a.platformName.localeCompare(b.platformName));

  return {
    total: resultOf(sales, writeOffs),
    periods: keys.map((key) => ({
      key,
      label: periodLabel(key),
      ...resultOf(salesByPeriod.get(key) ?? [], writeOffsByPeriod.get(key) ?? []),
    })),
    platforms,
  };
}
