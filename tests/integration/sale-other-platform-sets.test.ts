import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  getOfferDetail,
  listOffersPaginated,
  markOfferListingClosed,
  setOfferState,
} from "../../src/lib/offers";
import {
  addSaleLines,
  createSale,
  getSaleDetail,
  listSellableOffers,
  recordSaleLinesThroughApi,
  removeSaleLine,
  type SaleHeaderInput,
  type SaleLineDraft,
} from "../../src/lib/sales";
import { getActionItems } from "../../src/lib/action-items";
import { getDirectPlatform } from "../../src/lib/proposals";

// Add sold sets takes sets from offers on any platform (#2343): a buyer on one platform takes a piece
// listed on another, through its offer. The offer is handled as when it sells on its own platform; a
// single-set offer sold out this way is flagged *to close* on its own platform until the collector
// says the listing is closed. Each case makes copies and offers of its own, so the cases never meet.

const ts = Date.now();

describe("Add sold sets from offers on other platforms (#2343)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  /** The sale's platform, in EUR. */
  let shopId: string;
  /** Another platform, in PLN — its listings are what the sales here take. */
  let otherId: string;
  let nextStamp = 0;

  async function copy(): Promise<string> {
    nextStamp += 1;
    const stampId = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp ${nextStamp}`,
          issuedYear: 1960,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" }))
      .id;
  }

  /** An active offer of `copies` fresh copies — one set each — on `platformId`. */
  async function activeOffer(platformId: string, currency: string, copies = 1): Promise<string> {
    const seedItemIds: string[] = [];
    for (let i = 0; i < copies; i++) seedItemIds.push(await copy());
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId, url: null, price: "10.00", startingPrice: null, currency, listingDate: null },
      { seedItemIds, seedPerCopy: true }
    );
    await setOfferState(userId, offerId, "ready");
    await setOfferState(userId, offerId, "active");
    return offerId;
  }

  async function sale(platformId = shopId): Promise<string> {
    const header: SaleHeaderInput = {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-02T00:00:00.000Z"),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    };
    return createSale(userId, collectionId, header);
  }

  /** The draft selling `count` of the offer's sets at `price`. */
  async function drafts(offerId: string, price: string, count = 1): Promise<SaleLineDraft[]> {
    const [sellable] = await listSellableOffers(userId, collectionId, { offerId });
    return sellable!.sets.slice(0, count).map((s) => ({ offerId, offerSetId: s.offerSetId, price, itemIds: s.itemIds }));
  }

  async function offerRow(offerId: string) {
    return prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { state: true, listingToCloseAt: true, listingContentChangedAt: true },
    });
  }

  before(async () => {
    userId = `test-user-sale-other-platform-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: "Test User",
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-sale-other-platform-${ts}`, name: "Cross-platform sales", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Germany" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    shopId = (await prisma.platform.create({ data: { collectionId, name: "Shop", platformCurrency: "EUR" } })).id;
    otherId = (await prisma.platform.create({ data: { collectionId, name: "Marketplace", platformCurrency: "PLN" } })).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("lists every platform's offers for a sale, leaving out another platform's in active bidding", async () => {
    const own = await activeOffer(shopId, "EUR");
    const ownBidding = await activeOffer(shopId, "EUR");
    const other = await activeOffer(otherId, "PLN");
    const otherBidding = await activeOffer(otherId, "PLN");
    await prisma.offer.updateMany({ where: { id: { in: [ownBidding, otherBidding] } }, data: { inActiveBidding: true } });

    const listed = new Set(
      (await listSellableOffers(userId, collectionId, { salePlatformId: shopId })).map((o) => o.offerId)
    );
    assert.ok(listed.has(own));
    assert.ok(listed.has(ownBidding), "a bid on the sale's own platform is what the sale resolves");
    assert.ok(listed.has(other));
    assert.ok(!listed.has(otherBidding));
  });

  it("sells a single-set offer from another platform: sold, flagged to close, marked on the sale", async () => {
    const saleId = await sale();
    const own = await activeOffer(shopId, "EUR");
    const other = await activeOffer(otherId, "PLN");
    // Listed in PLN, sold in the sale's EUR at a price typed for it.
    await addSaleLines(userId, saleId, [...(await drafts(own, "10.00")), ...(await drafts(other, "7.00"))]);

    const row = await offerRow(other);
    assert.equal(row.state, "sold");
    assert.ok(row.listingToCloseAt, "its listing on Marketplace is still up");
    assert.equal((await offerRow(own)).listingToCloseAt, null, "sold on its own platform, its listing ended there");

    const detail = await getSaleDetail(userId, saleId);
    const byOffer = new Map(detail!.lines.map((l) => [l.offerId, l]));
    assert.equal(byOffer.get(other)?.fromPlatformName, "Marketplace");
    assert.equal(byOffer.get(other)?.price, "7.00");
    assert.equal(byOffer.get(own)?.fromPlatformName, null);
  });

  it("puts the listing to close under Needs action, on the offer and in the bell, until it is marked closed", async () => {
    const saleId = await sale();
    const other = await activeOffer(otherId, "PLN");
    await addSaleLines(userId, saleId, await drafts(other, "7.00"));

    const needsAction = async () =>
      (await listOffersPaginated(userId, collectionId, { needsAction: true, pageSize: 500 })).items.find(
        (o) => o.id === other
      );
    const bell = async () =>
      (await getActionItems(userId, collectionId, 100)).groups
        .find((g) => g.id === "offer-listing-to-close")
        ?.items.some((i) => i.key === other) ?? false;

    assert.ok((await needsAction())?.listingToClose);
    assert.ok((await getOfferDetail(userId, other))?.listingToClose);
    assert.equal(await bell(), true);

    await markOfferListingClosed(userId, other);
    assert.equal(await needsAction(), undefined);
    assert.equal((await getOfferDetail(userId, other))?.listingToClose, null);
    assert.equal(await bell(), false);
    assert.equal((await offerRow(other)).state, "sold", "closing the listing leaves the offer sold");
  });

  it("takes one set of a quantity offer: one set fewer, its listing out of step, nothing to close", async () => {
    const saleId = await sale();
    const other = await activeOffer(otherId, "PLN", 2);
    await addSaleLines(userId, saleId, await drafts(other, "5.00"));

    const row = await offerRow(other);
    assert.equal(row.state, "active");
    assert.equal(row.listingToCloseAt, null);
    assert.ok(row.listingContentChangedAt, "the listing now offers one more than it has");
  });

  it("refuses an offer in active bidding on its own platform", async () => {
    const saleId = await sale();
    const other = await activeOffer(otherId, "PLN");
    const lines = await drafts(other, "7.00");
    await prisma.offer.update({ where: { id: other }, data: { inActiveBidding: true } });
    await assert.rejects(addSaleLines(userId, saleId, lines), /active bidding/);
  });

  it("still refuses an offer on the sale's own platform in another currency", async () => {
    const saleId = await sale();
    // Left on an old currency after the platform's changed (#197) — the one way an offer gets there.
    const stale = await activeOffer(shopId, "EUR");
    await prisma.offer.update({ where: { id: stale }, data: { currency: "PLN" } });
    await assert.rejects(addSaleLines(userId, saleId, await drafts(stale, "7.00")), /Re-list it/);
  });

  it("taking the set back off the sale opens the offer again, with nothing left to close", async () => {
    const saleId = await sale();
    const other = await activeOffer(otherId, "PLN");
    await addSaleLines(userId, saleId, await drafts(other, "7.00"));
    const line = (await getSaleDetail(userId, saleId))!.lines.find((l) => l.offerId === other)!;
    await removeSaleLine(userId, line.id);

    const row = await offerRow(other);
    assert.equal(row.state, "active");
    assert.equal(row.listingToCloseAt, null);
  });

  it("the agent API adds a set from another platform the same way", async () => {
    const saleId = await sale();
    const other = await activeOffer(otherId, "PLN");
    await recordSaleLinesThroughApi(userId, collectionId, { saleId }, await drafts(other, "7.00"), ["Sold #1"]);
    const row = await offerRow(other);
    assert.equal(row.state, "sold");
    assert.ok(row.listingToCloseAt);
  });

  it("never flags an offer on Direct, which is listed nowhere", async () => {
    const directId = (await getDirectPlatform(collectionId)).id;
    const saleId = await sale();
    const direct = await activeOffer(directId, "EUR");
    await addSaleLines(userId, saleId, await drafts(direct, "3.00"));
    const row = await offerRow(direct);
    assert.equal(row.state, "sold");
    assert.equal(row.listingToCloseAt, null);
  });
});
