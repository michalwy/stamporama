import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import {
  getColnectPlatform,
  listPlatformContacts,
  setColnectPlatform,
} from "../../src/lib/colnect";

// Which platform *is* Colnect (#406) — set in Settings → Colnect by picking a contact, because it is
// one fact per collection rather than a property each contact form re-asks. It is what switches the
// listing preconditions on, so the two rules that matter are that it is exclusive (a collection can
// never have two answers) and that it only ever lands on a platform of this collection.

describe("Colnect platform setting (#406)", () => {
  let userId: string;
  let collectionId: string;
  let colnectId: string;
  let delcampeId: string;
  let sellerId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-colplat-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User colplat-${ts}`,
        email: `test-colplat-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-colplat-${ts}`,
          name: `Collection colplat-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    colnectId = (
      await prisma.contact.create({ data: { collectionId, name: "Colnect", platform: true } })
    ).id;
    delcampeId = (
      await prisma.contact.create({ data: { collectionId, name: "Delcampe", platform: true } })
    ).id;
    sellerId = (
      await prisma.contact.create({ data: { collectionId, name: "A dealer", seller: true } })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  it("offers every platform to pick from, and nothing that is not one", async () => {
    assert.deepEqual(
      (await listPlatformContacts(userId, collectionId)).map((p) => p.name),
      ["Colnect", "Delcampe"]
    );
  });

  it("starts unset — a collection that has never used the Assistant is checked against nothing", async () => {
    assert.equal(await getColnectPlatform(userId, collectionId), null);
  });

  it("marks one platform, and moving it clears the previous one", async () => {
    await setColnectPlatform(userId, collectionId, colnectId);
    assert.equal((await getColnectPlatform(userId, collectionId))?.id, colnectId);

    await setColnectPlatform(userId, collectionId, delcampeId);
    assert.equal((await getColnectPlatform(userId, collectionId))?.id, delcampeId);
    // Exclusive: Colnect is one marketplace, and two platforms claiming it could only disagree.
    assert.equal(
      await prisma.contact.count({ where: { collectionId, platformModule: { not: null } } }),
      1
    );
  });

  it("clears with null", async () => {
    await setColnectPlatform(userId, collectionId, colnectId);
    await setColnectPlatform(userId, collectionId, null);
    assert.equal(await getColnectPlatform(userId, collectionId), null);
    assert.equal(
      await prisma.contact.count({ where: { collectionId, platformModule: { not: null } } }),
      0
    );
  });

  it("refuses a contact that is not a platform of this collection", async () => {
    await assert.rejects(() => setColnectPlatform(userId, collectionId, sellerId));
    await assert.rejects(() => setColnectPlatform(userId, collectionId, "no-such-contact"));
    assert.equal(await getColnectPlatform(userId, collectionId), null);
  });

  it("refuses another owner", async () => {
    await assert.rejects(() => getColnectPlatform("someone-else", collectionId));
    await assert.rejects(() => setColnectPlatform("someone-else", collectionId, colnectId));
  });
});
