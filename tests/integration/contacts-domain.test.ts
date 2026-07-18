import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  listContacts,
  searchContacts,
  createContact,
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
    assert.equal(contact.platform, false);
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
    await createContact(userId, collectionId, { name: "Delcampe", platform: true });
    await createContact(userId, collectionId, { name: "Hans Meyer", seller: true });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("lists all contacts name-ordered", async () => {
    const contacts = await listContacts(userId, collectionId);
    assert.deepEqual(contacts.map((c) => c.name), ["Berlin Auktionen", "Delcampe", "Hans Meyer"]);
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
