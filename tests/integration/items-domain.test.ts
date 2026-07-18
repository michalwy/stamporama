import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  createItem,
  getItem,
  listItems,
  updateItem,
  deleteItem,
  getItemVariantHistory,
  resolveItemVariant,
} from "../../src/lib/items";

async function createTestUser(suffix: string) {
  return prisma.user.create({
    data: {
      id: `test-user-item-${suffix}`,
      name: `Test User ${suffix}`,
      email: `test-item-${suffix}@example.com`,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    },
  });
}

async function createTestCollection(ownerId: string, suffix: string) {
  return prisma.collection.create({
    data: { slug: `col-item-${suffix}`, name: `Collection ${suffix}`, baseCurrency: "EUR", ownerId },
  });
}

/** A minimal collection with one base stamp, one variant, one condition, one
 * certificate status — the entities an Item references. */
async function seedFixtures(suffix: string) {
  const userId = (await createTestUser(suffix)).id;
  const collectionId = (await createTestCollection(userId, suffix)).id;
  const baseStamp = await prisma.stamp.create({ data: { collectionId, name: "Stamp 2" } });
  const variant = await prisma.stamp.create({
    data: { collectionId, name: "Stamp 2a", parentId: baseStamp.id },
  });
  const condition = await prisma.stampCondition.create({
    data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
  });
  const condition2 = await prisma.stampCondition.create({
    data: { collectionId, name: "Mint Never Hinged", abbreviation: "MNH", sortOrder: 1 },
  });
  const cert = await prisma.certificateStatus.create({
    data: { collectionId, name: "Certified", abbreviation: "C", sortOrder: 0 },
  });
  return { userId, collectionId, baseStamp, variant, condition, condition2, cert };
}

async function cleanup(userId: string) {
  await prisma.collection.deleteMany({ where: { ownerId: userId } });
  await prisma.user.delete({ where: { id: userId } });
}

describe("createItem", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`create-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("creates a copy with disposition defaults, a decimal purchase price, and a source contact", async () => {
    const contact = await prisma.contact.create({
      data: { collectionId: f.collectionId, name: "eBay" },
    });
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
      purchasePrice: "12.50",
      purchaseCurrency: "EUR",
      contactId: contact.id,
      acquiredDate: "2024-05-01",
      notes: "commemorative postmark",
    });
    assert.equal(item.stampId, f.baseStamp.id);
    assert.equal(item.inCollection, true);
    assert.equal(item.forSale, false);
    assert.equal(item.forTrade, false);
    assert.equal(item.purchasePrice, "12.5");
    assert.equal(item.purchaseCurrency, "EUR");
    assert.equal(item.contactId, contact.id);
    assert.equal(item.acquiredDate, "2024-05-01");
    assert.equal(item.notes, "commemorative postmark");
  });

  it("rejects a contact from another collection", async () => {
    const other = await seedFixtures(`othercontact-${Date.now()}`);
    const otherContact = await prisma.contact.create({
      data: { collectionId: other.collectionId, name: "Foreign dealer" },
    });
    await assert.rejects(
      () =>
        createItem(f.userId, f.collectionId, {
          stampId: f.baseStamp.id,
          conditionId: f.condition.id,
          contactId: otherContact.id,
        }),
      /contact not found in this collection/i
    );
    await cleanup(other.userId);
  });

  it("accepts a certificate status and explicit disposition flags", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.variant.id,
      conditionId: f.condition.id,
      certificateStatusId: f.cert.id,
      inCollection: false,
      forSale: true,
      forTrade: true,
    });
    assert.equal(item.certificateStatusId, f.cert.id);
    assert.equal(item.inCollection, false);
    assert.equal(item.forSale, true);
    assert.equal(item.forTrade, true);
  });

  it("rejects a stamp from another collection", async () => {
    const other = await seedFixtures(`other-${Date.now()}`);
    await assert.rejects(
      () =>
        createItem(f.userId, f.collectionId, {
          stampId: other.baseStamp.id,
          conditionId: f.condition.id,
        }),
      /stamp not found in this collection/i
    );
    await cleanup(other.userId);
  });

  it("rejects a condition from another collection", async () => {
    const other = await seedFixtures(`othercond-${Date.now()}`);
    await assert.rejects(
      () =>
        createItem(f.userId, f.collectionId, {
          stampId: f.baseStamp.id,
          conditionId: other.condition.id,
        }),
      /condition not found in this collection/i
    );
    await cleanup(other.userId);
  });

  it("rejects when collection is not owned by user", async () => {
    await assert.rejects(
      () =>
        createItem("wrong-user", f.collectionId, {
          stampId: f.baseStamp.id,
          conditionId: f.condition.id,
        }),
      /access denied/i
    );
  });
});

describe("getItem / listItems", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`list-${Date.now()}`);
    await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
      forSale: true,
    });
    await createItem(f.userId, f.collectionId, {
      stampId: f.variant.id,
      conditionId: f.condition2.id,
      forTrade: true,
    });
  });
  after(() => cleanup(f.userId));

  it("lists all copies in the collection", async () => {
    const items = await listItems(f.userId, f.collectionId);
    assert.equal(items.length, 2);
  });

  it("filters by disposition flag", async () => {
    const forSale = await listItems(f.userId, f.collectionId, { forSale: true });
    assert.equal(forSale.length, 1);
    assert.equal(forSale[0].forSale, true);
  });

  it("filters by condition", async () => {
    const byCondition = await listItems(f.userId, f.collectionId, {
      conditionId: f.condition2.id,
    });
    assert.equal(byCondition.length, 1);
    assert.equal(byCondition[0].conditionId, f.condition2.id);
  });

  it("getItem returns a single copy", async () => {
    const [first] = await listItems(f.userId, f.collectionId);
    const item = await getItem(f.userId, first.id);
    assert.equal(item.id, first.id);
  });

  it("getItem rejects a foreign owner", async () => {
    const [first] = await listItems(f.userId, f.collectionId);
    await assert.rejects(() => getItem("wrong-user", first.id), /access denied/i);
  });
});

describe("updateItem", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`update-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("updates fields without touching stampId (no history row)", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    const updated = await updateItem(f.userId, item.id, {
      forSale: true,
      notes: "updated note",
      purchasePrice: "9.99",
    });
    assert.equal(updated.forSale, true);
    assert.equal(updated.notes, "updated note");
    assert.equal(updated.purchasePrice, "9.99");
    assert.equal(updated.stampId, f.baseStamp.id);
    const history = await getItemVariantHistory(f.userId, item.id);
    assert.equal(history.length, 0);
  });

  it("re-points stampId and appends a variant-history row in one transaction", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    const updated = await updateItem(f.userId, item.id, {
      stampId: f.variant.id,
      variantChangeNote: "identified as 2a",
    });
    assert.equal(updated.stampId, f.variant.id);
    const history = await getItemVariantHistory(f.userId, item.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].fromStampId, f.baseStamp.id);
    assert.equal(history[0].toStampId, f.variant.id);
    assert.equal(history[0].note, "identified as 2a");
  });

  it("does not append history when stampId is set to its current value", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.variant.id,
      conditionId: f.condition.id,
    });
    await updateItem(f.userId, item.id, { stampId: f.variant.id, forTrade: true });
    const history = await getItemVariantHistory(f.userId, item.id);
    assert.equal(history.length, 0);
  });

  it("rejects re-pointing to a stamp from another collection", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    const other = await seedFixtures(`updforeign-${Date.now()}`);
    await assert.rejects(
      () => updateItem(f.userId, item.id, { stampId: other.baseStamp.id }),
      /stamp not found in this collection/i
    );
    await cleanup(other.userId);
  });

  it("rejects a foreign owner", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    await assert.rejects(
      () => updateItem("wrong-user", item.id, { forSale: true }),
      /access denied/i
    );
  });
});

describe("resolveItemVariant", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`resolve-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("re-points an unknown-variant copy to a descendant and appends labelled history", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    const resolved = await resolveItemVariant(
      f.userId,
      item.id,
      f.variant.id,
      "watermark confirmed"
    );
    assert.equal(resolved.stampId, f.variant.id);
    const history = await getItemVariantHistory(f.userId, item.id);
    assert.equal(history.length, 1);
    assert.equal(history[0].fromStampId, f.baseStamp.id);
    assert.equal(history[0].toStampId, f.variant.id);
    assert.equal(history[0].fromStampLabel, "Stamp 2");
    assert.equal(history[0].toStampLabel, "Stamp 2a");
    assert.equal(history[0].note, "watermark confirmed");
  });

  it("resolves through multiple tree levels (grandchild descendant)", async () => {
    const subVariant = await prisma.stamp.create({
      data: { collectionId: f.collectionId, name: "Stamp 2a-i", parentId: f.variant.id },
    });
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    const resolved = await resolveItemVariant(f.userId, item.id, subVariant.id);
    assert.equal(resolved.stampId, subVariant.id);
  });

  it("rejects resolving to the same stamp", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    await assert.rejects(
      () => resolveItemVariant(f.userId, item.id, f.baseStamp.id),
      /different from the current stamp/i
    );
  });

  it("rejects resolving to a non-descendant stamp", async () => {
    const sibling = await prisma.stamp.create({
      data: { collectionId: f.collectionId, name: "Stamp 3" },
    });
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    await assert.rejects(
      () => resolveItemVariant(f.userId, item.id, sibling.id),
      /variant of its current stamp/i
    );
    const history = await getItemVariantHistory(f.userId, item.id);
    assert.equal(history.length, 0);
  });

  it("rejects a stamp from another collection", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    const other = await seedFixtures(`resolveforeign-${Date.now()}`);
    await assert.rejects(
      () => resolveItemVariant(f.userId, item.id, other.variant.id),
      /stamp not found in this collection/i
    );
    await cleanup(other.userId);
  });

  it("rejects a foreign owner", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    await assert.rejects(
      () => resolveItemVariant("wrong-user", item.id, f.variant.id),
      /access denied/i
    );
  });
});

describe("deleteItem", () => {
  let f: Awaited<ReturnType<typeof seedFixtures>>;
  before(async () => {
    f = await seedFixtures(`delete-${Date.now()}`);
  });
  after(() => cleanup(f.userId));

  it("deletes a copy and cascades its variant history", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    await updateItem(f.userId, item.id, { stampId: f.variant.id });
    await deleteItem(f.userId, item.id);
    const found = await prisma.item.findUnique({ where: { id: item.id } });
    assert.equal(found, null);
    const history = await prisma.itemVariantHistory.findMany({ where: { itemId: item.id } });
    assert.equal(history.length, 0);
  });

  it("rejects a foreign owner", async () => {
    const item = await createItem(f.userId, f.collectionId, {
      stampId: f.baseStamp.id,
      conditionId: f.condition.id,
    });
    await assert.rejects(() => deleteItem("wrong-user", item.id), /access denied/i);
  });
});
