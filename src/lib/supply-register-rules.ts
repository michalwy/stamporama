// The register of packing-supply movements (#2196, ADR-0068): every unit that came in on a purchase
// order and every unit that went out — on a sale, or without one (#1900) — for every supply, as one
// list. Pure — no Prisma, no `server-only` — so the Supplies screen filters, totals and groups the
// stock it already holds without asking the server again, and the rules are unit-tested.
//
// It replaced the *Used outside sales* table (#1900): narrowed to that type and grouped by month,
// the register states the same figures, each use at its units' batch costs (`supplyLineCost`) and a
// period adding its uses up in cents, as a sale adds its lines.
//
// Its inputs are structural — the shapes `getSuppliesStock` returns — rather than imported from
// `packing-supplies.ts`, which is server-only.

import { periodKey, periodLabel } from "./profit-and-loss-rules";
import type { SuppliesCost } from "./supply-stock";

/** What a movement is: a purchase line that brought a batch in, or a use that took units out. */
export type SupplyMovementKind = "bought" | "sale" | "own";

export const SUPPLY_MOVEMENT_KINDS: readonly SupplyMovementKind[] = ["bought", "sale", "own"];

export const SUPPLY_MOVEMENT_LABEL: Record<SupplyMovementKind, string> = {
  bought: "Bought",
  sale: "Used on a sale",
  own: "Used outside sales",
};

export function isSupplyMovementKind(value: string): value is SupplyMovementKind {
  return (SUPPLY_MOVEMENT_KINDS as readonly string[]).includes(value);
}

/** One supply as the register reads it — `SupplyStockData`'s shape, what it needs of it. */
export interface RegisterSupplyInput {
  id: string;
  name: string;
  batches: readonly {
    id: string;
    purchase: { id: string; purchaseNo: number; kind: string; name: string | null; purchasedAt: string };
    quantity: number;
    recordedAt: string;
    /** 4 dp, base currency; null without a rate. */
    unitCostBase: string | null;
    /** 2 dp, base currency; null without a rate. */
    costBase: string | null;
  }[];
  history: readonly (
    | (SupplyUseCostInput & {
        kind: "sale";
        id: string;
        usedOn: string;
        recordedAt: string;
        quantity: number;
        sale: { id: string; saleNo: number; platformName: string; buyerName: string | null };
      })
    | (SupplyUseCostInput & {
        kind: "own";
        id: string;
        usedOn: string;
        recordedAt: string;
        quantity: number;
        note: string | null;
      })
  )[];
}

interface SupplyUseCostInput {
  /** 2 dp, base currency. */
  costBase: string;
  shortUnits: number;
  unratedUnits: number;
}

/** Where a movement came from or went to — the register's *Document* column. */
export type SupplyMovementDocument =
  | {
      kind: "purchase";
      id: string;
      purchaseNo: number;
      /** `purchase` or `opening_balance`. */
      purchaseKind: string;
      /** The supplier or platform, or an opening balance's title. */
      name: string | null;
    }
  | { kind: "sale"; id: string; saleNo: number; platformName: string; buyerName: string | null }
  | { kind: "own"; note: string | null };

/** One row of the register. Its cost is a `SuppliesCost`, so one that leaves units out — a use not
 *  in stock, a batch bought without a rate — says so as everywhere else. */
export interface SupplyMovement extends SuppliesCost {
  /** `bought:<line>`, `sale:<sale line>` or `own:<use>` — unique across the register. */
  key: string;
  kind: SupplyMovementKind;
  /** The purchase line, the sale's supply line or the use. */
  id: string;
  supplyId: string;
  supplyName: string;
  /** yyyy-mm-dd: the purchase's date, the sale's, or the use's. */
  date: string;
  /** ISO: the order of two movements of one day. */
  recordedAt: string;
  /** Signed: + in, − out. */
  units: number;
  /** One unit's cost, 4 dp, base currency; null when it cannot be stated whole. */
  unitCostBase: string | null;
  document: SupplyMovementDocument;
}

function toCents(amount: number): number {
  return Math.round(amount * 100);
}

/** One unit's cost of a use, where every unit has one; a use that leaves some out states none. */
function perUnitCostOfUse(cost: SuppliesCost, quantity: number): string | null {
  if (quantity <= 0 || cost.shortUnits > 0 || cost.unratedUnits > 0) return null;
  return (Math.round((cost.costBase / quantity) * 10000) / 10000).toFixed(4);
}

/** Newest first; two of one day by when they were written, later first. */
function newestFirst(a: SupplyMovement, b: SupplyMovement): number {
  return b.date.localeCompare(a.date) || b.recordedAt.localeCompare(a.recordedAt) || b.key.localeCompare(a.key);
}

/** Every movement of every supply, newest first. */
export function supplyMovements(supplies: readonly RegisterSupplyInput[]): SupplyMovement[] {
  const out: SupplyMovement[] = [];
  for (const supply of supplies) {
    for (const batch of supply.batches) {
      const costBase = batch.costBase == null ? null : Number(batch.costBase);
      out.push({
        key: `bought:${batch.id}`,
        kind: "bought",
        id: batch.id,
        supplyId: supply.id,
        supplyName: supply.name,
        date: batch.purchase.purchasedAt,
        recordedAt: batch.recordedAt,
        units: batch.quantity,
        unitCostBase: batch.unitCostBase,
        costBase: costBase ?? 0,
        shortUnits: 0,
        unratedUnits: costBase == null ? batch.quantity : 0,
        document: {
          kind: "purchase",
          id: batch.purchase.id,
          purchaseNo: batch.purchase.purchaseNo,
          purchaseKind: batch.purchase.kind,
          name: batch.purchase.name,
        },
      });
    }
    for (const entry of supply.history) {
      const cost: SuppliesCost = {
        costBase: Number(entry.costBase),
        shortUnits: entry.shortUnits,
        unratedUnits: entry.unratedUnits,
      };
      out.push({
        key: `${entry.kind}:${entry.id}`,
        kind: entry.kind,
        id: entry.id,
        supplyId: supply.id,
        supplyName: supply.name,
        date: entry.usedOn,
        recordedAt: entry.recordedAt,
        units: -entry.quantity,
        unitCostBase: perUnitCostOfUse(cost, entry.quantity),
        ...cost,
        document:
          entry.kind === "sale"
            ? { kind: "sale", ...entry.sale }
            : { kind: "own", note: entry.note },
      });
    }
  }
  return out.sort(newestFirst);
}

/** What the register is narrowed to. An empty set, or a missing date, narrows nothing. */
export interface SupplyRegisterFilter {
  supplyIds: readonly string[];
  kinds: readonly SupplyMovementKind[];
  /** yyyy-mm-dd, inclusive. */
  from?: string;
  /** yyyy-mm-dd, inclusive. */
  to?: string;
  /** Matched, without regard to case, against the document, the supplier, the buyer and the note. */
  text?: string;
}

/** The words a movement is found by: its document as the row names it, the supplier or platform,
 *  the buyer, the note. */
function searchText(m: SupplyMovement): string {
  const d = m.document;
  switch (d.kind) {
    case "purchase":
      return [`#${d.purchaseNo}`, d.name ?? "", d.purchaseKind === "opening_balance" ? "opening balance" : ""].join(" ");
    case "sale":
      return [`sale #${d.saleNo}`, d.platformName, d.buyerName ?? ""].join(" ");
    case "own":
      return ["outside sales", d.note ?? ""].join(" ");
  }
}

export function filterSupplyMovements(
  movements: readonly SupplyMovement[],
  filter: SupplyRegisterFilter
): SupplyMovement[] {
  const supplies = new Set(filter.supplyIds);
  const kinds = new Set(filter.kinds);
  const needle = filter.text?.trim().toLowerCase() ?? "";
  return movements.filter(
    (m) =>
      (supplies.size === 0 || supplies.has(m.supplyId)) &&
      (kinds.size === 0 || kinds.has(m.kind)) &&
      (!filter.from || m.date >= filter.from) &&
      (!filter.to || m.date <= filter.to) &&
      (!needle || searchText(m).toLowerCase().includes(needle))
  );
}

/**
 * The stock after each movement of **one** supply, by key — what lets the on-hand figure be traced
 * row by row. Counted over all of the supply's movements, oldest first, so a row keeps its figure
 * whatever else the register is narrowed by. Units a sale used that were not in stock take it below
 * zero: that is what the supply owes until a purchase covers it, and the last figure is the on-hand
 * quantity less what is owed.
 */
export function runningSupplyStock(
  movements: readonly SupplyMovement[],
  supplyId: string
): Map<string, number> {
  const own = movements.filter((m) => m.supplyId === supplyId).sort((a, b) => newestFirst(b, a));
  const out = new Map<string, number>();
  let stock = 0;
  for (const m of own) {
    stock += m.units;
    out.set(m.key, stock);
  }
  return out;
}

/** What a set of movements adds up to: units and their cost in, and out, each summed in cents. */
export interface SupplyMovementTotals {
  movements: number;
  unitsIn: number;
  unitsOut: number;
  costIn: SuppliesCost;
  costOut: SuppliesCost;
}

export function supplyMovementTotals(movements: readonly SupplyMovement[]): SupplyMovementTotals {
  const side = () => ({ cents: 0, shortUnits: 0, unratedUnits: 0 });
  const inSide = side();
  const outSide = side();
  let unitsIn = 0;
  let unitsOut = 0;
  for (const m of movements) {
    const s = m.units >= 0 ? inSide : outSide;
    if (m.units >= 0) unitsIn += m.units;
    else unitsOut -= m.units;
    s.cents += toCents(m.costBase);
    s.shortUnits += m.shortUnits;
    s.unratedUnits += m.unratedUnits;
  }
  const cost = (s: ReturnType<typeof side>): SuppliesCost => ({
    costBase: s.cents / 100,
    shortUnits: s.shortUnits,
    unratedUnits: s.unratedUnits,
  });
  return { movements: movements.length, unitsIn, unitsOut, costIn: cost(inSide), costOut: cost(outSide) };
}

/** One month of the register, with its own totals. */
export interface SupplyMovementMonth {
  /** `2026-03` — sortable as text. */
  key: string;
  /** `March 2026`. */
  label: string;
  movements: SupplyMovement[];
  totals: SupplyMovementTotals;
}

/** The movements grouped by month, newest month first and each month's rows in the order given. A
 *  month with no movement is not listed. */
export function supplyMovementsByMonth(movements: readonly SupplyMovement[]): SupplyMovementMonth[] {
  const byKey = new Map<string, SupplyMovement[]>();
  for (const m of movements) {
    const key = periodKey(`${m.date}T00:00:00.000Z`, "month");
    const list = byKey.get(key) ?? [];
    list.push(m);
    byKey.set(key, list);
  }
  return [...byKey.keys()]
    .sort()
    .reverse()
    .map((key) => {
      const list = byKey.get(key)!;
      return { key, label: periodLabel(key), movements: list, totals: supplyMovementTotals(list) };
    });
}
