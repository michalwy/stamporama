import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createPackingSupply,
  createPurchaseSupplyLine,
  deletePackingSupply,
  deletePurchaseSupplyLine,
  getSuppliesStock,
  PackingSupplyInUseError,
  updatePurchaseSupplyLine,
  type SupplyUseEntry,
} from "../../src/lib/packing-supplies";
import { createSaleSupplyLine } from "../../src/lib/sale-supplies";
import {
  createSupplyOwnUse,
  deleteSupplyOwnUse,
  SupplyOwnUseShortError,
  updateSupplyOwnUse,
} from "../../src/lib/supply-own-uses";

// Packing supplies taken out of stock without a sale (#1900, ADR-0068 §9), read back out of Prisma:
// a use leaves stock FIFO under the sales' rule, is listed in the supply's history with its cost,
// returns its units when corrected or deleted, and is refused when it asks for more than is on hand.
// A batch lowered afterwards can still leave it short, as it can a sale (the collector's call,
// 2026-10-14). The grouping by period is unit-tested (`tests/unit/supply-own-use-rules.test.ts`).

const TS = Date.now();

describe("packing supplies used without a sale", () => {
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
  let useOne: string;
  let saleLine: string;
  let nextNo = 8600;

  async function purchase(purchasedAt: string, shippingCost: string | null = null): Promise<string> {
    return (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: nextNo++,
          purchasedAt: new Date(purchasedAt),
          currency: "EUR",
          shippingCost,
        },
      })
    ).id;
  }

  async function envelope() {
    const stock = await getSuppliesStock(userId, collectionId);
    return stock.supplies.find((s) => s.id === envelopeId)!;
  }

  async function onHand(): Promise<Record<string, number>> {
    return Object.fromEntries((await envelope()).batches.map((b) => [b.id, b.onHand]));
  }

  async function ownEntry(id: string): Promise<Extract<SupplyUseEntry, { kind: "own" }>> {
    const entry = (await envelope()).history.find((h) => h.kind === "own" && h.id === id);
    assert.ok(entry && entry.kind === "own");
    return entry;
  }

  before(async () => {
    const user = (suffix: string) =>
      prisma.user.create({
        data: {
          id: `test-user-own-use-${suffix}-${TS}`,
          name: "Test User Own Use",
          email: `test-own-use-${suffix}-${TS}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    userId = (await user("a")).id;
    otherUserId = (await user("b")).id;
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-own-use-${TS}`, name: "Own use", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-own-use-b-${TS}`, name: "Other", baseCurrency: "EUR", ownerId: otherUserId },
      })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })
    ).id;
    envelopeId = await createPackingSupply(userId, collectionId, "C6 envelope");
    batchA = await createPurchaseSupplyLine(userId, await purchase("2026-01-01"), {
      supplyId: envelopeId,
      quantity: 3,
      price: 0.6,
    });
    batchB = await createPurchaseSupplyLine(userId, await purchase("2026-02-01", "1.00"), {
      supplyId: envelopeId,
      quantity: 2,
      price: 1,
    });
  });

  after(async () => {
    // A whole collection still deletes in one statement, own uses and their takes included — which
    // is what the use's NO ACTION reference to its supply is checked against.
    await prisma.collection.deleteMany({ where: { id: { in: [collectionId, otherCollectionId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("takes the units FIFO, lists the use in the history with its cost, and trims the note", async () => {
    useOne = await createSupplyOwnUse(userId, collectionId, {
      supplyId: envelopeId,
      quantity: 4,
      usedOn: "2026-03-01",
      note: "  storage  ",
    });
    // Three from January's batch at 0.20, the fourth from February's at 1.00.
    assert.deepEqual(await onHand(), { [batchA]: 0, [batchB]: 1 });
    const entry = await ownEntry(useOne);
    assert.deepEqual(
      [entry.usedOn, entry.quantity, entry.costBase, entry.shortUnits, entry.note],
      ["2026-03-01", 4, "1.60", 0, "storage"]
    );
    assert.equal((await envelope()).valueBase, "1.00");
  });

  it("refuses taking more than is on hand, and writes nothing", async () => {
    await assert.rejects(
      createSupplyOwnUse(userId, collectionId, {
        supplyId: envelopeId,
        quantity: 2,
        usedOn: "2026-03-02",
        note: null,
      }),
      (e: unknown) => e instanceof SupplyOwnUseShortError && e.onHand === 1
    );
    assert.equal(await prisma.supplyOwnUse.count({ where: { collectionId } }), 1);
    assert.deepEqual(await onHand(), { [batchA]: 0, [batchB]: 1 });
  });

  it("a lower quantity returns the newest batch's units first, and the use keeps the oldest", async () => {
    await updateSupplyOwnUse(userId, useOne, {
      supplyId: envelopeId,
      quantity: 2,
      usedOn: "2026-03-01",
      note: "storage",
    });
    assert.deepEqual(await onHand(), { [batchA]: 1, [batchB]: 2 });
    assert.equal((await ownEntry(useOne)).costBase, "0.40");
  });

  it("refuses a correction that asks for more than stock has, and leaves the use as it was", async () => {
    await assert.rejects(
      updateSupplyOwnUse(userId, useOne, {
        supplyId: envelopeId,
        quantity: 6,
        usedOn: "2026-03-01",
        note: "storage",
      }),
      SupplyOwnUseShortError
    );
    const entry = await ownEntry(useOne);
    assert.deepEqual([entry.quantity, entry.costBase], [2, "0.40"]);
    assert.deepEqual(await onHand(), { [batchA]: 1, [batchB]: 2 });
  });

  it("is listed beside the sales that used the supply, newest first", async () => {
    const saleId = (
      await prisma.sale.create({
        data: {
          collectionId,
          platformId,
          saleNo: 8601,
          soldAt: new Date("2026-03-05T00:00:00.000Z"),
          currency: "EUR",
        },
      })
    ).id;
    saleLine = await createSaleSupplyLine(userId, saleId, { supplyId: envelopeId, quantity: 3 });
    assert.deepEqual(await onHand(), { [batchA]: 0, [batchB]: 0 });
    const history = (await envelope()).history;
    assert.deepEqual(
      history.map((h) => [h.kind, h.id, h.usedOn, h.quantity, h.costBase]),
      [
        ["sale", saleLine, "2026-03-05", 3, "2.20"],
        ["own", useOne, "2026-03-01", 2, "0.40"],
      ]
    );
    const sale = history[0];
    assert.ok(sale.kind === "sale");
    assert.deepEqual([sale.sale.id, sale.sale.saleNo, sale.sale.platformName], [saleId, 8601, "Delcampe"]);
  });

  it("a lowered batch can leave the use short, as it can a sale, and only deepening it is refused", async () => {
    // January's batch drops to one envelope (still 0.20): it had handed out three — two to the use,
    // one to the sale — so the later of the two gives back first, then the use.
    await updatePurchaseSupplyLine(userId, batchA, { supplyId: envelopeId, quantity: 1, price: 0.2 });
    const supply = await envelope();
    assert.deepEqual([supply.shortUnits, supply.ownShortUnits], [1, 1]);
    const entry = await ownEntry(useOne);
    assert.deepEqual([entry.costBase, entry.shortUnits], ["0.20", 1]);

    // The note, the date or a lower quantity can still be corrected…
    await updateSupplyOwnUse(userId, useOne, {
      supplyId: envelopeId,
      quantity: 2,
      usedOn: "2026-03-02",
      note: "album pages",
    });
    assert.deepEqual(
      [(await ownEntry(useOne)).note, (await ownEntry(useOne)).usedOn],
      ["album pages", "2026-03-02"]
    );
    // …but asking for more than it already lacks is refused.
    await assert.rejects(
      updateSupplyOwnUse(userId, useOne, {
        supplyId: envelopeId,
        quantity: 3,
        usedOn: "2026-03-02",
        note: "album pages",
      }),
      SupplyOwnUseShortError
    );
  });

  it("deleting the use returns its units, and they cover a sale still short of them", async () => {
    await deleteSupplyOwnUse(userId, useOne);
    const supply = await envelope();
    assert.deepEqual([supply.shortUnits, supply.ownShortUnits], [0, 0]);
    assert.equal(supply.history.find((h) => h.kind === "own"), undefined);
    assert.equal(supply.history[0].costBase, "2.20");
  });

  it("a supply used outside sales cannot be deleted, even once its batches are gone", async () => {
    const cardId = await createPackingSupply(userId, collectionId, "Transport card A6");
    const batch = await createPurchaseSupplyLine(userId, await purchase("2026-01-10"), {
      supplyId: cardId,
      quantity: 10,
      price: 2,
    });
    await createSupplyOwnUse(userId, collectionId, {
      supplyId: cardId,
      quantity: 4,
      usedOn: "2026-01-11",
      note: null,
    });
    await deletePurchaseSupplyLine(userId, batch);
    const card = (await getSuppliesStock(userId, collectionId)).supplies.find((s) => s.id === cardId)!;
    assert.deepEqual([card.onHand, card.ownShortUnits], [0, 4]);
    await assert.rejects(
      deletePackingSupply(userId, cardId),
      (e: unknown) => e instanceof PackingSupplyInUseError && e.lineCount === 0 && e.ownUseCount === 1
    );
  });

  it("refuses an invalid date and a quantity below one", async () => {
    for (const [quantity, usedOn] of [
      [1, "2026-02-30"],
      [1, ""],
      [0, "2026-03-01"],
      [1.5, "2026-03-01"],
    ] as const) {
      await assert.rejects(
        createSupplyOwnUse(userId, collectionId, { supplyId: envelopeId, quantity, usedOn, note: null })
      );
    }
  });

  it("is the owner's alone", async () => {
    // Every envelope is on the sale by now: buy one more to use.
    await createPurchaseSupplyLine(userId, await purchase("2026-03-09"), {
      supplyId: envelopeId,
      quantity: 1,
      price: 0.5,
    });
    const useId = await createSupplyOwnUse(userId, collectionId, {
      supplyId: envelopeId,
      quantity: 1,
      usedOn: "2026-03-10",
      note: null,
    });
    const input = { supplyId: envelopeId, quantity: 1, usedOn: "2026-03-10", note: null };
    await assert.rejects(createSupplyOwnUse(otherUserId, collectionId, input), /access denied/);
    await assert.rejects(updateSupplyOwnUse(otherUserId, useId, input), /access denied/);
    await assert.rejects(deleteSupplyOwnUse(otherUserId, useId), /access denied/);
    // A supply of another collection cannot be named.
    const foreign = await createPackingSupply(otherUserId, otherCollectionId, "Foreign envelope");
    await assert.rejects(
      createSupplyOwnUse(userId, collectionId, { ...input, supplyId: foreign }),
      /not found in this collection/
    );
  });
});
