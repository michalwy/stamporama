import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  addOfferSet,
  duplicateOffer,
  getOfferDetail,
  updateOfferSet,
  setOfferState,
} from "../../src/lib/offers";
import { createSale, addSaleLines } from "../../src/lib/sales";

// Duplicate an offer onto another platform (#200, ADR-0013 §1). The clone is an independent
// snapshot: same sets + item membership, on a new platform, as a fresh `preparing` draft. Copies
// that have already sold elsewhere are skipped, and a set left empty by that is dropped.

describe("duplicate offer (list on another platform)", () => {
  let userId: string;
  let collectionId: string;
  let delcampeId: string;
  let allegroId: string;
  let a: string, b: string, c: string;
  let source: string, komplet: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-dup-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User dup-${ts}`,
        email: `test-dup-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: { slug: `col-dup-${ts}`, name: `Collection dup-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;

    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp D" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    delcampeId = (await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })).id;
    // Allegro already has a locked currency (#196) — the clone must inherit PLN, ignoring any fallback.
    allegroId = (await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true, platformCurrency: "PLN" } })).id;

    const mk = async () =>
      (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true })).id;
    a = await mk();
    b = await mk();
    c = await mk();

    // Source offer: a single-copy set (a) and a two-copy komplet (b + c).
    source = await createOffer(userId, collectionId, { platformId: delcampeId, url: "https://del/x", price: "9.00", currency: "EUR" });
    await addOfferSet(userId, source, [a]);
    komplet = await addOfferSet(userId, source, [b, c], "Pair");
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("clones sets + membership into a fresh preparing draft on the new platform", async () => {
    const { id, skippedCopies } = await duplicateOffer(userId, source, {
      platformId: allegroId,
      url: null,
      price: "12.00",
      currency: "USD", // ignored — Allegro is locked to PLN
    });
    assert.equal(skippedCopies, 0);

    const clone = await getOfferDetail(userId, id);
    assert.equal(clone?.state, "preparing", "the clone starts as a draft");
    assert.equal(clone?.platformName, "Allegro");
    assert.equal(clone?.currency, "PLN", "currency is inherited + locked from the platform");
    assert.equal(Number(clone?.price), 12, "the asking price carries over");
    assert.equal(clone?.url, null, "the listing URL starts blank");

    assert.equal(clone?.sets.length, 2);
    const membership = clone!.sets.map((s) => [...s.itemIds].sort()).sort();
    assert.deepEqual(membership, [[a], [b, c].sort()].sort());
    assert.ok(clone!.sets.some((s) => s.itemIds.length === 2), "the komplet is preserved as one set");
  });

  it("is an independent snapshot — editing one offer does not touch the other", async () => {
    const { id: cloneId } = await duplicateOffer(userId, source, {
      platformId: allegroId, url: null, price: "12.00", currency: "PLN",
    });
    // Rename the source komplet; the clone's copy of it must be unaffected.
    await updateOfferSet(userId, komplet, "Renamed on source");

    const cloneSets = await prisma.offerSet.findMany({ where: { offerId: cloneId }, select: { title: true } });
    assert.ok(!cloneSets.some((s) => s.title === "Renamed on source"), "clone keeps its own set snapshot");
    const sourceSet = await prisma.offerSet.findUnique({ where: { id: komplet }, select: { title: true } });
    assert.equal(sourceSet?.title, "Renamed on source");
  });

  it("skips copies that have already sold, dropping a set left empty", async () => {
    // Sell copy `a` through a separate offer so it is globally retired.
    const other = await createOffer(userId, collectionId, { platformId: delcampeId, url: null, price: "9.00", currency: "EUR" });
    const otherSet = await addOfferSet(userId, other, [a]);
    await setOfferState(userId, other, "active"); // only a live listing can sell
    const saleId = await createSale(userId, collectionId, {
      platformId: delcampeId, buyerId: null, externalRef: null,
      soldAt: new Date(), currency: "EUR", buyerHandling: null, commission: null,
    });
    await addSaleLines(userId, saleId, [{ offerId: other, offerSetId: otherSet, price: "9.00", itemIds: [a] }]);

    const { id, skippedCopies } = await duplicateOffer(userId, source, {
      platformId: allegroId, url: null, price: "12.00", currency: "PLN",
    });
    assert.equal(skippedCopies, 1, "the sold copy is skipped");

    const clone = await getOfferDetail(userId, id);
    assert.equal(clone?.sets.length, 1, "the single-copy set for the sold copy is dropped");
    assert.deepEqual([...clone!.sets[0].itemIds].sort(), [b, c].sort(), "the komplet survives intact");
  });
});
