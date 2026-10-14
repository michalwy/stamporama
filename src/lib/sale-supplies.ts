import "server-only";
import { prisma, type DbTransaction } from "./db";
import { changeServiceSupplies } from "./service-supplies";
import { canExpressInBase, computeSupplyBatchCost, purchaseCostsOf } from "./purchase-allocation";
import { settleSupplies } from "./supply-settlement";
import {
  saleSuppliesCost,
  supplyLineCost,
  type CostedSupplyLine,
  type SuppliesCost,
} from "./supply-stock";

// Packing supplies used on a sale (#1898, ADR-0068 §7) — the parcel's envelope and transport cards.
//
// A sale's own shipping cost (*my shipping*) is its **postage** (`Sale.shippingCost`, typed or
// prefilled from the shipping option's carrier service) **plus what its supply lines cost**, summed
// by the app. Each line names a supply and how many units the parcel used; the units are taken from
// stock FIFO when the line is written (`settleSupplies`), and each costs the unit cost of the batch it
// came from — derived, as the batch's own is, so the sale's figure settles when the purchase does.
//
// Using more than is on hand is allowed: the line records what it used, holds what stock had, and
// the rest is **short** — uncosted, the total marked incomplete, until a purchase covers it. A sale
// recorded before this has no lines and keeps its typed amount as the whole of its shipping.
//
// All access is collection-owner-scoped; the checks live here, server-side.

// ── Cost ─────────────────────────────────────────────────────────────────────────────────────

/** What every reader of a sale's money selects for its supply lines: each line's units and the
 * batches they came from, with everything the batch's unit cost is derived from — every priced line
 * of its purchase, since its share of the shipping depends on all of them (ADR-0009 §3.1). */
export const SALE_SUPPLY_COST_SELECT = {
  select: {
    id: true,
    quantity: true,
    uses: {
      select: {
        quantity: true,
        batch: {
          select: {
            id: true,
            quantity: true,
            purchase: {
              select: {
                currency: true,
                fxRateToBase: true,
                shippingCost: true,
                lots: { select: { id: true, price: true } },
                expenses: { select: { id: true, price: true } },
                supplyLines: { select: { id: true, price: true } },
              },
            },
          },
        },
      },
    },
  },
} as const;

/** A sale supply line as {@link SALE_SUPPLY_COST_SELECT} loads it. */
export interface SaleSupplyCostRow {
  quantity: number;
  uses: {
    quantity: number;
    batch: {
      id: string;
      quantity: number;
      purchase: {
        currency: string;
        fxRateToBase: unknown;
        shippingCost: unknown;
        lots: readonly { id: string; price: unknown }[];
        expenses: readonly { id: string; price: unknown }[];
        supplyLines: readonly { id: string; price: unknown }[];
      };
    };
  }[];
}

/** A line's units at their batches' unit costs, in the base currency. */
function costedLine(row: SaleSupplyCostRow, baseCurrency: string): CostedSupplyLine {
  return {
    quantity: row.quantity,
    uses: row.uses.map((use) => {
      const p = use.batch.purchase;
      const costs = purchaseCostsOf(p);
      const batch = computeSupplyBatchCost(
        costs,
        use.batch.id,
        canExpressInBase(costs.fxRateToBase, p.currency, baseCurrency)
      );
      return {
        quantity: use.quantity,
        unitCostBase: batch.costBase == null ? null : batch.costBase / use.batch.quantity,
      };
    }),
  };
}

/** One sale supply line's cost. */
export function saleSupplyLineCostOf(row: SaleSupplyCostRow, baseCurrency: string): SuppliesCost {
  return supplyLineCost(costedLine(row, baseCurrency));
}

/** A sale's supplies' cost, from its lines as {@link SALE_SUPPLY_COST_SELECT} loads them. A sale with
 * none costs nothing and leaves nothing out. */
export function saleSuppliesCostOf(
  rows: readonly SaleSupplyCostRow[],
  baseCurrency: string
): SuppliesCost {
  return saleSuppliesCost(rows.map((row) => costedLine(row, baseCurrency)));
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────

export interface SaleSupplyLineInput {
  supplyId: string;
  /** Whole units, at least one. */
  quantity: number;
}

function quantityOf(input: SaleSupplyLineInput): number {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error("A supply line's quantity must be a whole number of at least 1.");
  }
  return input.quantity;
}

/** The sale a line is written onto, proved to be the caller's; returns its collection. */
async function assertSale(ownerId: string, saleId: string): Promise<string> {
  const sale = await prisma.sale.findUnique({
    where: { id: saleId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!sale || sale.collection.ownerId !== ownerId) {
    throw new Error("Sale not found or access denied.");
  }
  return sale.collectionId;
}

/** The line this call is about, proved to be the caller's. */
async function assertLine(
  ownerId: string,
  lineId: string
): Promise<{ collectionId: string; supplyId: string }> {
  const line = await prisma.saleSupplyLine.findUnique({
    where: { id: lineId },
    select: {
      supplyId: true,
      sale: { select: { collectionId: true, collection: { select: { ownerId: true } } } },
    },
  });
  if (!line || line.sale.collection.ownerId !== ownerId) {
    throw new Error("Supply line not found or access denied.");
  }
  return { collectionId: line.sale.collectionId, supplyId: line.supplyId };
}

async function assertSupplyInCollection(collectionId: string, supplyId: string): Promise<void> {
  const supply = await prisma.packingSupply.findFirst({
    where: { id: supplyId, collectionId },
    select: { id: true },
  });
  if (!supply) throw new Error("Packing supply not found in this collection.");
}

/** Add a supply line to a sale, taking its units from stock FIFO. Returns its id. */
export async function createSaleSupplyLine(
  ownerId: string,
  saleId: string,
  input: SaleSupplyLineInput
): Promise<string> {
  const collectionId = await assertSale(ownerId, saleId);
  await assertSupplyInCollection(collectionId, input.supplyId);
  const quantity = quantityOf(input);
  return prisma.$transaction(async (tx) => {
    const created = await tx.saleSupplyLine.create({
      data: { saleId, supplyId: input.supplyId, quantity },
      select: { id: true },
    });
    await settleSupplies(tx, [input.supplyId]);
    return created.id;
  });
}

/** Restate a line's supply and quantity. Fewer units give back the ones taken last; more take from
 * stock FIFO; another supply gives back every unit and takes the new one's. */
export async function updateSaleSupplyLine(
  ownerId: string,
  lineId: string,
  input: SaleSupplyLineInput
): Promise<void> {
  const { collectionId, supplyId: before } = await assertLine(ownerId, lineId);
  await assertSupplyInCollection(collectionId, input.supplyId);
  const quantity = quantityOf(input);
  await prisma.$transaction(async (tx) => {
    if (before !== input.supplyId) await tx.saleSupplyUse.deleteMany({ where: { lineId } });
    await tx.saleSupplyLine.update({
      where: { id: lineId },
      data: { supplyId: input.supplyId, quantity },
    });
    await settleSupplies(tx, [before, input.supplyId]);
  });
}

/** Remove a line: its units go back to the batches they came from, at the costs they were taken at,
 * and cover any other sale still short of them. */
export async function deleteSaleSupplyLine(ownerId: string, lineId: string): Promise<void> {
  const { supplyId } = await assertLine(ownerId, lineId);
  await prisma.$transaction(async (tx) => {
    await tx.saleSupplyLine.delete({ where: { id: lineId } });
    await settleSupplies(tx, [supplyId]);
  });
}

// ── A shipping option's usual supplies (#1899) ──────────────────────────────────────────────

/**
 * Apply a change of a sale's shipping option to its supply lines (ADR-0068 §8, ADR-0069): the lines
 * that still match the list of the old option's carrier service go, the new one's list is filled in,
 * and lines the collector changed by hand stay (`changeServiceSupplies`). A sale being recorded
 * passes `before` null and simply gets the list. A no-op when the option did not change — re-saving
 * the same option must not bring back a default the collector removed. An option linked to no
 * service has no list.
 *
 * Runs inside the caller's transaction, after the sale's own write, and settles every supply it
 * touched there, so the new lines take their units from stock FIFO as a typed line would.
 */
export async function applyOptionSupplies(
  tx: DbTransaction,
  saleId: string,
  before: string | null,
  after: string | null
): Promise<void> {
  if (before === after) return;
  // Each list is read through the option's link as it stands now: a sale stores no service of its
  // own, and lines filled from a list since changed simply read as the collector's and stay.
  const listOf = async (optionId: string | null) => {
    if (!optionId) return [];
    const option = await tx.shippingOption.findUnique({
      where: { id: optionId },
      select: { service: { select: { supplies: { select: { supplyId: true, quantity: true } } } } },
    });
    return option?.service?.supplies ?? [];
  };
  const [lines, beforeList, afterList] = await Promise.all([
    tx.saleSupplyLine.findMany({
      where: { saleId },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, supplyId: true, quantity: true },
    }),
    listOf(before),
    listOf(after),
  ]);
  const { remove, add } = changeServiceSupplies(lines, beforeList, afterList);
  if (remove.length === 0 && add.length === 0) return;
  if (remove.length > 0) await tx.saleSupplyLine.deleteMany({ where: { id: { in: remove } } });
  if (add.length > 0) {
    await tx.saleSupplyLine.createMany({ data: add.map((a) => ({ saleId, ...a })) });
  }
  await settleSupplies(tx, [
    ...lines.filter((l) => remove.includes(l.id)).map((l) => l.supplyId),
    ...add.map((a) => a.supplyId),
  ]);
}
