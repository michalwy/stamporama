import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  listContacts,
  searchContacts,
  createContact,
  updateContact,
  ContactFieldError,
  ContactNameTakenError,
} from "../../src/lib/contacts";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-contact-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-contact-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-contact-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

describe("createContact", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`cc-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `cc-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("creates a contact with no roles set (create-on-type)", async () => {
    const contact = await createContact(userId, collectionId, { name: "Anon Seller" });
    assert.equal(contact.name, "Anon Seller");
    assert.equal(contact.buyer, false);
    assert.equal(contact.seller, false);
    assert.equal(contact.exchangePartner, false);
    assert.equal(contact.auctionHouse, false);
    assert.equal(contact.other, false);
    assert.equal(contact.notes, null);
    assert.equal(contact.email, null);
    assert.equal(contact.phone, null);
  });

  it("creates a contact holding several roles at once", async () => {
    const contact = await createContact(userId, collectionId, {
      name: "Corner Shop",
      email: "shop@example.com",
      buyer: true,
      seller: true,
      exchangePartner: true,
    });
    assert.equal(contact.buyer, true);
    assert.equal(contact.seller, true);
    assert.equal(contact.exchangePartner, true);
    assert.equal(contact.auctionHouse, false);
    assert.equal(contact.email, "shop@example.com");
  });

  it("trims the name and rejects a blank name", async () => {
    const contact = await createContact(userId, collectionId, { name: "  Spaced Out  " });
    assert.equal(contact.name, "Spaced Out");
    await assert.rejects(
      () => createContact(userId, collectionId, { name: "   " }),
      /name is required/i
    );
  });

  it("rejects a duplicate name in the same collection", async () => {
    await createContact(userId, collectionId, { name: "Unique Dealer" });
    await assert.rejects(
      () => createContact(userId, collectionId, { name: "Unique Dealer" }),
      (err) => err instanceof ContactNameTakenError
    );
  });

  it("throws when collection is not owned by user", async () => {
    await assert.rejects(
      () => createContact("wrong-user", collectionId, { name: "X" }),
      /access denied/i
    );
  });
});

describe("listContacts and searchContacts", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`ls-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `ls-${ts}`)).id;
    await createContact(userId, collectionId, { name: "Berlin Auktionen", auctionHouse: true });
    await createContact(userId, collectionId, { name: "Delcampe Buyer", buyer: true });
    await createContact(userId, collectionId, { name: "Hans Meyer", seller: true });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lists all contacts name-ordered", async () => {
    const contacts = await listContacts(userId, collectionId);
    assert.deepEqual(contacts.map((c) => c.name), ["Berlin Auktionen", "Delcampe Buyer", "Hans Meyer"]);
  });

  it("searches case-insensitively by name substring", async () => {
    const results = await searchContacts(userId, collectionId, "auk");
    assert.deepEqual(results.map((c) => c.name), ["Berlin Auktionen"]);
  });

  it("returns all contacts for an empty query", async () => {
    const results = await searchContacts(userId, collectionId, "");
    assert.equal(results.length, 3);
  });

  it("throws on search when collection is not owned by user", async () => {
    await assert.rejects(
      () => searchContacts("wrong-user", collectionId, ""),
      /access denied/i
    );
  });
});

describe("contact name uniqueness scope", () => {
  let userId: string;
  let collectionA: string;
  let collectionB: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`sc-${ts}`)).id;
    collectionA = (await createTestCollection(userId, `sc-a-${ts}`)).id;
    collectionB = (await createTestCollection(userId, `sc-b-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("allows the same name in a different collection", async () => {
    await createContact(userId, collectionA, { name: "Shared Name" });
    const b = await createContact(userId, collectionB, { name: "Shared Name" });
    assert.equal(b.name, "Shared Name");
  });
});

describe("contact referenced by a purchase (onDelete: Restrict)", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`rd-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `rd-${ts}`)).id;
  });

  after(async () => {
    // Detach purchases before the collection cascade so the Restrict FK doesn't block cleanup.
    await prisma.purchase.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("blocks deleting a contact still referenced by a purchase (ADR-0008 §4, ADR-0009)", async () => {
    // Supplier links moved from Item to Purchase (ADR-0009); the Restrict invariant
    // now protects a contact referenced as a purchase supplier.
    const contact = await createContact(userId, collectionId, { name: "Cornerstone Auctions" });
    await prisma.purchase.create({
      data: {
        collectionId,
        // Past the collection's counter: this row bypasses `allocateEntityNumber` (#432).
        purchaseNo: 9001,
        contactId: contact.id,
        purchasedAt: new Date("2024-05-01"),
        currency: "EUR",
      },
    });

    // The Restrict FK rejects the delete at the database level.
    await assert.rejects(() => prisma.contact.delete({ where: { id: contact.id } }));
  });
});

// A contact holds several Facebook profiles, and a profile is one contact's (#2042).
describe("a contact's Facebook profiles (#2042)", () => {
  let userId: string;
  let collectionId: string;

  before(async () => {
    const ts = Date.now();
    userId = (await createTestUser(`fbp-${ts}`)).id;
    collectionId = (await createTestCollection(userId, `fbp-${ts}`)).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const base = { name: "Ola Kot", buyer: true };

  it("keeps several, normalised, in the order given, blanks and repeats folded away", async () => {
    const contact = await createContact(userId, collectionId, {
      ...base,
      facebookProfileUrls: ["https://m.facebook.com/ola.kot/", "", "facebook.com/ola.kot", "https://www.facebook.com/ola.second"],
    });
    assert.deepEqual(contact.facebookProfileUrls, [
      "https://www.facebook.com/ola.kot",
      "https://www.facebook.com/ola.second",
    ]);
  });

  it("adds a further profile without losing any, leaves them alone when omitted, and takes off one removed", async () => {
    const contact = await createContact(userId, collectionId, {
      name: "Marek Lis",
      facebookProfileUrls: ["https://www.facebook.com/marek.lis"],
    });
    const added = await updateContact(userId, contact.id, {
      name: "Marek Lis",
      facebookProfileUrls: ["https://www.facebook.com/marek.lis", "https://www.facebook.com/marek.lis.2"],
    });
    assert.deepEqual(added.facebookProfileUrls, [
      "https://www.facebook.com/marek.lis",
      "https://www.facebook.com/marek.lis.2",
    ]);
    const untouched = await updateContact(userId, contact.id, { name: "Marek Lis", notes: "bids late" });
    assert.equal(untouched.facebookProfileUrls.length, 2, "an update that does not mention them keeps them");
    const removed = await updateContact(userId, contact.id, {
      name: "Marek Lis",
      facebookProfileUrls: ["https://www.facebook.com/marek.lis.2"],
    });
    assert.deepEqual(removed.facebookProfileUrls, ["https://www.facebook.com/marek.lis.2"]);
  });

  it("refuses a profile another contact holds, naming that contact, and writes nothing", async () => {
    const holder = await createContact(userId, collectionId, {
      name: "Ewa Nowak",
      facebookProfileUrls: ["https://www.facebook.com/ewa.nowak"],
    });
    await assert.rejects(
      createContact(userId, collectionId, {
        name: "Ewa N.",
        facebookProfileUrls: ["https://m.facebook.com/ewa.nowak"],
      }),
      (err: unknown) => err instanceof ContactFieldError && /already on the contact Ewa Nowak/.test(err.message)
    );
    assert.equal(await prisma.contact.count({ where: { collectionId, name: "Ewa N." } }), 0, "no contact half-made");

    const other = await createContact(userId, collectionId, { name: "Jan Kot" });
    await assert.rejects(
      updateContact(userId, other.id, {
        name: "Jan Kot (renamed)",
        facebookProfileUrls: ["https://www.facebook.com/ewa.nowak"],
      }),
      ContactFieldError
    );
    const after = await prisma.contact.findUniqueOrThrow({ where: { id: other.id } });
    assert.equal(after.name, "Jan Kot", "the refused save changed nothing");
    assert.equal(await prisma.contactFacebookProfile.count({ where: { contactId: holder.id } }), 1);
  });

  it("refuses a link that is not a profile", async () => {
    await assert.rejects(
      createContact(userId, collectionId, { name: "X", facebookProfileUrls: ["https://allegro.pl/uzytkownik/x"] }),
      ContactFieldError
    );
  });
});
