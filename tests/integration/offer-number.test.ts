import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  createOffer,
  duplicateOffer,
  deleteOffer,
  listOffersPaginated,
} from "../../src/lib/offers";

// The short per-collection listing number (#416) and the `{offerUrl}` address built from it (#415).
// The number's rules are the copy number's rules (#268) — sequential from a counter, never
// `max + 1` — because it ends up published in a marketplace private note, where it must not come to
// mean a different listing.

describe("offer number (#416)", () => {
  let userId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let collectionSlug: string;
  let platformId: string;
  let otherPlatformId: string;
  let stampId: string;
  let conditionId: string;

  const BASE_URL = "https://stamps.example";

  before(async () => {
    const ts = Date.now();
    userId = `test-user-offerno-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offerno-${ts}`,
        email: `test-offerno-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionSlug = `col-offerno-${ts}`;
    const col = await prisma.collection.create({
      data: { slug: collectionSlug, name: `Collection offerno-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    collectionId = col.id;
    const other = await prisma.collection.create({
      data: { slug: `col-offerno-other-${ts}`, name: `Other offerno-${ts}`, baseCurrency: "EUR", ownerId: userId },
    });
    otherCollectionId = other.id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Stamp N" } })).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "NumberMarket",
          platform: true,
          platformCurrency: "EUR",
          // The private note is what the address is for, so this is the template under test.
          privateNoteTemplate: "{offerUrl}",
        },
      })
    ).id;
    otherPlatformId = (
      await prisma.contact.create({
        data: { collectionId: otherCollectionId, name: "OtherMarket", platform: true, platformCurrency: "EUR" },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  async function newOffer(): Promise<string> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    return createOffer(
      userId,
      collectionId,
      {
        platformId,
        url: null,
        price: "5.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      },
      { seedItemIds: [item.id] }
    );
  }

  async function numberOf(offerId: string): Promise<number> {
    const offer = await prisma.offer.findUniqueOrThrow({
      where: { id: offerId },
      select: { offerNo: true },
    });
    return offer.offerNo;
  }

  it("hands out consecutive numbers within a collection", async () => {
    const first = await numberOf(await newOffer());
    const second = await numberOf(await newOffer());
    assert.equal(second, first + 1);
  });

  it("reaches the offers list, which is where it is read off (#470)", async () => {
    const id = await newOffer();
    const { items } = await listOffersPaginated(userId, collectionId, { pageSize: 100 });
    const row = items.find((o) => o.id === id);
    assert.ok(row, "the new offer should be on the list");
    assert.equal(row.offerNo, await numberOf(id));
  });

  it("does not reuse the number of a deleted offer", async () => {
    const doomed = await newOffer();
    const doomedNo = await numberOf(doomed);
    await deleteOffer(userId, doomed);
    const next = await numberOf(await newOffer());
    assert.ok(next > doomedNo, `expected a fresh number after ${doomedNo}, got ${next}`);
  });

  it("numbers a duplicated offer too", async () => {
    const source = await newOffer();
    const { id } = await duplicateOffer(userId, source, {
      platformId,
      url: null,
      price: "6.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    assert.ok((await numberOf(id)) > (await numberOf(source)));
  });

  it("counts per collection — a sibling collection's counter is untouched", async () => {
    await newOffer();
    const other = await prisma.collection.findUniqueOrThrow({
      where: { id: otherCollectionId },
      select: { nextOfferNo: true },
    });
    assert.equal(other.nextOfferNo, 1);
    // …and its own first offer starts at 1, not after this collection's numbering.
    const otherItemStamp = await prisma.stamp.create({
      data: { collectionId: otherCollectionId, name: "Stamp O" },
    });
    const otherCondition = await prisma.stampCondition.create({
      data: { collectionId: otherCollectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const item = await createItem(userId, otherCollectionId, {
      stampId: otherItemStamp.id,
      conditionId: otherCondition.id,
      forSale: true,
    });
    const offerId = await createOffer(
      userId,
      otherCollectionId,
      {
        platformId: otherPlatformId,
        url: null,
        price: "5.00",
        currency: "EUR",
        listingDate: null,
        state: "preparing",
      },
      { seedItemIds: [item.id] }
    );
    assert.equal(await numberOf(offerId), 1);
  });

  it("renders {offerUrl} as the short address, well inside a 100-character field", async () => {
    const previous = process.env.BETTER_AUTH_URL;
    process.env.BETTER_AUTH_URL = BASE_URL;
    try {
      const offerId = await newOffer();
      const offer = await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { offerNo: true, privateNote: true },
      });
      assert.equal(offer.privateNote, `${BASE_URL}/o/${collectionSlug}/${offer.offerNo}`);
      // The whole reason for the number: Colnect's note field allows 100 (#402).
      assert.ok(offer.privateNote!.length < 100, `${offer.privateNote!.length} characters`);
    } finally {
      process.env.BETTER_AUTH_URL = previous;
    }
  });

  it("leaves {offerUrl} empty when the instance has no base URL configured", async () => {
    const previous = process.env.BETTER_AUTH_URL;
    delete process.env.BETTER_AUTH_URL;
    try {
      const offerId = await newOffer();
      const offer = await prisma.offer.findUniqueOrThrow({
        where: { id: offerId },
        select: { privateNote: true },
      });
      assert.equal(offer.privateNote, null);
    } finally {
      if (previous === undefined) delete process.env.BETTER_AUTH_URL;
      else process.env.BETTER_AUTH_URL = previous;
    }
  });
});
