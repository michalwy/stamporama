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
// prefilled from the carrier service it is sent as) **plus what its supply lines cost**, summed
// by the app. Each line names a supply and how many units the parcel used; the units are taken from
// stock FIFO when the line is written (`settleSupplies`), and each costs the unit cost of the batch it
// came from — derived, as the batch's own is, so the sale's figure settles when the purchase does.
//
// **A line added or changed by hand takes no more than is on hand** (#2229): the parcel was packed
// from the shelf, so a supply that is not in stock cannot have gone into it. The write and the
// settling run in one transaction, and a line the stock could not cover rolls the whole write back —
// the rule own uses already follow (#1900). A line can still be **short** — uncosted, the total
// marked incomplete, until a purchase covers it — when it was filled in from a carrier service's
// usual supplies (#1899), written before #2229, or left so by a batch lowered or deleted later. A
// sale recorded before #1898 has no lines and keeps its typed amount as the whole of its shipping.
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

/** Thrown when a line added or changed by hand asks for more than the supply has on hand (#2229). */
export class SaleSupplyShortError extends Error {
  constructor(
    readonly supplyName: string,
    /** What the line could have: the supply's units on hand plus those the line already held. */
    readonly available: number
  ) {
    super(
      available === 0
        ? `No “${supplyName}” on hand — record the purchase that brought them in first.`
        : `Only ${available} “${supplyName}” on hand.`
    );
    this.name = "SaleSupplyShortError";
  }
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

/** Units a line asked for that it does not hold. */
async function shortOf(
  tx: DbTransaction,
  lineId: string
): Promise<{ short: number; held: number; name: string }> {
  const line = await tx.saleSupplyLine.findUniqueOrThrow({
    where: { id: lineId },
    select: { quantity: true, supply: { select: { name: true } }, uses: { select: { quantity: true } } },
  });
  const held = line.uses.reduce((sum, u) => sum + u.quantity, 0);
  return { short: Math.max(0, line.quantity - held), held, name: line.supply.name };
}

/** After settling: the write left the line no shorter than it was, or it is refused (#2229). A new
 * line, or one moved to another supply, was short of nothing. The units a short line does hold are
 * all the stock had — the rule takes whatever is left before leaving a line short — so they are what
 * it could have.
 *
 * Only a write that asks for *more* than stock has is refused: a line already short — filled in from
 * a service's usual supplies, written before #2229, or left so by a lowered batch — can still be kept
 * or lowered, and can always be removed. */
async function assertCovered(tx: DbTransaction, lineId: string, shortBefore: number): Promise<void> {
  const after = await shortOf(tx, lineId);
  if (after.short > shortBefore) throw new SaleSupplyShortError(after.name, after.held);
}

/** Add a supply line to a sale, taking its units from stock FIFO; refused if stock does not have
 * them (#2229). Returns its id. */
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
    await assertCovered(tx, created.id, 0);
    return created.id;
  });
}

/** Restate a line's supply and quantity. Fewer units give back the ones taken last; more take from
 * stock FIFO, and are refused if stock does not have them (#2229); another supply gives back every
 * unit and takes the new one's. */
export async function updateSaleSupplyLine(
  ownerId: string,
  lineId: string,
  input: SaleSupplyLineInput
): Promise<void> {
  const { collectionId, supplyId: before } = await assertLine(ownerId, lineId);
  await assertSupplyInCollection(collectionId, input.supplyId);
  const quantity = quantityOf(input);
  await prisma.$transaction(async (tx) => {
    const shortBefore = before === input.supplyId ? (await shortOf(tx, lineId)).short : 0;
    if (before !== input.supplyId) await tx.saleSupplyUse.deleteMany({ where: { lineId } });
    await tx.saleSupplyLine.update({
      where: { id: lineId },
      data: { supplyId: input.supplyId, quantity },
    });
    await settleSupplies(tx, [before, input.supplyId]);
    await assertCovered(tx, lineId, shortBefore);
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

// ── A carrier service's usual supplies (#1899) ──────────────────────────────────────────────

/**
 * Apply a change of the carrier service a sale's parcel goes by to its supply lines (ADR-0068 §8,
 * ADR-0069 §4): the lines that still match the old service's list go, the new one's list is filled
 * in, and lines the collector changed by hand stay (`changeServiceSupplies`). The service is the
 * sale's *Sent as* (#1923) — its own when it names one, else its shipping option's — so choosing an
 * option and changing *Sent as* swap by the same rule. A sale being recorded passes `before` null
 * and simply gets the list. A no-op when the service did not change — re-saving the same one must not
 * bring back a default the collector removed.
 *
 * Runs inside the caller's transaction, after the sale's own write, and settles every supply it
 * touched there, so the new lines take their units from stock FIFO as a typed line would.
 */
export async function applyServiceSupplies(
  tx: DbTransaction,
  saleId: string,
  before: string | null,
  after: string | null
): Promise<void> {
  if (before === after) return;
  // Each list is read as it stands now: lines filled from a list since changed simply read as the
  // collector's and stay.
  const listOf = async (serviceId: string | null) => {
    if (!serviceId) return [];
    return tx.carrierServiceSupply.findMany({
      where: { serviceId },
      select: { supplyId: true, quantity: true },
    });
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
