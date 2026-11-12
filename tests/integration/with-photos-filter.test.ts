import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";

// *With photos* (#2491): the copies with at least one attached photo — *No photos* inverted, so the
// two partition the list, and both together match nothing rather than one overriding the other.

describe("with photos (#2491)", () => {
  let userId: string;
  let collectionId: string;
  let pictured: string, bare: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-wph-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User wph-${ts}`,
        email: `test-wph-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-wph-${ts}`, name: `Collection wph-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Kite" } });
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const copy = async () =>
      (await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id, forSale: true })).id;
    pictured = await copy();
    bare = await copy();
    await prisma.photo.create({
      data: {
        itemId: pictured,
        storageKey: `test/with-photos-${ts}`,
        mime: "image/jpeg",
        width: 100,
        height: 100,
        sizeBytes: 1000,
      },
    });
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const ids = async (filters: { noPhotos?: boolean; withPhotos?: boolean }) =>
    (await listItemsPaginated(userId, collectionId, filters)).items.map((i) => i.id).sort();

  it("shows only the copies with a photo", async () => {
    assert.deepEqual(await ids({ withPhotos: true }), [pictured]);
  });

  it("is the opposite of No photos", async () => {
    assert.deepEqual(await ids({ noPhotos: true }), [bare]);
  });

  it("matches nothing with both set", async () => {
    assert.deepEqual(await ids({ noPhotos: true, withPhotos: true }), []);
  });
});
