import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  getOfferDetail,
  listOffersPaginated,
  removeOfferSetsSoldElsewhere,
  setOfferState,
} from "../../src/lib/offers";
import { addSaleLines, createSale } from "../../src/lib/sales";
import { planFixEverything, planSoldElsewhereRemoval } from "../../src/lib/offer-fix-everything";

// The selection bar's *Remove sets sold elsewhere from N* and *Fix everything* (#2581), against a
// real database: the list row carries the same sets sold elsewhere the offer's own screen does, the
// plan over the issue's five Preparing offers removes from two and leaves three, and running each
// row's removal with the ids the row listed leaves those two Preparing, off *Needs action*.

describe("removing sets sold elsewhere from ticked offers (#2581)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let conditionId: string;
  let saleId: string;

  const newItem = async () =>
    (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  const newOffer = async () =>
    createOffer(userId, collectionId, {
      platformId,
      url: null,
      listingType: "fixed",
      price: "10.00",
      currency: "PLN",
      listingDate: null,
    });

  async function sellElsewhere(itemId: string) {
    const other = await newOffer();
    const otherSet = await addOfferSet(userId, other, [itemId]);
    await setOfferState(userId, other, "ready");
    await setOfferState(userId, other, "active");
    await addSaleLines(userId, saleId, [
      { offerId: other, offerSetId: otherSet, price: "10.00", itemIds: [itemId] },
    ]);
  }

  /** A Preparing offer of `kept` sets still for sale and `gone` sets whose copy sold elsewhere. */
  async function preparing(kept: number, gone: number) {
    const offerId = await newOffer();
    for (let i = 0; i < kept; i++) await addOfferSet(userId, offerId, [await newItem()]);
    const goneSets: string[] = [];
    for (let i = 0; i < gone; i++) {
      const item = await newItem();
      goneSets.push(await addOfferSet(userId, offerId, [item]));
      await sellElsewhere(item);
    }
    return { offerId, goneSets };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fixall-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User fixall-${ts}`,
        email: `test-fixall-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-fixall-${ts}`, name: `Collection fixall-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    platformId = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Copernicus", issuedYear: 1973 } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("removes from the two partly sold offers, leaves the three sold out, and fixes all five", async () => {
    const partlyA = await preparing(1, 1);
    const partlyB = await preparing(2, 2);
    const soldOut = [await preparing(0, 1), await preparing(0, 1), await preparing(0, 1)];
    const ids = [partlyA, partlyB, ...soldOut].map((o) => o.offerId);

    const flagged = await listOffersPaginated(userId, collectionId, { needsAction: true });
    const ticked = ids.map((id) => {
      const row = flagged.items.find((o) => o.id === id);
      assert.ok(row, "every one of the five is on Needs action");
      return row;
    });

    // The row lists exactly the sets the offer's own screen would remove.
    for (const { offerId, goneSets } of [partlyA, partlyB, ...soldOut]) {
      const row = ticked.find((o) => o.id === offerId)!;
      assert.deepEqual([...(row.soldElsewhere?.setIds ?? [])].sort(), [...goneSets].sort());
      const detail = (await getOfferDetail(userId, offerId))!;
      assert.deepEqual(
        detail.sets.filter((s) => s.soldElsewhere).map((s) => s.id).sort(),
        [...goneSets].sort()
      );
    }

    const removal = planSoldElsewhereRemoval(ticked);
    assert.deepEqual(removal.run.map((o) => o.id), [partlyA.offerId, partlyB.offerId]);
    assert.deepEqual(
      removal.leftAlone.map((l) => l.offer.id),
      soldOut.map((o) => o.offerId)
    );

    const fix = planFixEverything(ticked, { assistantUnavailable: null, queued: new Set() });
    assert.deepEqual(
      fix.fixes.map((f) => [f.offer.id, f.fix]),
      [
        [partlyA.offerId, "remove"],
        [partlyB.offerId, "remove"],
        ...soldOut.map((o) => [o.offerId, "withdraw"]),
      ]
    );

    for (const row of removal.run) {
      await removeOfferSetsSoldElsewhere(userId, row.id, row.soldElsewhere!.setIds);
    }
    const after = await listOffersPaginated(userId, collectionId, { needsAction: true });
    const stillFlagged = new Set(after.items.map((o) => o.id));
    for (const { offerId } of [partlyA, partlyB]) {
      assert.ok(!stillFlagged.has(offerId), "a cleaned offer leaves Needs action");
      const detail = (await getOfferDetail(userId, offerId))!;
      assert.equal(detail.state, "preparing");
      assert.equal(detail.sets.some((s) => s.soldElsewhere), false);
    }
    assert.equal((await getOfferDetail(userId, partlyB.offerId))!.sets.length, 2);
    for (const { offerId } of soldOut) assert.ok(stillFlagged.has(offerId), "the sold-out three are untouched");
  });
});
