import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState, listComposableCopies } from "../../src/lib/offers";
import { listStockCopiesForSale } from "../../src/lib/sales";

// *Not on any open offer* (#2338): the copies on no offer on any platform, open meaning any state but
// sold or withdrawn — a Preparing offer counts. In a picker opened from an offer, a proposal or a
// post, that screen's own offers do not count against a copy.

describe("not on any open offer (#2338)", () => {
  let userId: string;
  let collectionId: string;
  let platformA: string;
  let platformB: string;
  let free: string, preparing: string, active: string, withdrawn: string, sold: string, own: string;
  let preparingOffer: string, ownOffer: string, proposalId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-noo-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User noo-${ts}`,
        email: `test-noo-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-noo-${ts}`, name: `Collection noo-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Kite" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    platformA = (await prisma.platform.create({ data: { collectionId, name: "Delcampe" } })).id;
    platformB = (await prisma.platform.create({ data: { collectionId, name: "Allegro" } })).id;

    const copy = async () =>
      (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true })).id;
    free = await copy();
    preparing = await copy();
    active = await copy();
    withdrawn = await copy();
    sold = await copy();
    own = await copy();

    const offer = async (platformId: string, itemIds: string[]) => {
      const id = await createOffer(userId, collectionId, {
        platformId,
        url: null,
        price: "5.00",
        currency: "EUR",
        listingDate: null,
      });
      await addOfferSet(userId, id, itemIds);
      return id;
    };
    preparingOffer = await offer(platformA, [preparing]);
    const activeOffer = await offer(platformB, [active]);
    await setOfferState(userId, activeOffer, "ready");
    await setOfferState(userId, activeOffer, "active");
    const withdrawnOffer = await offer(platformA, [withdrawn]);
    await setOfferState(userId, withdrawnOffer, "withdrawn");
    const soldOffer = await offer(platformB, [sold]);
    // Sold is reached through a sale in the app; the state is what this filter reads.
    await prisma.offer.update({ where: { id: soldOffer }, data: { state: "sold" } });
    ownOffer = await offer(platformB, [own]);
    // The proposal's lot: an offer naming it, as a proposal's lots are.
    const contact = await prisma.contact.create({ data: { collectionId, name: "Anna" } });
    proposalId = (await prisma.proposal.create({ data: { collectionId, proposalNo: 1, contactId: contact.id } })).id;
    await prisma.offer.update({ where: { id: ownOffer }, data: { proposalId } });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("keeps only the copies on no open offer, a Preparing one counting", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, { notOnOpenOffer: true });
    assert.deepEqual(
      new Set(items.map((i) => i.id)),
      new Set([free, withdrawn, sold]),
      "a sold or withdrawn offer holds nothing back; a Preparing or Active one does"
    );
  });

  it("does not count the screen's own offer", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, {
      notOnOpenOffer: true,
      openOfferExcept: { offerId: ownOffer },
    });
    const ids = items.map((i) => i.id);
    assert.ok(ids.includes(own), "the screen's own offer does not count against its copy");
    assert.ok(!ids.includes(preparing), "every other open offer still does");
  });

  it("does not count a proposal's own lots, while offers on no proposal still count", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, {
      notOnOpenOffer: true,
      openOfferExcept: { proposalId },
    });
    assert.deepEqual(new Set(items.map((i) => i.id)), new Set([free, withdrawn, sold, own]));
  });

  it("combines with Not offered on…", async () => {
    const { items } = await listItemsPaginated(userId, collectionId, {
      notOnOpenOffer: true,
      notOfferedPlatformId: platformA,
    });
    assert.ok(!items.some((i) => i.id === active), "on an open offer elsewhere, so not on no open offer");
    assert.ok(items.some((i) => i.id === free));
  });

  it("narrows the offer picker, the offer itself not counting", async () => {
    const all = await listComposableCopies(userId, collectionId, { offerId: preparingOffer });
    assert.ok(all.some((i) => i.id === active), "off, every eligible copy");
    const narrowed = await listComposableCopies(userId, collectionId, {
      offerId: preparingOffer,
      notOnOpenOffer: true,
    });
    assert.deepEqual(new Set(narrowed.map((i) => i.id)), new Set([free, withdrawn, sold]));
  });

  it("narrows the new-lots picker, the proposal's own lots not counting", async () => {
    const narrowed = await listComposableCopies(userId, collectionId, {
      notOnOpenOffer: true,
      ownOffers: { proposalId },
    });
    const ids = narrowed.map((i) => i.id);
    assert.ok(ids.includes(own));
    assert.ok(!ids.includes(active));
  });

  it("narrows the sale's stock picker", async () => {
    const items = await listStockCopiesForSale(userId, collectionId, { notOnOpenOffer: true });
    const ids = items.map((i) => i.id);
    assert.ok(ids.includes(free));
    assert.ok(!ids.includes(preparing) && !ids.includes(active) && !ids.includes(own));
  });
});
