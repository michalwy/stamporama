import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, setOfferState, listOffersPaginated, getOfferDetail } from "../../src/lib/offers";
import { createSale, addSaleLines, listSellableOffers, SaleActionBlockedError } from "../../src/lib/sales";

// Offer-owned composition + cross-platform coordination (ADR-0013, #198). An offer owns its sets;
// the same physical copy can sit in sets across offers (the N:M thread), and each offer is tracked
// independently. This exercises:
//   - composing offers with sets and selling a set (whole-set integrity + no double sale);
//   - the "needs action" overlay: selling a copy flags the *other* offer holding it, not the one
//     it sold through;
//   - the quantity decrement (a partially-sold offer keeps its remaining sets sellable);
//   - the offer → sold flip once every set has sold through it.

describe("offer-owned composition + coordination", () => {
  let userId: string;
  let collectionId: string;
  let delcampeId: string;
  let allegroId: string;
  let x: string, y: string, z: string;
  let offerA: string, setA: string;
  let offerB: string, setB: string;
  let offerQD: string, setQDy: string, setQDz: string;
  let offerQA: string, setQAy: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-owned-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User owned-${ts}`,
        email: `test-owned-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-owned-${ts}`, name: `Collection owned-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp T" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    delcampeId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;
    allegroId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })).id;

    // Copies must be For sale + delivered to be composable.
    const mk = async () =>
      (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true })).id;
    x = await mk();
    y = await mk();
    z = await mk();

    // Overlap: copy x listed independently on two platforms.
    offerA = await createOffer(userId, collectionId, { platformId: delcampeId, url: null, price: "5.00", currency: "EUR" });
    setA = await addOfferSet(userId, offerA, [x]);
    offerB = await createOffer(userId, collectionId, { platformId: allegroId, url: null, price: "6.00", currency: "EUR" });
    setB = await addOfferSet(userId, offerB, [x]);

    // Quantity: copies y, z as separate single-copy sets, on both platforms.
    offerQD = await createOffer(userId, collectionId, { platformId: delcampeId, url: null, price: "10.00", currency: "EUR" });
    setQDy = await addOfferSet(userId, offerQD, [y]);
    setQDz = await addOfferSet(userId, offerQD, [z]);
    offerQA = await createOffer(userId, collectionId, { platformId: allegroId, url: null, price: "11.00", currency: "EUR" });
    setQAy = await addOfferSet(userId, offerQA, [y]);
    await addOfferSet(userId, offerQA, [z]);

    // These are live listings (#188): a new offer starts `preparing`, so publish each once its sets
    // are composed. Only `active` offers hold a live claim (needs-action / sellable derivations).
    for (const id of [offerA, offerB, offerQD, offerQA]) await setOfferState(userId, id, "active");
  });

  after(async () => {
    // Sales first: sale_line.offerSetId is Restrict, so sold sets can't cascade until the sale goes.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("composes offers that own their sets independently", async () => {
    const detailA = await getOfferDetail(userId, offerA);
    assert.equal(detailA?.sets.length, 1);
    assert.deepEqual(detailA?.sets[0].itemIds, [x]);
    const detailQD = await getOfferDetail(userId, offerQD);
    assert.equal(detailQD?.sets.length, 2, "the quantity offer holds two single-copy sets");
  });

  it("flags the other offer (not the selling one) once a shared copy sells", async () => {
    const saleId = await createSale(userId, collectionId, {
      platformId: delcampeId, buyerId: null, externalRef: null,
      soldAt: new Date(), currency: "EUR", buyerHandling: null, buyerPaidTotal: null, commission: null,
    });
    await addSaleLines(userId, saleId, [{ offerId: offerA, offerSetId: setA, price: "5.00", itemIds: [x] }]);

    const soldOffer = await prisma.offer.findUnique({ where: { id: offerA }, select: { state: true } });
    assert.equal(soldOffer?.state, "sold", "an offer whose every set sold through it flips to sold");

    const needs = await listOffersPaginated(userId, collectionId, { needsAction: true });
    const ids = needs.items.map((o) => o.id);
    assert.ok(ids.includes(offerB), "the other platform's offer needs action");
    assert.ok(!ids.includes(offerA), "the sold offer is not flagged");
    assert.equal(needs.items.find((o) => o.id === offerB)!.soldCopyCount, 1);

    const all = await listOffersPaginated(userId, collectionId, {});
    assert.equal(all.items.find((o) => o.id === offerB)!.needsAction, true);
  });

  it("blocks selling a copy that has already sold (no double sale)", async () => {
    const saleId = await createSale(userId, collectionId, {
      platformId: allegroId, buyerId: null, externalRef: null,
      soldAt: new Date(), currency: "EUR", buyerHandling: null, buyerPaidTotal: null, commission: null,
    });
    await assert.rejects(
      () => addSaleLines(userId, saleId, [{ offerId: offerB, offerSetId: setB, price: "6.00", itemIds: [x] }]),
      (e: unknown) => e instanceof SaleActionBlockedError && e.reason === "already-sold"
    );
  });

  it("keeps a partially-sold offer live and decrements it; flags the twin elsewhere", async () => {
    const saleId = await createSale(userId, collectionId, {
      platformId: delcampeId, buyerId: null, externalRef: null,
      soldAt: new Date(), currency: "EUR", buyerHandling: null, buyerPaidTotal: null, commission: null,
    });
    await addSaleLines(userId, saleId, [{ offerId: offerQD, offerSetId: setQDy, price: "5.00", itemIds: [y] }]);

    const qd = await prisma.offer.findUnique({ where: { id: offerQD }, select: { state: true } });
    assert.equal(qd?.state, "active", "the offer still has its z-set to sell");

    const needsIds = (await listOffersPaginated(userId, collectionId, { needsAction: true })).items.map((o) => o.id);
    assert.ok(!needsIds.includes(offerQD), "the selling offer keeps hanging — z is still for sale");
    assert.ok(needsIds.includes(offerQA), "the twin on the other platform must decrement (y is gone)");

    // Decrement: Delcampe's offer now exposes a single remaining sellable set (z).
    const sellable = (await listSellableOffers(userId, collectionId, { platformId: delcampeId })).find(
      (o) => o.offerId === offerQD
    );
    assert.ok(sellable, "the offer is still sellable for its remaining set");
    assert.equal(sellable!.sets.length, 1);
    assert.equal(sellable!.sets[0].offerSetId, setQDz);
    // (keeps setQAy referenced)
    assert.ok(setQAy);
  });

  it("flips the offer to sold once its last set sells through it", async () => {
    const saleId = await createSale(userId, collectionId, {
      platformId: delcampeId, buyerId: null, externalRef: null,
      soldAt: new Date(), currency: "EUR", buyerHandling: null, buyerPaidTotal: null, commission: null,
    });
    await addSaleLines(userId, saleId, [{ offerId: offerQD, offerSetId: setQDz, price: "5.00", itemIds: [z] }]);
    const qd = await prisma.offer.findUnique({ where: { id: offerQD }, select: { state: true } });
    assert.equal(qd?.state, "sold", "both sets sold through this offer → sold");
  });
});
