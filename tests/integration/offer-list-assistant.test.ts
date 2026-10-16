import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  getOfferDetail,
  listOffersPaginated,
  setOfferInActiveBidding,
} from "../../src/lib/offers";
import { needsActionRemedy } from "../../src/lib/offer-needs-action-remedy";
import { addSaleLines, createSale } from "../../src/lib/sales";

// Update and close via the Assistant from the offers list (#1969), against a real database: a list
// row's Close-or-Update is the one the offer's own screen highlights (#1804), read off the same sets —
// a copy sold elsewhere, one in bidding elsewhere, nothing left to sell, a listing in step — and the
// sets an update removes first are the ones the screen would list.

describe("the offers list's Assistant facts (#1969)", () => {
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
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
  /** Live on Colnect, with the listing's address and sale code an update and a close need. Written
   *  straight to the row: Colnect's ready gate (catalogue item-IDs, grades) is not what is tested. */
  const goLive = async (id: string, code: string) => {
    await prisma.offer.update({
      where: { id },
      data: {
        state: "active",
        url: `https://colnect.com/en/stamps/sale/sale_id/${code}`,
        colnectSaleId: code,
        listingContentChangedAt: null,
      },
    });
  };

  before(async () => {
    const ts = Date.now();
    userId = `test-user-listassistant-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User listassistant-${ts}`,
        email: `test-listassistant-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-listassistant-${ts}`, name: `Collection listassistant-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.platform.create({
        data: { collectionId, name: "Colnect", platformModule: "colnect", platformCurrency: "EUR" },
      })
    ).id;
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
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("offers on each row the action the offer's screen highlights", async () => {
    const [lastCopy, keptCopy, goneCopy, bidCopy, quietCopy] = [
      await newItem(),
      await newItem(),
      await newItem(),
      await newItem(),
      await newItem(),
    ];
    // Its only set sold through another offer: Close.
    const toClose = await newOffer();
    await addOfferSet(userId, toClose, [lastCopy]);
    // A set sold elsewhere beside one still for sale: Update, removing that set first.
    const toUpdate = await newOffer();
    await addOfferSet(userId, toUpdate, [keptCopy]);
    const goneSet = await addOfferSet(userId, toUpdate, [goneCopy]);
    // A copy another live auction is being bid on: Update.
    const bidOn = await newOffer();
    await addOfferSet(userId, bidOn, [bidCopy]);
    // In step: nothing highlighted, both actions still possible from the offer's screen.
    const inStep = await newOffer();
    await addOfferSet(userId, inStep, [quietCopy]);

    const seller = await newOffer();
    const sellerLast = await addOfferSet(userId, seller, [lastCopy]);
    const sellerGone = await addOfferSet(userId, seller, [goneCopy]);
    const bidder = await newOffer();
    await addOfferSet(userId, bidder, [bidCopy]);

    for (const [id, code] of [
      [toClose, "c1"],
      [toUpdate, "c2"],
      [bidOn, "c3"],
      [inStep, "c4"],
      [seller, "c5"],
      [bidder, "c6"],
    ] as const) {
      await goLive(id, code);
    }
    await setOfferInActiveBidding(userId, bidder, true);
    await addSaleLines(userId, saleId, [
      { offerId: seller, offerSetId: sellerLast, price: "10.00", itemIds: [lastCopy] },
      { offerId: seller, offerSetId: sellerGone, price: "10.00", itemIds: [goneCopy] },
    ]);

    const { items } = await listOffersPaginated(userId, collectionId, { pageSize: 50 });
    const row = (id: string) => items.find((o) => o.id === id)!;

    for (const id of [toClose, toUpdate, bidOn, inStep]) {
      const detail = await getOfferDetail(userId, id);
      assert.ok(detail);
      const screen = needsActionRemedy({
        state: detail.state,
        needsAction: detail.needsAction,
        listingOutOfDate: detail.listingOutOfDate !== null,
        sets: detail.sets,
      });
      assert.deepEqual(row(id).assistant?.remedy ?? null, screen, `row and screen agree for ${id}`);
      assert.deepEqual(
        row(id).assistant?.soldElsewhereSetIds,
        detail.sets.filter((s) => s.soldElsewhere).map((s) => s.id)
      );
    }

    assert.equal(row(toClose).assistant?.remedy?.action, "close");
    assert.equal(row(toUpdate).assistant?.remedy?.action, "update");
    assert.deepEqual(row(toUpdate).assistant?.soldElsewhereSetIds, [goneSet]);
    assert.equal(row(bidOn).assistant?.remedy?.action, "update");
    assert.equal(row(bidOn).assistant?.remedy?.hint, "A copy is in bidding elsewhere — update the listing");
    assert.equal(row(inStep).assistant?.remedy, null);
    assert.equal(row(inStep).assistant?.closeSaleId, "c4");
    assert.equal(row(inStep).assistant?.update, true);
    // The offer that sold them is sold out and no longer Active: nothing for the Assistant to do.
    const closed = await listOffersPaginated(userId, collectionId, { pageSize: 50, includeClosed: true });
    assert.equal(closed.items.find((o) => o.id === seller)?.assistant, null);
  });

  it("carries nothing on an offer that is not Active", async () => {
    const offerId = await newOffer();
    await addOfferSet(userId, offerId, [await newItem()]);
    const { items } = await listOffersPaginated(userId, collectionId, { pageSize: 50 });
    assert.equal(items.find((o) => o.id === offerId)?.assistant, null);
  });
});
