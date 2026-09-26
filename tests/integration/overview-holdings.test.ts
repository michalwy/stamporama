import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { countItems, createItem } from "../../src/lib/items";
import { setItemStamps } from "../../src/lib/item-stamps";
import { getOverviewHoldings } from "../../src/lib/overview";
import { HOLDINGS_FIGURES, holdingsFigureParams } from "../../src/lib/overview-rules";
import { exactCopiesListHref } from "../../src/app/c/[collectionSlug]/inventory/copies-list-filters";
import { readItemFilters } from "../../src/app/api/collections/[collectionId]/items/item-filters";

// The Overview's holdings tile (#1398), against a database: what it counts, what it leaves out, and
// that every figure is the Copies list's own count under the filter its link opens. That the link
// and the counted filter spell the same set is unit-tested in `overview-holdings.test.ts`.

const ts = Date.now();

describe("overview holdings (#1398)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let conditionId: string;
  const stampIds: string[] = [];

  async function copy(
    data: {
      inCollection?: boolean;
      forSale?: boolean;
      forTrade?: boolean;
      deliveryState?: string;
    } = {}
  ): Promise<string> {
    const { id } = await createItem(userId, collectionId, {
      stampId: stampIds[0],
      conditionId,
      ...data,
    });
    return id;
  }

  before(async () => {
    userId = `test-user-overview-holdings-${ts}`;
    strangerId = `test-user-overview-holdings-stranger-${ts}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: {
          id,
          name: id,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-overview-holdings-${ts}`,
          name: `Collection overview-holdings-${ts}`,
          baseCurrency: "PLN",
          ownerId: userId,
        },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    for (const name of ["One", "Two", "Three"]) {
      stampIds.push((await prisma.stamp.create({ data: { collectionId, name } })).id);
    }

    // Held and filed: in the collection only; in the collection and for sale — the overlap the tile
    // states; out of the collection and for trade.
    await copy();
    await copy({ forSale: true });
    await copy({ inCollection: false, forTrade: true });
    // One copy at each intake stage, each still in the collection by default.
    await copy({ deliveryState: "ordered" });
    await copy({ deliveryState: "in_transit" });
    await copy({ deliveryState: "to_sort" });
    // A cover carrying three stamps is one copy (#745).
    const cover = await copy();
    await setItemStamps(
      userId,
      cover,
      stampIds.map((stampId) => ({ stampId }))
    );

    // No longer held (#396): disposed, and sold.
    const lost = await copy();
    await prisma.item.update({
      where: { id: lost },
      data: { disposedAt: new Date(), disposalReason: "lost" },
    });
    const sold = await copy({ forSale: true });
    const platformId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
    const offer = await prisma.offer.create({
      data: { collectionId, offerNo: 1, platformId, currency: "EUR", price: "1.00" },
    });
    const offerSet = await prisma.offerSet.create({ data: { offerId: offer.id } });
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: 1, platformId, soldAt: new Date(), currency: "EUR" },
    });
    const line = await prisma.saleLine.create({
      data: { saleId: sale.id, offerId: offer.id, offerSetId: offerSet.id, price: "1.00" },
    });
    await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId: sold } });
  });

  after(async () => {
    await prisma.saleLineItem.deleteMany({ where: { item: { collectionId } } });
    await prisma.saleLine.deleteMany({ where: { sale: { collectionId } } });
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offerSet.deleteMany({ where: { offer: { collectionId } } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("counts held copies by disposition and intake stage, leaving out what is no longer held", async () => {
    assert.deepEqual(await getOverviewHoldings(userId, collectionId), {
      // Seven held: the sold and the disposed copy are not, and the cover counts once.
      total: 7,
      // Everything but the copy kept for trade outside the collection — the for-sale copy included,
      // so the dispositions add up to more than the total.
      inCollection: 6,
      forSale: 1,
      forTrade: 1,
      ordered: 1,
      inTransit: 1,
      toSort: 1,
    });
  });

  it("states each figure as the Copies list counts the rows its link opens", async () => {
    const holdings = await getOverviewHoldings(userId, collectionId);
    for (const figure of HOLDINGS_FIGURES) {
      const href = exactCopiesListHref("/c/x", holdingsFigureParams(figure));
      const listed = await countItems(
        userId,
        collectionId,
        readItemFilters(new URLSearchParams(href.slice(href.indexOf("?") + 1)))
      );
      assert.equal(holdings[figure.key], listed, figure.key);
    }
  });

  it("refuses a collection the caller does not own", async () => {
    await assert.rejects(getOverviewHoldings(strangerId, collectionId));
  });
});
