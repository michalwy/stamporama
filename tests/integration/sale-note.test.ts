import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createSale, getSaleDetail, listSalesPaginated, updateSaleNote } from "../../src/lib/sales";

// A sale's note (#2379), written from the sale's own screen: it is stored as written, line breaks
// kept, cleared by a blank, read back by the sale screen and by the Sales list's row, and refused to
// anybody but the collection's owner.

describe("a sale's note (#2379)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let saleId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-sale-note-${ts}`;
    otherUserId = `test-user-sale-note-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sale-note-${ts}`, name: "Notes", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    const platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-03"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    for (const id of [userId, otherUserId]) {
      await prisma.collection.deleteMany({ where: { ownerId: id } });
      await prisma.user.delete({ where: { id } });
    }
  });

  it("starts with none", async () => {
    assert.equal((await getSaleDetail(userId, saleId))!.note, null);
  });

  it("is written, read back by the screen and the list, edited and cleared", async () => {
    await updateSaleNote(userId, saleId, "  Promised a free stockcard.\n\nShip after the 20th.  ");
    const note = "Promised a free stockcard.\n\nShip after the 20th.";
    assert.equal((await getSaleDetail(userId, saleId))!.note, note);
    const row = (await listSalesPaginated(userId, collectionId)).items.find((item) => item.id === saleId);
    assert.equal(row?.note, note);

    await updateSaleNote(userId, saleId, "Ship after the 20th.");
    assert.equal((await getSaleDetail(userId, saleId))!.note, "Ship after the 20th.");

    await updateSaleNote(userId, saleId, " \n ");
    assert.equal((await prisma.sale.findUniqueOrThrow({ where: { id: saleId } })).note, null, "blank is none");
    await updateSaleNote(userId, saleId, "Again.");
    await updateSaleNote(userId, saleId, null);
    assert.equal((await getSaleDetail(userId, saleId))!.note, null);
  });

  it("does not leave the sale marked to review — the screen's write is the collector's own", async () => {
    await updateSaleNote(userId, saleId, "Mine.");
    assert.equal((await getSaleDetail(userId, saleId))!.apiReview, null);
  });

  it("is refused to another collector", async () => {
    await assert.rejects(() => updateSaleNote(otherUserId, saleId, "Not mine."));
    assert.equal((await getSaleDetail(userId, saleId))!.note, "Mine.");
  });
});
