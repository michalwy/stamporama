import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { deleteSale, getSaleDetail, listSalesPaginated } from "../../src/lib/sales";
import { deletePurchase } from "../../src/lib/purchases";
import {
  createPackingSupply,
  createPurchaseSupplyLine,
  deletePackingSupply,
  deletePurchaseSupplyLine,
  getSuppliesStock,
  PackingSupplyInUseError,
  updatePurchaseSupplyLine,
} from "../../src/lib/packing-supplies";
import {
  createSaleSupplyLine,
  deleteSaleSupplyLine,
  SaleSupplyShortError,
  updateSaleSupplyLine,
} from "../../src/lib/sale-supplies";
import { settleSupplies } from "../../src/lib/supply-settlement";

// Packing supplies used on a sale (#1898, ADR-0068 §7), read back out of Prisma: a sale's *my
// shipping* is its postage plus the supplies its parcel used, taken from stock FIFO and costed at
// their batches' unit costs; supplies come back to stock when a line is changed or removed or the
// sale deleted. A line added or changed by hand takes no more than is on hand (#2229); one that came
// in short otherwise — a service's usual supplies, a line recorded before — stays short and the total
// incomplete until a purchase covers it. The settling rule itself is unit-tested (`tests/unit/supply-stock.test.ts`);
// this covers the writes that call it and the reads that cost what it leaves.

const TS = Date.now();

describe("packing supplies on a sale", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let platformId: string;
  let envelopeId: string;
  /** Three envelopes for 0.60 EUR, January: 0.20 each. */
  let batchA: string;
  /** Two envelopes for 1.00 EUR plus 1.00 shipping, February: 1.00 each. */
  let batchB: string;
  let purchaseB: string;
  let saleOne: string;
  let saleTwo: string;
  let lineOne: string;
  let lineTwo: string;
  let nextNo = 8300;
  let nextSaleNo = 8300;

  async function purchase(data: {
    purchasedAt: string;
    currency?: string;
    fxRateToBase?: string;
    shippingCost?: string;
  }): Promise<string> {
    return (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: nextNo++,
          purchasedAt: new Date(data.purchasedAt),
          currency: data.currency ?? "EUR",
          fxRateToBase: data.fxRateToBase ?? null,
          shippingCost: data.shippingCost ?? null,
        },
      })
    ).id;
  }

  async function sale(soldAt: string, postage: string | null): Promise<string> {
    return (
      await prisma.sale.create({
        data: {
          collectionId,
          platformId,
          saleNo: nextSaleNo++,
          soldAt: new Date(`${soldAt}T00:00:00.000Z`),
          currency: "EUR",
          shippingCost: postage,
          shippingCurrency: postage == null ? null : "EUR",
        },
      })
    ).id;
  }

  /** A line written the way a carrier service's usual supplies (#1899) or a sale recorded before
   * #2229 write one — with no check against stock — and settled. */
  async function shortLine(saleId: string, supplyId: string, quantity: number): Promise<string> {
    return prisma.$transaction(async (tx) => {
      const line = await tx.saleSupplyLine.create({ data: { saleId, supplyId, quantity } });
      await settleSupplies(tx, [supplyId]);
      return line.id;
    });
  }

  async function envelopeOnHand(): Promise<number> {
    const stock = await getSuppliesStock(userId, collectionId);
    return stock.supplies.find((s) => s.id === envelopeId)!.onHand;
  }

  async function onHand(): Promise<Record<string, number>> {
    const stock = await getSuppliesStock(userId, collectionId);
    const envelope = stock.supplies.find((s) => s.id === envelopeId)!;
    return Object.fromEntries(envelope.batches.map((b) => [b.id, b.onHand]));
  }

  before(async () => {
    const user = (suffix: string) =>
      prisma.user.create({
        data: {
          id: `test-user-sale-supplies-${suffix}-${TS}`,
          name: "Test User Sale Supplies",
          email: `test-sale-supplies-${suffix}-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    userId = (await user("a")).id;
    otherUserId = (await user("b")).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sale-supplies-${TS}`, name: "Sale supplies", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-sale-supplies-b-${TS}`, name: "Other", baseCurrency: "EUR", ownerId: otherUserId },
      })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })
    ).id;
    envelopeId = await createPackingSupply(userId, collectionId, "C6 envelope");

    batchA = await createPurchaseSupplyLine(userId, await purchase({ purchasedAt: "2026-01-01" }), {
      supplyId: envelopeId,
      quantity: 3,
      price: 0.6,
    });
    purchaseB = await purchase({ purchasedAt: "2026-02-01", shippingCost: "1.00" });
    batchB = await createPurchaseSupplyLine(userId, purchaseB, {
      supplyId: envelopeId,
      quantity: 2,
      price: 1,
    });
    saleOne = await sale("2026-03-01", "5.00");
    saleTwo = await sale("2026-03-05", null);
  });

  after(async () => {
    // A whole collection still deletes in one statement — sales' supply lines and their uses
    // included — which is what the lines' NO ACTION reference to their supply is for.
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("leaves a sale with no supply lines at its postage alone", async () => {
    const detail = (await getSaleDetail(userId, saleOne))!;
    assert.deepEqual(detail.supplies.lines, []);
    assert.equal(detail.myShippingBase, "5.00");
    assert.equal(detail.netProceeds, "-5.00");
  });

  it("takes a line's units oldest batch first and adds their cost to the postage", async () => {
    lineOne = await createSaleSupplyLine(userId, saleOne, { supplyId: envelopeId, quantity: 4 });
    const detail = (await getSaleDetail(userId, saleOne))!;
    // 3 × 0.20 from January + 1 × 1.00 from February.
    assert.deepEqual(
      detail.supplies.lines.map((l) => [l.supplyName, l.quantity, l.costBase, l.shortUnits]),
      [["C6 envelope", 4, "1.60", 0]]
    );
    assert.equal(detail.supplies.costBase, "1.60");
    assert.equal(detail.supplies.incomplete, false);
    assert.equal(detail.shippingBase, "5.00");
    assert.equal(detail.myShippingBase, "6.60");
    assert.equal(detail.netProceeds, "-6.60");
    assert.deepEqual(await onHand(), { [batchA]: 0, [batchB]: 1 });

    const { items } = await listSalesPaginated(userId, collectionId);
    assert.equal(items.find((s) => s.id === saleOne)!.netProceeds, "-6.60");
  });

  it("refuses a line asking for more than is on hand, and records nothing", async () => {
    await assert.rejects(createSaleSupplyLine(userId, saleTwo, { supplyId: envelopeId, quantity: 3 }), {
      name: "SaleSupplyShortError",
      message: "Only 1 “C6 envelope” on hand.",
    });
    assert.equal(await prisma.saleSupplyLine.count({ where: { saleId: saleTwo } }), 0);
    assert.deepEqual(await onHand(), { [batchA]: 0, [batchB]: 1 });
  });

  it("keeps a line that came in short, uncosted, and marks the total incomplete", async () => {
    lineTwo = await shortLine(saleTwo, envelopeId, 3);
    const detail = (await getSaleDetail(userId, saleTwo))!;
    assert.deepEqual(
      detail.supplies.lines.map((l) => [l.quantity, l.costBase, l.shortUnits]),
      [[3, "1.00", 2]]
    );
    assert.equal(detail.supplies.incomplete, true);
    assert.equal(detail.myShippingBase, "1.00");

    const stock = await getSuppliesStock(userId, collectionId);
    assert.equal(stock.supplies[0].shortUnits, 2);
    assert.equal(stock.supplies[0].onHand, 0);
  });

  it("lets a short line keep its quantity, but not raise it", async () => {
    await updateSaleSupplyLine(userId, lineTwo, { supplyId: envelopeId, quantity: 3 });
    await assert.rejects(
      updateSaleSupplyLine(userId, lineTwo, { supplyId: envelopeId, quantity: 4 }),
      SaleSupplyShortError
    );
    const detail = (await getSaleDetail(userId, saleTwo))!;
    assert.deepEqual(
      detail.supplies.lines.map((l) => [l.quantity, l.shortUnits]),
      [[3, 2]]
    );
  });

  it("covers a shortfall from the next purchase of the supply", async () => {
    // Five for 2.50: 0.50 each.
    const batchC = await createPurchaseSupplyLine(
      userId,
      await purchase({ purchasedAt: "2026-04-01" }),
      { supplyId: envelopeId, quantity: 5, price: 2.5 }
    );
    const detail = (await getSaleDetail(userId, saleTwo))!;
    assert.deepEqual(
      detail.supplies.lines.map((l) => [l.costBase, l.shortUnits]),
      [["2.00", 0]]
    );
    assert.equal(detail.supplies.incomplete, false);
    assert.deepEqual(await onHand(), { [batchA]: 0, [batchB]: 0, [batchC]: 3 });
    assert.equal((await getSuppliesStock(userId, collectionId)).supplies[0].shortUnits, 0);
  });

  it("gives back a lowered line's last-taken units, to the batches they came from", async () => {
    await updateSaleSupplyLine(userId, lineOne, { supplyId: envelopeId, quantity: 2 });
    const detail = (await getSaleDetail(userId, saleOne))!;
    // It keeps two of January's, at 0.20 each; February's unit and one of January's go back.
    assert.equal(detail.supplies.lines[0].costBase, "0.40");
    assert.equal(detail.myShippingBase, "5.40");
    const stock = await onHand();
    assert.equal(stock[batchA], 1);
    assert.equal(stock[batchB], 1);
  });

  it("returns a deleted sale's supplies to stock", async () => {
    await deleteSale(userId, saleTwo);
    const stock = await onHand();
    assert.equal(stock[batchB], 2);
    assert.equal(Object.values(stock).reduce((s, q) => s + q, 0), 1 + 2 + 5);
  });

  it("re-covers what a deleted batch held for a sale from the supply's other batches", async () => {
    await deletePurchaseSupplyLine(userId, batchA);
    const detail = (await getSaleDetail(userId, saleOne))!;
    // The two units now come from February, at 1.00 each.
    assert.equal(detail.supplies.lines[0].costBase, "2.00");
    assert.equal(detail.supplies.lines[0].shortUnits, 0);
    assert.equal((await onHand())[batchB], 0);
  });

  it("gives back a lowered batch's units and covers them from the next one", async () => {
    await updatePurchaseSupplyLine(userId, batchB, { supplyId: envelopeId, quantity: 1, price: 1 });
    const detail = (await getSaleDetail(userId, saleOne))!;
    // February now holds one envelope costing 2.00 (1.00 + all the shipping); April gives the other.
    assert.equal(detail.supplies.lines[0].costBase, "2.50");
    assert.equal(detail.supplies.lines[0].shortUnits, 0);
  });

  it("re-covers what a deleted purchase held for a sale", async () => {
    await deletePurchase(userId, purchaseB);
    const detail = (await getSaleDetail(userId, saleOne))!;
    assert.equal(detail.supplies.lines[0].costBase, "1.00");
  });

  it("counts units from a batch with no rate into the base as uncosted", async () => {
    const unrated = await createPackingSupply(userId, collectionId, "Transport card");
    await createPurchaseSupplyLine(
      userId,
      await purchase({ purchasedAt: "2026-01-15", currency: "PLN" }),
      { supplyId: unrated, quantity: 10, price: 5 }
    );
    const line = await createSaleSupplyLine(userId, saleOne, { supplyId: unrated, quantity: 2 });
    const detail = (await getSaleDetail(userId, saleOne))!;
    const card = detail.supplies.lines.find((l) => l.id === line)!;
    assert.deepEqual([card.costBase, card.unratedUnits, card.shortUnits], ["0.00", 2, 0]);
    assert.equal(detail.supplies.incomplete, true);
    await deleteSaleSupplyLine(userId, line);
  });

  it("raises a line only by what is on hand, counting the units it already took", async () => {
    // The line holds two of April's five; three are left.
    assert.equal(await envelopeOnHand(), 3);
    await assert.rejects(updateSaleSupplyLine(userId, lineOne, { supplyId: envelopeId, quantity: 6 }), {
      name: "SaleSupplyShortError",
      message: "Only 5 “C6 envelope” on hand.",
    });
    assert.equal((await prisma.saleSupplyLine.findUniqueOrThrow({ where: { id: lineOne } })).quantity, 2);
    await updateSaleSupplyLine(userId, lineOne, { supplyId: envelopeId, quantity: 5 });
    assert.equal(await envelopeOnHand(), 0);
    await updateSaleSupplyLine(userId, lineOne, { supplyId: envelopeId, quantity: 2 });
    assert.equal(await envelopeOnHand(), 3);
  });

  it("moves a line to another supply only up to what that one has on hand", async () => {
    const tape = await createPackingSupply(userId, collectionId, "Tape");
    await assert.rejects(updateSaleSupplyLine(userId, lineOne, { supplyId: tape, quantity: 1 }), {
      name: "SaleSupplyShortError",
      message: "No “Tape” on hand — record the purchase that brought them in first.",
    });
    const detail = (await getSaleDetail(userId, saleOne))!;
    assert.deepEqual(
      detail.supplies.lines.map((l) => [l.supplyName, l.quantity, l.shortUnits]),
      [["C6 envelope", 2, 0]]
    );
    assert.equal(await envelopeOnHand(), 3);
    // A supply a sale used cannot be deleted, even one never bought.
    const short = await shortLine(saleOne, tape, 1);
    await assert.rejects(deletePackingSupply(userId, tape), PackingSupplyInUseError);
    await deleteSaleSupplyLine(userId, short);
  });

  it("moves a line to another supply, giving the first one's units back", async () => {
    const card = (await getSuppliesStock(userId, collectionId)).supplies.find((s) => s.name === "Transport card")!;
    await assert.rejects(
      updateSaleSupplyLine(userId, lineOne, { supplyId: card.id, quantity: card.onHand + 1 }),
      SaleSupplyShortError
    );
    await updateSaleSupplyLine(userId, lineOne, { supplyId: card.id, quantity: 1 });
    assert.equal(await envelopeOnHand(), 5);
    await updateSaleSupplyLine(userId, lineOne, { supplyId: envelopeId, quantity: 2 });
    assert.equal(await envelopeOnHand(), 3);
  });

  it("guards every write", async () => {
    await assert.rejects(createSaleSupplyLine(otherUserId, saleOne, { supplyId: envelopeId, quantity: 1 }));
    await assert.rejects(createSaleSupplyLine(userId, saleOne, { supplyId: envelopeId, quantity: 0 }));
    await assert.rejects(createSaleSupplyLine(userId, saleOne, { supplyId: envelopeId, quantity: 1.5 }));
    const foreign = await prisma.packingSupply.create({
      data: { collectionId: otherCollectionId, name: "Foreign" },
    });
    await assert.rejects(createSaleSupplyLine(userId, saleOne, { supplyId: foreign.id, quantity: 1 }));
    await assert.rejects(updateSaleSupplyLine(otherUserId, lineOne, { supplyId: envelopeId, quantity: 1 }));
    await assert.rejects(deleteSaleSupplyLine(otherUserId, lineOne));
  });

  it("returns a removed line's units to stock", async () => {
    const before = (await getSuppliesStock(userId, collectionId)).supplies.find((s) => s.id === envelopeId)!;
    await deleteSaleSupplyLine(userId, lineOne);
    const after = (await getSuppliesStock(userId, collectionId)).supplies.find((s) => s.id === envelopeId)!;
    assert.equal(after.onHand, before.onHand + 2);
    const detail = (await getSaleDetail(userId, saleOne))!;
    assert.equal(detail.myShippingBase, "5.00");
  });
});
