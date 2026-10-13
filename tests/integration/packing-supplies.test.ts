import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getPurchaseDetail } from "../../src/lib/lots";
import { listPurchasesPaginated } from "../../src/lib/purchases";
import {
  createPackingSupply,
  createPurchaseSupplyLine,
  deletePackingSupply,
  deletePurchaseSupplyLine,
  getSuppliesStock,
  listPackingSupplies,
  PackingSupplyInUseError,
  renamePackingSupply,
  updatePurchaseSupplyLine,
} from "../../src/lib/packing-supplies";

// Packing supplies (#1897, ADR-0068), read back out of Prisma: the dictionary, supply lines on a
// purchase and an opening balance, each line a batch costed with its share of the order's shipping,
// and the stock those batches make up. The FIFO arithmetic has its own unit test
// (`tests/unit/supply-stock.test.ts`); this one covers what is between the rows and it — which lines
// share the shipping, which date makes a batch older, and the guards on every write.

const TS = Date.now();

describe("packing supplies", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let envelopeId: string;
  let cardId: string;
  /** A PLN purchase with a rate and shipping, a lot of stamps beside the envelopes. */
  let purchaseId: string;
  /** An older opening balance: envelopes already on the shelf. */
  let openingId: string;
  let envelopeLineId: string;
  let nextNo = 8100;

  before(async () => {
    const user = (suffix: string) =>
      prisma.user.create({
        data: {
          id: `test-user-supplies-${suffix}-${TS}`,
          name: "Test User Supplies",
          email: `test-supplies-${suffix}-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    userId = (await user("a")).id;
    otherUserId = (await user("b")).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-supplies-${TS}`, name: "Supplies", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-supplies-b-${TS}`, name: "Other", baseCurrency: "EUR", ownerId: otherUserId },
      })
    ).id;

    purchaseId = (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: nextNo++,
          purchasedAt: new Date("2026-06-01"),
          currency: "PLN",
          fxRateToBase: "0.25",
          shippingCost: "10.00",
          lots: { create: [{ price: "60.00" }] },
          expenses: { create: [{ label: "Tongs", price: "20.00" }] },
        },
      })
    ).id;
    openingId = (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: nextNo++,
          kind: "opening_balance",
          title: "The shelf",
          status: "arrived",
          purchasedAt: new Date("2026-01-01"),
          currency: "EUR",
        },
      })
    ).id;
  });

  after(async () => {
    // A whole collection deletes in one statement, supplies with bought lines included — which is
    // what the line's NO ACTION reference to its supply is for.
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("defines supplies by name, distinct within a collection", async () => {
    envelopeId = await createPackingSupply(userId, collectionId, "  C6 envelope ");
    cardId = await createPackingSupply(userId, collectionId, "Transport card A6");
    await assert.rejects(createPackingSupply(userId, collectionId, "C6 envelope"));
    await assert.rejects(createPackingSupply(otherUserId, collectionId, "Stolen"));
    await renamePackingSupply(userId, cardId, "Transport card A5");
    const supplies = await listPackingSupplies(userId, collectionId);
    assert.deepEqual(
      supplies.map((s) => [s.name, s.lineCount]),
      [
        ["C6 envelope", 0],
        ["Transport card A5", 0],
      ]
    );
  });

  it("buys a supply as a line of a purchase order, sharing the shipping with the stamps", async () => {
    envelopeLineId = await createPurchaseSupplyLine(userId, purchaseId, {
      supplyId: envelopeId,
      quantity: 100,
      price: 20,
    });
    const detail = (await getPurchaseDetail(userId, purchaseId))!;
    // 10.00 shipping over 60 + 20 + 20 by price: the lot takes 6, the expense 2, the envelopes 2.
    assert.equal(detail.lots[0].poolTx, "66.00");
    assert.deepEqual(detail.supplyLines, [
      {
        id: envelopeLineId,
        supplyId: envelopeId,
        supplyName: "C6 envelope",
        quantity: 100,
        price: "20.00",
        shippingShare: "2.00",
        unitCost: "0.2200",
      },
    ]);
    assert.equal(detail.total, "110.00");
    assert.equal(detail.spend.tx.price, "100.00");
    assert.deepEqual(detail.spend.lines, { lots: 1, expenses: 1, supplies: 1 });

    const list = await listPurchasesPaginated(userId, collectionId);
    assert.equal(list.items.find((p) => p.id === purchaseId)?.total, "110.00");
  });

  it("refuses a line that is not a whole positive quantity, a negative price or another collection's supply", async () => {
    await assert.rejects(
      createPurchaseSupplyLine(userId, purchaseId, { supplyId: envelopeId, quantity: 0, price: 1 })
    );
    await assert.rejects(
      createPurchaseSupplyLine(userId, purchaseId, { supplyId: envelopeId, quantity: 1.5, price: 1 })
    );
    await assert.rejects(
      createPurchaseSupplyLine(userId, purchaseId, { supplyId: envelopeId, quantity: 1, price: -1 })
    );
    const foreign = await createPackingSupply(otherUserId, otherCollectionId, "Theirs");
    await assert.rejects(
      createPurchaseSupplyLine(userId, purchaseId, { supplyId: foreign, quantity: 1, price: 1 })
    );
    await assert.rejects(
      createPurchaseSupplyLine(otherUserId, purchaseId, { supplyId: foreign, quantity: 1, price: 1 })
    );
  });

  it("brings supplies in through an opening balance, at their value", async () => {
    await createPurchaseSupplyLine(userId, openingId, { supplyId: envelopeId, quantity: 50, price: 5 });
    const detail = (await getPurchaseDetail(userId, openingId))!;
    assert.equal(detail.supplyLines[0].unitCost, "0.1000");
    // An opening balance's list total stays the opening value of its lots: it has none.
    const list = await listPurchasesPaginated(userId, collectionId);
    assert.equal(list.items.find((p) => p.id === openingId)?.total, null);
  });

  it("shows each supply's stock: batches oldest first, on hand and value at FIFO cost", async () => {
    const stock = await getSuppliesStock(userId, collectionId);
    assert.equal(stock.baseCurrency, "EUR");
    const envelope = stock.supplies.find((s) => s.id === envelopeId)!;
    assert.equal(envelope.onHand, 150);
    // The shelf's 5.00 EUR, and the purchase's 22.00 PLN at 0.25.
    assert.equal(envelope.valueBase, "10.50");
    assert.deepEqual(
      envelope.batches.map((b) => [b.purchase.name, b.quantity, b.onHand, b.costTx, b.unitCostBase, b.valueBase]),
      [
        ["The shelf", 50, 50, "5.00", "0.1000", "5.00"],
        [null, 100, 100, "22.00", "0.0550", "5.50"],
      ]
    );
    const card = stock.supplies.find((s) => s.id === cardId)!;
    assert.deepEqual([card.onHand, card.valueBase, card.batches.length], [0, "0.00", 0]);
    assert.equal(stock.totalValueBase, "10.50");
  });

  it("states no value for a batch bought in a currency with no rate", async () => {
    const noRate = await prisma.purchase.create({
      data: {
        collectionId,
        purchaseNo: nextNo++,
        purchasedAt: new Date("2026-07-01"),
        currency: "PLN",
      },
    });
    const line = await createPurchaseSupplyLine(userId, noRate.id, {
      supplyId: cardId,
      quantity: 10,
      price: 4,
    });
    const stock = await getSuppliesStock(userId, collectionId);
    const card = stock.supplies.find((s) => s.id === cardId)!;
    assert.equal(card.valueBase, null);
    assert.equal(card.unvaluedBatches, 1);
    assert.equal(stock.totalValueBase, null);
    await deletePurchaseSupplyLine(userId, line);
    await prisma.purchase.delete({ where: { id: noRate.id } });
  });

  it("restates and removes a line, and keeps a bought supply from being deleted", async () => {
    await updatePurchaseSupplyLine(userId, envelopeLineId, { supplyId: envelopeId, quantity: 200, price: 20 });
    const detail = (await getPurchaseDetail(userId, purchaseId))!;
    assert.equal(detail.supplyLines[0].unitCost, "0.1100");
    await assert.rejects(updatePurchaseSupplyLine(otherUserId, envelopeLineId, { supplyId: envelopeId, quantity: 1, price: 1 }));

    await assert.rejects(deletePackingSupply(userId, envelopeId), PackingSupplyInUseError);
    await deletePackingSupply(userId, cardId);
    assert.equal(await prisma.packingSupply.count({ where: { id: cardId } }), 0);

    await deletePurchaseSupplyLine(userId, envelopeLineId);
    const after = (await getPurchaseDetail(userId, purchaseId))!;
    assert.equal(after.supplyLines.length, 0);
    assert.equal(after.lots[0].poolTx, "67.50");
  });
});
