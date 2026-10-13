import "server-only";
import { Prisma } from "@/generated/prisma/client";
import { prisma } from "./db";
import { roundAmount } from "./decimal-input";
import { intakeDocumentName, type PurchaseKind } from "./purchase-kind";
import {
  canExpressInBase,
  computeSupplyBatchCost,
  purchaseCostsOf,
} from "./purchase-allocation";
import { supplyStock, formatUnitCost } from "./supply-stock";
import { settleSupplies } from "./supply-settlement";

// Packing supplies (#1897, ADR-0068) — envelopes, transport cards and the like: the dictionary, the
// supply lines of purchase orders, and the stock those lines make up.
//
// Three rules carry the module:
//
//  1. **A supply's price is never typed.** The dictionary holds a name and nothing else; what a unit
//     costs follows from the purchase-order lines it was bought on, each line a batch whose unit
//     cost is *(line price + its share of the order's shipping) ÷ quantity* (ADR-0009 §3.1).
//  2. **Stock is costed FIFO** (`supply-stock.ts`): supplies leave oldest batch first, each unit at
//     its own batch's cost.
//  3. **A supply line on an opening balance carries a value too**, and it is required there as on a
//     purchase (the collector's call, 2026-10-14): a batch without a cost would leave every parcel
//     packed from it without one.
//
// All access is collection-owner-scoped; the checks live here, server-side.

/** A supply as the Settings dictionary and the supply-line picker read it. */
export interface PackingSupplyData {
  id: string;
  name: string;
  /** Supply lines that bought it. A supply with any cannot be deleted. */
  lineCount: number;
  /** Sales' supply lines that used it (#1898). A supply with any cannot be deleted either. */
  saleLineCount: number;
}

async function assertCollectionOwner(ownerId: string, collectionId: string): Promise<void> {
  const col = await prisma.collection.findUnique({
    where: { id: collectionId },
    select: { ownerId: true },
  });
  if (!col || col.ownerId !== ownerId) {
    throw new Error("Collection not found or access denied.");
  }
}

async function assertSupplyOwner(ownerId: string, supplyId: string): Promise<string> {
  const supply = await prisma.packingSupply.findUnique({
    where: { id: supplyId },
    select: { collectionId: true },
  });
  if (!supply) throw new Error("Packing supply not found.");
  await assertCollectionOwner(ownerId, supply.collectionId);
  return supply.collectionId;
}

// ── The dictionary ────────────────────────────────────────────────────────────────────────────

/** The collection's supplies, by name — a short list read by looking for a name you know. */
export async function listPackingSupplies(
  ownerId: string,
  collectionId: string
): Promise<PackingSupplyData[]> {
  await assertCollectionOwner(ownerId, collectionId);
  const rows = await prisma.packingSupply.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: { id: true, name: true, _count: { select: { lines: true, saleLines: true } } },
  });
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    lineCount: r._count.lines,
    saleLineCount: r._count.saleLines,
  }));
}

function supplyName(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) throw new Error("A packing supply needs a name.");
  return trimmed;
}

export async function createPackingSupply(
  ownerId: string,
  collectionId: string,
  name: string
): Promise<string> {
  await assertCollectionOwner(ownerId, collectionId);
  const created = await prisma.packingSupply.create({
    data: { collectionId, name: supplyName(name) },
    select: { id: true },
  });
  return created.id;
}

export async function renamePackingSupply(
  ownerId: string,
  supplyId: string,
  name: string
): Promise<void> {
  await assertSupplyOwner(ownerId, supplyId);
  await prisma.packingSupply.update({ where: { id: supplyId }, data: { name: supplyName(name) } });
}

/** Thrown when a supply that was bought, or used on a sale (#1898), is deleted: its batches are what
 * its stock is, and its uses are part of those sales' shipping cost. */
export class PackingSupplyInUseError extends Error {
  constructor(
    readonly lineCount: number,
    readonly saleLineCount: number
  ) {
    super("Packing supply has been bought or used.");
    this.name = "PackingSupplyInUseError";
  }
}

/** Delete a supply nothing has bought or used. The constraints are the backstop; this says why. */
export async function deletePackingSupply(ownerId: string, supplyId: string): Promise<void> {
  await assertSupplyOwner(ownerId, supplyId);
  const [lineCount, saleLineCount] = await Promise.all([
    prisma.purchaseSupplyLine.count({ where: { supplyId } }),
    prisma.saleSupplyLine.count({ where: { supplyId } }),
  ]);
  if (lineCount > 0 || saleLineCount > 0) {
    throw new PackingSupplyInUseError(lineCount, saleLineCount);
  }
  await prisma.packingSupply.delete({ where: { id: supplyId } });
}

// ── Supply lines of a purchase order ─────────────────────────────────────────────────────────

export interface PurchaseSupplyLineInput {
  supplyId: string;
  /** Whole units, at least one. */
  quantity: number;
  /** In the purchase's transaction currency; the opening value on an opening balance. */
  price: number;
}

/** The columns a line stores, validated: a positive whole quantity and a price that is never
 * negative — on an opening balance as on a purchase. */
function lineData(input: PurchaseSupplyLineInput): { quantity: number; price: Prisma.Decimal } {
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error("A supply line's quantity must be a whole number of at least 1.");
  }
  if (!Number.isFinite(input.price) || input.price < 0) {
    throw new Error("A supply line's price must be a non-negative number.");
  }
  return { quantity: input.quantity, price: new Prisma.Decimal(roundAmount(input.price)) };
}

/** The purchase a line is written onto, proved to be the caller's; returns its collection. */
async function assertPurchase(ownerId: string, purchaseId: string): Promise<string> {
  const purchase = await prisma.purchase.findUnique({
    where: { id: purchaseId },
    select: { collectionId: true, collection: { select: { ownerId: true } } },
  });
  if (!purchase || purchase.collection.ownerId !== ownerId) {
    throw new Error("Purchase not found or access denied.");
  }
  return purchase.collectionId;
}

/** The line this call is about, proved to be the caller's; returns its purchase's collection. */
async function assertLine(ownerId: string, lineId: string): Promise<string> {
  const line = await prisma.purchaseSupplyLine.findUnique({
    where: { id: lineId },
    select: { purchase: { select: { collectionId: true, collection: { select: { ownerId: true } } } } },
  });
  if (!line || line.purchase.collection.ownerId !== ownerId) {
    throw new Error("Supply line not found or access denied.");
  }
  return line.purchase.collectionId;
}

/** The supply a line names must be one of the purchase's own collection's. */
async function assertSupplyInCollection(collectionId: string, supplyId: string): Promise<void> {
  const supply = await prisma.packingSupply.findFirst({
    where: { id: supplyId, collectionId },
    select: { id: true },
  });
  if (!supply) throw new Error("Packing supply not found in this collection.");
}

/** Add a supply line — a batch — to a purchase or an opening balance. Returns its id. */
export async function createPurchaseSupplyLine(
  ownerId: string,
  purchaseId: string,
  input: PurchaseSupplyLineInput
): Promise<string> {
  const collectionId = await assertPurchase(ownerId, purchaseId);
  await assertSupplyInCollection(collectionId, input.supplyId);
  return prisma.$transaction(async (tx) => {
    const created = await tx.purchaseSupplyLine.create({
      data: { purchaseId, supplyId: input.supplyId, ...lineData(input) },
      select: { id: true },
    });
    // New stock covers what sales are still short of (#1898).
    await settleSupplies(tx, [input.supplyId]);
    return created.id;
  });
}

/** Restate a line's supply, quantity and price. A batch lowered below what sales took from it gives
 * the latest of those units back, and the supply's other batches cover them where they can (#1898);
 * a batch moved to another supply gives back everything taken from it. */
export async function updatePurchaseSupplyLine(
  ownerId: string,
  lineId: string,
  input: PurchaseSupplyLineInput
): Promise<void> {
  const collectionId = await assertLine(ownerId, lineId);
  await assertSupplyInCollection(collectionId, input.supplyId);
  await prisma.$transaction(async (tx) => {
    const before = await tx.purchaseSupplyLine.findUniqueOrThrow({
      where: { id: lineId },
      select: { supplyId: true },
    });
    if (before.supplyId !== input.supplyId) {
      await tx.saleSupplyUse.deleteMany({ where: { batchId: lineId } });
    }
    await tx.purchaseSupplyLine.update({
      where: { id: lineId },
      data: { supplyId: input.supplyId, ...lineData(input) },
    });
    await settleSupplies(tx, [before.supplyId, input.supplyId]);
  });
}

/** Remove a line, and with it its batch from the supply's stock. What sales took from it is then
 * short, and the supply's other batches cover it where they can (#1898). */
export async function deletePurchaseSupplyLine(ownerId: string, lineId: string): Promise<void> {
  await assertLine(ownerId, lineId);
  await prisma.$transaction(async (tx) => {
    const line = await tx.purchaseSupplyLine.delete({
      where: { id: lineId },
      select: { supplyId: true },
    });
    await settleSupplies(tx, [line.supplyId]);
  });
}

// ── The stock ────────────────────────────────────────────────────────────────────────────────

/** One batch on the Supplies screen, oldest first within its supply. */
export interface SupplyBatchData {
  id: string;
  /** The intake document it came from. */
  purchase: {
    id: string;
    purchaseNo: number;
    kind: PurchaseKind;
    /** What the document is known by — an opening balance's title, a purchase's supplier or
     *  platform (`intakeDocumentName`); null when a purchase has neither. */
    name: string | null;
    purchasedAt: string;
  };
  quantity: number;
  onHand: number;
  /** The batch's own currency, and its whole cost there: line price + shipping share (2 dp). */
  currency: string;
  costTx: string;
  /** One unit's cost in the base currency (4 dp), or null when the purchase has no rate into it. */
  unitCostBase: string | null;
  /** What is left of the batch, base currency (2 dp), or null when its cost is unknown there. */
  valueBase: string | null;
}

/** One supply's stock on the Supplies screen. */
export interface SupplyStockData {
  id: string;
  name: string;
  onHand: number;
  /** On hand at FIFO cost, base currency (2 dp); null when a batch with units left has no rate. */
  valueBase: string | null;
  unvaluedBatches: number;
  /** Units sales used that were not in stock (#1898) — waiting for a purchase to cover them. */
  shortUnits: number;
  batches: SupplyBatchData[];
}

export interface SuppliesStock {
  baseCurrency: string;
  supplies: SupplyStockData[];
  /** Every supply's value summed, base currency (2 dp); null when any of them has none. */
  totalValueBase: string | null;
}

/** Every supply of the collection with its batches, what is on hand and its value at FIFO cost. */
export async function getSuppliesStock(
  ownerId: string,
  collectionId: string
): Promise<SuppliesStock> {
  await assertCollectionOwner(ownerId, collectionId);
  const collection = await prisma.collection.findUniqueOrThrow({
    where: { id: collectionId },
    select: { baseCurrency: true },
  });
  const supplies = await prisma.packingSupply.findMany({
    where: { collectionId },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      lines: {
        select: {
          id: true,
          quantity: true,
          createdAt: true,
          // What sales took from the batch (#1898).
          uses: { select: { quantity: true } },
          purchase: {
            select: {
              id: true,
              purchaseNo: true,
              kind: true,
              title: true,
              purchasedAt: true,
              currency: true,
              fxRateToBase: true,
              shippingCost: true,
              contact: { select: { name: true } },
              platform: { select: { name: true } },
              // Every priced line of the order: a batch's share of the shipping depends on all of
              // them (ADR-0009 §3.1), so its cost is the same here as on the order's own screen.
              lots: { select: { id: true, price: true } },
              expenses: { select: { id: true, price: true } },
              supplyLines: { select: { id: true, price: true } },
            },
          },
        },
      },
      saleLines: { select: { quantity: true } },
    },
  });

  let totalCents = 0;
  let anyUnvalued = false;
  const result = supplies.map((supply): SupplyStockData => {
    const batches = supply.lines.map((line) => {
      const p = line.purchase;
      const costs = purchaseCostsOf(p);
      const cost = computeSupplyBatchCost(
        costs,
        line.id,
        canExpressInBase(costs.fxRateToBase, p.currency, collection.baseCurrency)
      );
      return {
        id: line.id,
        boughtOn: p.purchasedAt.toISOString().slice(0, 10),
        createdAt: line.createdAt.toISOString(),
        quantity: line.quantity,
        costBase: cost.costBase,
        purchase: {
          id: p.id,
          purchaseNo: p.purchaseNo,
          kind: p.kind as PurchaseKind,
          name: intakeDocumentName({
            kind: p.kind,
            title: p.title,
            contactName: p.contact?.name ?? null,
            platformName: p.platform?.name ?? null,
          }),
          purchasedAt: p.purchasedAt.toISOString().slice(0, 10),
        },
        currency: p.currency,
        costTx: cost.costTx.toFixed(2),
      };
    });
    const used = new Map(
      supply.lines.map((line) => [line.id, line.uses.reduce((sum, u) => sum + u.quantity, 0)])
    );
    const stock = supplyStock(batches, used);
    const usedOnSales = supply.saleLines.reduce((sum, l) => sum + l.quantity, 0);
    const takenFromStock = [...used.values()].reduce((sum, q) => sum + q, 0);
    const byId = new Map(batches.map((b) => [b.id, b]));
    if (stock.valueBase == null) anyUnvalued = true;
    else totalCents += Math.round(stock.valueBase * 100);
    return {
      id: supply.id,
      name: supply.name,
      onHand: stock.onHand,
      valueBase: stock.valueBase?.toFixed(2) ?? null,
      unvaluedBatches: stock.unvaluedBatches,
      shortUnits: Math.max(0, usedOnSales - takenFromStock),
      batches: stock.batches.map((b) => {
        const own = byId.get(b.id)!;
        return {
          id: b.id,
          purchase: own.purchase,
          quantity: b.quantity,
          onHand: b.onHand,
          currency: own.currency,
          costTx: own.costTx,
          unitCostBase: b.unitCostBase == null ? null : formatUnitCost(b.unitCostBase),
          valueBase: b.valueBase?.toFixed(2) ?? null,
        };
      }),
    };
  });

  return {
    baseCurrency: collection.baseCurrency,
    supplies: result,
    totalValueBase: anyUnvalued ? null : (totalCents / 100).toFixed(2),
  };
}
