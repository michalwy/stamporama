import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem, listItemsPaginated } from "../../src/lib/items";

// The Copies list's multi-value filters (#425, #427, #428). The condition and delivery-state axes
// are plain `in`s and are covered here mostly so an OR stays an OR; what is genuinely worth pinning
// down are the two axes whose **null is a value** — format's `"single"` (ADR-0020) and certificate's
// `"none"` (ADR-0006 §2). Neither can ride in an `in` list, so ticking the sentinel beside a real
// value has to be two branches, and ticking it alone has to stay the null test the single-select
// already was.

const ts = Date.now();

describe("multi-value copy filters", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;
  let mnhId: string;
  let mhId: string;
  let usedId: string;
  let pairId: string;
  let blockId: string;
  let certId: string;

  before(async () => {
    userId = `test-user-multifilter-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User multifilter-${ts}`,
        email: `test-multifilter-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-multifilter-${ts}`, name: "MF", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const condition = async (name: string, abbreviation: string, sortOrder: number) =>
      (
        await prisma.stampCondition.create({
          data: { collectionId, name, abbreviation, sortOrder },
        })
      ).id;
    mnhId = await condition("Mint never hinged", "MNH", 0);
    mhId = await condition("Mint hinged", "MH", 1);
    usedId = await condition("Used", "U", 2);

    const format = async (name: string, abbreviation: string, sortOrder: number) =>
      (
        await prisma.stampFormat.create({
          data: { collectionId, name, abbreviation, sortOrder },
        })
      ).id;
    pairId = await format("Pair", "pair", 0);
    blockId = await format("Block of 4", "blk4", 1);

    certId = (
      await prisma.certificateStatus.create({
        data: { collectionId, name: "Photo certificate", abbreviation: "FA", sortOrder: 0 },
      })
    ).id;

    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Chopin" } })).id;

    // One copy per (condition × format) corner worth asking about, plus the delivery states.
    await createItem(userId, collectionId, { stampId, conditionId: mnhId }); // single
    await createItem(userId, collectionId, { stampId, conditionId: mnhId, formatId: pairId });
    await createItem(userId, collectionId, {
      stampId,
      conditionId: mhId,
      formatId: blockId,
      certificateStatusId: certId,
    });
    await createItem(userId, collectionId, {
      stampId,
      conditionId: usedId,
      deliveryState: "in_transit",
    });
    await createItem(userId, collectionId, {
      stampId,
      conditionId: usedId,
      deliveryState: "ordered",
    });
  });

  after(async () => {
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampFormat.deleteMany({ where: { collectionId } });
    await prisma.certificateStatus.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.delete({ where: { id: userId } });
  });

  const count = async (filters: Parameters<typeof listItemsPaginated>[2]) =>
    (await listItemsPaginated(userId, collectionId, { ...filters, pageSize: 100 })).items.length;

  it("matches any of several conditions", async () => {
    assert.equal(await count({ conditionIds: [mnhId] }), 2);
    assert.equal(await count({ conditionIds: [mnhId, mhId] }), 3);
    // An empty list is the absence of the filter, never an unmatchable empty set.
    assert.equal(await count({ conditionIds: [] }), 5);
  });

  it("matches any of several delivery states", async () => {
    assert.equal(await count({ deliveryStates: ["in_transit"] }), 1);
    // "Everything still on its way to me" is one question, not three passes.
    assert.equal(await count({ deliveryStates: ["ordered", "in_transit", "to_sort"] }), 2);
    assert.equal(await count({ deliveryStates: ["delivered"] }), 3);
  });

  it("matches any of several formats", async () => {
    assert.equal(await count({ formatIds: [pairId] }), 1);
    assert.equal(await count({ formatIds: [pairId, blockId] }), 2);
  });

  it("reads `single` as the null format, alone and alongside a real one", async () => {
    // Alone: the null test the single-select already was.
    assert.equal(await count({ formatIds: ["single"] }), 3);
    // Beside a format: null can never be a member of an `in`, so this is two branches ORed.
    assert.equal(await count({ formatIds: ["single", pairId] }), 4);
    assert.equal(await count({ formatIds: ["single", pairId, blockId] }), 5);
  });

  it("matches certificate statuses, with `none` as the null value (#428)", async () => {
    assert.equal(await count({ certificateStatusIds: [certId] }), 1);
    // Alone: the copies carrying no certificate at all.
    assert.equal(await count({ certificateStatusIds: ["none"] }), 4);
    // Beside a status: two branches, since null is never a member of an `in`.
    assert.equal(await count({ certificateStatusIds: ["none", certId] }), 5);
  });

  it("composes with the other axes rather than replacing them", async () => {
    assert.equal(await count({ conditionIds: [mnhId], formatIds: ["single"] }), 1);
    assert.equal(await count({ conditionIds: [mnhId], formatIds: ["single", pairId] }), 2);
    assert.equal(
      await count({ conditionIds: [mnhId, usedId], deliveryStates: ["delivered"] }),
      2
    );
    // Two null-bearing axes at once: each contributes its own branch to the AND list, so they
    // narrow together rather than one OR swallowing the other.
    assert.equal(
      await count({ formatIds: ["single", blockId], certificateStatusIds: ["none"] }),
      3
    );
  });
});
