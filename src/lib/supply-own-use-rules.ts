// What packing supplies used **without a sale** cost, by period (#1900, ADR-0068 §9). Pure — no
// Prisma, no `server-only` — so the Supplies screen's grouping is unit-tested and the client can
// group the uses it already holds without asking the server again.
//
// An own use — transport cards the collector keeps stamps in — is charged to no sale and no copy, so
// the Supplies screen states it as a cost of its own. Its figure is its units at their batches' unit
// costs (`supplyLineCost`), and a period adds its uses up in cents, as a sale adds its lines.

import { periodKey, periodLabel, type PeriodGranularity } from "./profit-and-loss-rules";
import type { SuppliesCost } from "./supply-stock";

/** One own use as the grouping needs it: the day, the units and what they cost. */
export interface OwnUseCostEntry extends SuppliesCost {
  /** yyyy-mm-dd. */
  usedOn: string;
  quantity: number;
}

/** One period's own uses, summed. */
export interface OwnUsePeriod extends SuppliesCost {
  /** `2026-03` or `2026` — sortable as text. */
  key: string;
  /** `March 2026` or `2026`. */
  label: string;
  /** Uses in the period. */
  uses: number;
  /** Units taken in the period. */
  quantity: number;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

function sum(entries: readonly OwnUseCostEntry[]): SuppliesCost & { quantity: number } {
  let cents = 0;
  let quantity = 0;
  let shortUnits = 0;
  let unratedUnits = 0;
  for (const e of entries) {
    cents += toCents(e.costBase);
    quantity += e.quantity;
    shortUnits += e.shortUnits;
    unratedUnits += e.unratedUnits;
  }
  return { costBase: cents / 100, quantity, shortUnits, unratedUnits };
}

/** Own uses grouped by month or year, oldest period first — the order the P&L screen reads in. A
 * period with no use is not listed. */
export function ownUseCostByPeriod(
  entries: readonly OwnUseCostEntry[],
  granularity: PeriodGranularity
): OwnUsePeriod[] {
  const byKey = new Map<string, OwnUseCostEntry[]>();
  for (const e of entries) {
    const key = periodKey(`${e.usedOn}T00:00:00.000Z`, granularity);
    const list = byKey.get(key) ?? [];
    list.push(e);
    byKey.set(key, list);
  }
  return [...byKey.keys()].sort().map((key) => {
    const list = byKey.get(key)!;
    return { key, label: periodLabel(key), uses: list.length, ...sum(list) };
  });
}

/** Every own use summed — the total line under the periods. */
export function ownUseCostTotal(entries: readonly OwnUseCostEntry[]): SuppliesCost & { quantity: number } {
  return sum(entries);
}
