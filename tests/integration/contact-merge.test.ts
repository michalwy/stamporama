import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createPurchase } from "../../src/lib/purchases";
import { createTrade } from "../../src/lib/trades";
import {
  createContact,
  getContactListItem,
  getContactMergePair,
  mergeContacts,
  ContactMergeError,
  type ContactCreateInput,
} from "../../src/lib/contacts";
import { lookupFacebookBuyer } from "../../src/lib/facebook-sales";

// Merging one contact into another (#2043), read back out of Prisma: every purchase, sale, trade,
// auction sale and price observation of the other contact moves to the remaining one, so do its
// Facebook profiles, the remaining one takes the details it lacked, both sets of roles and both
// notes, and the other is gone. The detail rules themselves are unit-tested
// (`tests/unit/contact-merge-rules.test.ts`).

const TS = Date.now();

describe("merging two contacts (#2043)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let platformId: string;
  let stampId: string;
  let saleNo = 0;

  before(async () => {
    userId = `test-user-contactmerge-${TS}`;
    strangerId = `test-user-contactmerge-stranger-${TS}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-contactmerge-${TS}`, name: "Contact merge", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    platformId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformModule: "facebook" } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Observed" } })).id;
  });

  after(async () => {
    for (const where of [{ collectionId }]) {
      await prisma.trade.deleteMany({ where });
      await prisma.sale.deleteMany({ where });
      await prisma.priceObservation.deleteMany({ where });
      await prisma.auctionSale.deleteMany({ where });
      await prisma.purchase.deleteMany({ where });
    }
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  /** A contact with one of everything that can name a contact. */
  async function contactWithHistory(name: string, data: Omit<ContactCreateInput, "name">) {
    const contact = await createContact(userId, collectionId, { ...data, name });
    await createPurchase(userId, collectionId, {
      contactId: contact.id,
      purchasedAt: "2026-10-01",
      currency: "EUR",
      status: "preparing",
    });
    await prisma.sale.create({
      data: {
        collectionId,
        platformId,
        buyerId: contact.id,
        saleNo: ++saleNo,
        soldAt: new Date("2026-10-10T00:00:00.000Z"),
        currency: "EUR",
        status: "ordered",
      },
    });
    await createTrade(userId, collectionId, { partnerId: contact.id, currency: "EUR" });
    await prisma.auctionSale.create({
      data: { collectionId, sellerId: contact.id, platformId, name: `${name}'s sale`, currency: "EUR" },
    });
    await prisma.priceObservation.create({
      data: {
        collectionId,
        stampId,
        price: "5.00",
        currency: "EUR",
        priceBasis: "hammer",
        soldOn: new Date("2026-09-01"),
        platformId,
        auctionHouseId: contact.id,
      },
    });
    return contact;
  }

  it("moves everything that names the other contact to the remaining one, and deletes the other", async () => {
    const jan = await contactWithHistory("Jan", {
      buyer: true,
      email: "jan@example.com",
      notes: "Pays fast",
      facebookProfileUrls: ["https://www.facebook.com/jan.one"],
    });
    const second = await contactWithHistory("jan_second", {
      exchangePartner: true,
      email: "second@example.com",
      phone: "600 100 200",
      fullName: "Jan Kowalski",
      notes: "Bids from a second account",
      facebookProfileUrls: ["https://www.facebook.com/jan.two"],
    });

    const pair = await getContactMergePair(userId, jan.id, second.id);
    assert.deepEqual(
      [
        pair.other.purchaseCount,
        pair.other.saleCount,
        pair.other.tradeCount,
        pair.other.auctionSaleCount,
        pair.other.priceObservationCount,
      ],
      [1, 1, 1, 1, 1]
    );

    await mergeContacts(userId, { remainingContactId: jan.id, otherContactId: second.id });

    assert.equal(await prisma.contact.findUnique({ where: { id: second.id } }), null);
    assert.equal(await prisma.purchase.count({ where: { contactId: jan.id } }), 2);
    assert.equal(await prisma.sale.count({ where: { buyerId: jan.id } }), 2);
    assert.equal(await prisma.trade.count({ where: { partnerId: jan.id } }), 2);
    assert.equal(await prisma.auctionSale.count({ where: { sellerId: jan.id } }), 2);
    assert.equal(await prisma.priceObservation.count({ where: { auctionHouseId: jan.id } }), 2);

    const merged = (await getContactListItem(userId, jan.id))!;
    assert.equal(merged.name, "Jan");
    // Its own email stays; the phone and full name it lacked come from the other.
    assert.equal(merged.email, "jan@example.com");
    assert.equal(merged.phone, "600 100 200");
    assert.equal(merged.fullName, "Jan Kowalski");
    assert.equal(merged.buyer, true);
    assert.equal(merged.exchangePartner, true);
    assert.equal(merged.notes, "Pays fast\n\nBids from a second account");
    assert.deepEqual(merged.facebookProfileUrls, [
      "https://www.facebook.com/jan.one",
      "https://www.facebook.com/jan.two",
    ]);
  });

  it("finds the merged contact by either Facebook profile afterwards", async () => {
    const one = await createContact(userId, collectionId, {
      name: "Ola",
      facebookProfileUrls: ["https://www.facebook.com/ola.one"],
    });
    const two = await createContact(userId, collectionId, {
      name: "Ola 2",
      facebookProfileUrls: ["https://www.facebook.com/ola.two"],
    });
    // The other way round: the contact whose page it is may be the one that goes.
    await mergeContacts(userId, { remainingContactId: two.id, otherContactId: one.id });
    for (const url of ["https://www.facebook.com/ola.one", "https://www.facebook.com/ola.two"]) {
      const found = await lookupFacebookBuyer(collectionId, { profileUrl: url, name: "" });
      assert.equal(found.contact?.id, two.id, url);
    }
  });

  it("refuses to merge a contact with itself", async () => {
    const solo = await createContact(userId, collectionId, { name: "Solo" });
    await assert.rejects(
      () => mergeContacts(userId, { remainingContactId: solo.id, otherContactId: solo.id }),
      ContactMergeError
    );
  });

  it("refuses a contact of another collection, and another owner's contacts", async () => {
    const mine = await createContact(userId, collectionId, { name: "Mine" });
    const otherCollection = await prisma.collection.create({
      data: { slug: `col-contactmerge-other-${TS}`, name: "Other", baseCurrency: "EUR", ownerId: strangerId },
    });
    const theirs = await prisma.contact.create({ data: { collectionId: otherCollection.id, name: "Theirs" } });
    await assert.rejects(
      () => mergeContacts(userId, { remainingContactId: mine.id, otherContactId: theirs.id }),
      ContactMergeError
    );
    await assert.rejects(() => mergeContacts(strangerId, { remainingContactId: mine.id, otherContactId: theirs.id }));
    assert.ok(await prisma.contact.findUnique({ where: { id: theirs.id } }));
    await prisma.collection.delete({ where: { id: otherCollection.id } });
  });
});
