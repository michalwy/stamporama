import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { listItemsPaginated } from "../../src/lib/items";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// A copy's row says it is in an open offer (#2337): the list read carries every open offer the copy
// is in — once per offer, a Preparing one included — and never a sold or withdrawn one.

describe("ItemListItem.openOffers (#2337)", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;
  let listedId: string;
  let closedOnlyId: string;
  let freeId: string;
  let activeOfferId: string;
  let preparingOfferId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-openoffers-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User openoffers-${ts}`,
        email: `test-openoffers-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-openoffers-${ts}`, name: `Collection openoffers-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    const conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Offered stamp" } })).id;
    const facebook = (await prisma.platform.create({ data: { collectionId, name: "Facebook" } })).id;
    const colnect = (await prisma.platform.create({ data: { collectionId, name: "Colnect" } })).id;

    let itemNo = 1;
    const addCopy = async () =>
      (
        await prisma.item.create({
          data: { collectionId, itemNo: itemNo++, stampId, conditionId, deliveryState: "delivered" },
          select: { id: true },
        })
      ).id;
    listedId = await addCopy();
    closedOnlyId = await addCopy();
    freeId = await addCopy();

    let offerNo = 3010;
    const addOffer = async (platformId: string, state: string, itemIds: string[], sets = 1) => {
      const offer = await prisma.offer.create({
        data: { collectionId, offerNo: offerNo++, platformId, currency: "EUR", price: "1.00", state },
      });
      for (let i = 0; i < sets; i++) {
        const set = await prisma.offerSet.create({ data: { offerId: offer.id } });
        for (const itemId of itemIds) await prisma.offerSetItem.create({ data: { offerSetId: set.id, itemId } });
      }
      return offer.id;
    };
    // In two sets of one active offer — still one offer.
    activeOfferId = await addOffer(facebook, "active", [listedId], 2);
    preparingOfferId = await addOffer(colnect, "preparing", [listedId]);
    await addOffer(colnect, "sold", [listedId, closedOnlyId]);
    await addOffer(facebook, "withdrawn", [closedOnlyId]);
  });

  after(async () => {
    await prisma.offerSetItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lists each open offer once, and no closed one", async () => {
    const { items } = await listItemsPaginated(
      userId,
      collectionId,
      readItemFilters(new URLSearchParams(`stampId=${stampId}`))
    );
    const byId = new Map(items.map((i) => [i.id, i]));
    const listed = byId.get(listedId)!.openOffers.sort((a, b) => a.offerNo - b.offerNo);
    assert.deepEqual(listed, [
      {
        offerId: activeOfferId,
        offerNo: 3010,
        platformName: "Facebook",
        state: "active",
        proposalId: null,
        facebookPostId: null,
      },
      {
        offerId: preparingOfferId,
        offerNo: 3011,
        platformName: "Colnect",
        state: "preparing",
        proposalId: null,
        facebookPostId: null,
      },
    ]);
    assert.deepEqual(byId.get(closedOnlyId)!.openOffers, []);
    assert.deepEqual(byId.get(freeId)!.openOffers, []);
  });
});
