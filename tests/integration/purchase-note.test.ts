import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { getPurchaseDetail } from "../../src/lib/lots";
import { createPurchase, listPurchasesPaginated, setPurchaseNote, updatePurchase } from "../../src/lib/purchases";

// An intake document's note (#2378): one plain, multi-line remark on a purchase, a trade's intake and
// an opening balance alike, written, rewritten and cleared on the document's screen and read there and
// on the Purchases list. A trade's intake keeps its own, apart from the trade's notes.

describe("an intake document's note (#2378)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let purchaseId: string;
  let openingId: string;
  let tradeIntakeId: string;
  let tradeId: string;

  async function stored(id: string) {
    const row = await prisma.purchase.findUniqueOrThrow({ where: { id }, select: { note: true } });
    return row.note;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-purchase-note-${ts}`;
    otherUserId = `test-user-purchase-note-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-purchase-note-${ts}`, name: "Purchase note", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;

    purchaseId = (await createPurchase(userId, collectionId, { currency: "EUR", purchasedAt: "2026-11-01" })).id;
    openingId = (
      await createPurchase(userId, collectionId, {
        kind: "opening_balance",
        title: "Klaser Polska 1",
        currency: "EUR",
        purchasedAt: "2026-01-01",
      })
    ).id;
    const partner = await prisma.contact.create({ data: { collectionId, name: "Swap partner" } });
    tradeId = (
      await prisma.trade.create({
        data: { collectionId, tradeNo: 1, partnerId: partner.id, currency: "EUR", notes: "The trade's own" },
      })
    ).id;
    tradeIntakeId = (
      await prisma.purchase.create({
        data: {
          collectionId,
          purchaseNo: 900,
          tradeId,
          purchasedAt: new Date("2026-10-02T00:00:00.000Z"),
          currency: "EUR",
        },
      })
    ).id;
  });

  after(async () => {
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.trade.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("starts with none", async () => {
    const detail = await getPurchaseDetail(userId, purchaseId);
    assert.equal(detail?.note, null);
  });

  it("writes, rewrites and clears a note on each of the three kinds", async () => {
    for (const id of [purchaseId, openingId, tradeIntakeId]) {
      await setPurchaseNote(userId, id, "Seller owes two stamps.\r\nAsk at the next fair.  ");
      assert.equal(await stored(id), "Seller owes two stamps.\nAsk at the next fair.", "line breaks kept, the ends trimmed");
      assert.equal((await getPurchaseDetail(userId, id))?.note, "Seller owes two stamps.\nAsk at the next fair.");

      await setPurchaseNote(userId, id, "Settled.");
      assert.equal(await stored(id), "Settled.");

      await setPurchaseNote(userId, id, "   \n ");
      assert.equal(await stored(id), null, "a blank note clears it, never an empty string");
      await setPurchaseNote(userId, id, "Back again.");
      await setPurchaseNote(userId, id, null);
      assert.equal(await stored(id), null);
    }
  });

  it("keeps a trade's intake note apart from the trade's own notes", async () => {
    await setPurchaseNote(userId, tradeIntakeId, "Two stamps thinned.");
    const trade = await prisma.trade.findUniqueOrThrow({ where: { id: tradeId }, select: { notes: true } });
    assert.equal(trade.notes, "The trade's own");
    assert.equal(await stored(tradeIntakeId), "Two stamps thinned.");
  });

  it("marks the documents on the Purchases list that have one", async () => {
    await setPurchaseNote(userId, purchaseId, "Paid by transfer.");
    await setPurchaseNote(userId, openingId, null);
    const { items } = await listPurchasesPaginated(userId, collectionId);
    const noteOf = (id: string) => items.find((item) => item.id === id)?.note;
    assert.equal(noteOf(purchaseId), "Paid by transfer.");
    assert.equal(noteOf(tradeIntakeId), "Two stamps thinned.");
    assert.equal(noteOf(openingId), null);
  });

  it("is left alone by an edit of the header", async () => {
    await updatePurchase(userId, purchaseId, { currency: "EUR", purchasedAt: "2026-11-02" });
    assert.equal(await stored(purchaseId), "Paid by transfer.");
  });

  it("refuses anybody but the collection's owner", async () => {
    await assert.rejects(setPurchaseNote(otherUserId, purchaseId, "Not mine"), /not found or access denied/);
    assert.equal(await stored(purchaseId), "Paid by transfer.");
  });
});
