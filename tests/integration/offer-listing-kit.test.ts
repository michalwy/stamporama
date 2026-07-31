import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, setOfferState } from "../../src/lib/offers";
import { setColnectConditionMapping } from "../../src/lib/colnect";
import { getOfferListingKit } from "../../src/lib/listing-kit";

// The listing kit (#405): one read that says what an offer wants filled into a marketplace form.
// The precondition rules themselves are unit-tested (`listing-preconditions.test.ts`); what needs a
// real database is the resolution behind them — the Colnect item-ID off the stamp (#247), the grade
// off the collection's condition mapping (#404), the quantity off the sets, and the refusal when any
// of the three has nothing to say.

describe("offer listing kit (#405)", () => {
  let userId: string;
  let collectionId: string;
  let otherUserId: string;
  let otherCollectionId: string;
  let platformId: string;
  let mnhId: string;
  let usedId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-kit-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User kit-${ts}`,
        email: `test-kit-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    otherUserId = `test-user-kit-other-${ts}`;
    await prisma.user.create({
      data: {
        id: otherUserId,
        name: `Test User kit other-${ts}`,
        email: `test-kit-other-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-kit-${ts}`,
          name: `Collection kit-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-kit-other-${ts}`,
          name: `Collection kit other-${ts}`,
          baseCurrency: "EUR",
          ownerId: otherUserId,
        },
      })
    ).id;
    mnhId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    usedId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 1 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Colnect",
          platform: true,
          platformModule: "colnect",
          platformCurrency: "EUR",
          descriptionTemplate: "Stamps as pictured.",
        },
      })
    ).id;
    // Only MNH is mapped to start with; the Used case is what the unmapped precondition rides on.
    await setColnectConditionMapping(userId, mnhId, "1");
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.collection.deleteMany({ where: { ownerId: otherUserId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  let seq = 0;

  /** A stamp carrying (or not) a Colnect item-ID (#247). */
  async function stamp(name: string, colnectId: string | null): Promise<string> {
    seq += 1;
    return (
      await prisma.stamp.create({ data: { collectionId, name: `${name} ${seq}`, colnectId } })
    ).id;
  }

  async function copy(stampId: string, conditionId = mnhId): Promise<string> {
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
  }

  /** An offer over the given sets, moved to `ready` unless asked otherwise. */
  async function offer(
    sets: string[][],
    over: { state?: "preparing" | "ready"; price?: string } = {}
  ): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: over.price ?? "12.50",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    for (const itemIds of sets) await addOfferSet(userId, offerId, itemIds);
    // Written directly rather than through `setOfferState`: several of these offers fail a listing
    // precondition on purpose — the endpoint's refusal is what is under test — and that same
    // evaluation now gates the transition (#418, `offer-ready-gate.test.ts`).
    if ((over.state ?? "ready") === "ready") {
      await prisma.offer.update({ where: { id: offerId }, data: { state: "ready" } });
    }
    return offerId;
  }

  it("serves the payload for a Ready offer: item-IDs, graded conditions, quantity, price, texts", async () => {
    const a = await stamp("PL a", "1001");
    const b = await stamp("PL b", "1002");
    const offerId = await offer([
      [await copy(a), await copy(b)],
      [await copy(a), await copy(b)],
    ]);

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.ok(kit);
    assert.deepEqual(kit.blockers, []);
    assert.equal(kit.state, "ready");
    assert.equal(kit.platform.name, "Colnect");
    assert.equal(kit.price, "12.50");
    assert.equal(kit.currency, "EUR");
    // Two interchangeable sets are one listing of quantity 2, described by one of them.
    assert.equal(kit.quantity, 2);
    assert.deepEqual(
      kit.items.map((i) => i.catalogItemId),
      ["1001", "1002"]
    );
    assert.deepEqual(
      kit.items.map((i) => [i.condition.platformValue, i.condition.platformLabel]),
      [
        ["1", "MNH - Mint Never Hinged"],
        ["1", "MNH - Mint Never Hinged"],
      ]
    );
    assert.equal(kit.description, "Stamps as pictured.");
    assert.equal(kit.descriptionFormat, "plain");
    assert.ok(kit.title.length > 0);
    // Nothing has been generated, so the upload set is empty rather than absent.
    assert.deepEqual(kit.photos.images, []);
    assert.equal(kit.photos.status, "none");
  });

  it("refuses a platform the Assistant has no module for, and says nothing else", async () => {
    const handListed = (
      await prisma.contact.create({
        data: { collectionId, name: "Delcampe", platform: true, platformCurrency: "EUR" },
      })
    ).id;
    const offerId = await createOffer(userId, collectionId, {
      platformId: handListed,
      url: null,
      price: "9.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await addOfferSet(userId, offerId, [await copy(await stamp("PL hand", null))]);
    await setOfferState(userId, offerId, "ready");

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["no-platform-module"]);
    assert.equal(kit?.platform.module, null);
  });

  it("refuses an offer that is not Ready", async () => {
    const offerId = await offer([[await copy(await stamp("PL c", "1003"))]], {
      state: "preparing",
    });
    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["not-ready"]);
  });

  it("refuses a copy whose stamp carries no Colnect item-ID, and names the stamp", async () => {
    const unmatched = await stamp("PL d", null);
    const offerId = await offer([[await copy(await stamp("PL e", "1004")), await copy(unmatched)]]);

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["missing-catalog-id"]);
    assert.deepEqual(kit?.blockers[0].stampIds, [unmatched]);
    // The payload still says what it knows — nothing is guessed into the gap.
    assert.deepEqual(
      kit?.items.map((i) => i.catalogItemId),
      ["1004", null]
    );
  });

  it("refuses a condition with no Colnect grade, then serves it once mapped", async () => {
    const offerId = await offer([[await copy(await stamp("PL f", "1005"), usedId)]]);

    const before = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(before?.blockers.map((b) => b.code), ["unmapped-condition"]);
    assert.deepEqual(before?.blockers[0].subjects, ["Used"]);
    assert.equal(before?.items[0].condition.platformValue, null);

    await setColnectConditionMapping(userId, usedId, "4");
    try {
      const after = await getOfferListingKit(userId, collectionId, offerId);
      assert.deepEqual(after?.blockers, []);
      assert.equal(after?.items[0].condition.platformValue, "4");
      assert.equal(after?.items[0].condition.platformLabel, "U - Used");
    } finally {
      await setColnectConditionMapping(userId, usedId, null);
    }
  });

  it("refuses sets that are not interchangeable — a quantity would misdescribe them", async () => {
    const a = await stamp("PL g", "1006");
    const b = await stamp("PL h", "1007");
    const offerId = await offer([[await copy(a)], [await copy(b)]]);

    const kit = await getOfferListingKit(userId, collectionId, offerId);
    assert.deepEqual(kit?.blockers.map((b) => b.code), ["mixed-sets"]);
    assert.equal(kit?.quantity, 2);
  });

  it("is null for another owner's offer and for the wrong collection", async () => {
    const offerId = await offer([[await copy(await stamp("PL i", "1008"))]]);
    assert.equal(await getOfferListingKit(otherUserId, collectionId, offerId), null);
    assert.equal(await getOfferListingKit(userId, otherCollectionId, offerId), null);
  });
});
