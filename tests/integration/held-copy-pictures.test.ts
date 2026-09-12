import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { countHeldCopyRowsByStamp } from "../../src/lib/copy-counts";
import { listHeldCopyPictures } from "../../src/lib/stamp-holdings";

// **The pictures the intake step compares against are the copies #562's line counts** (#1207) —
// every copy still held of the stamp, with its photos, and not one more or fewer.
//
// One stamp and six copies of it that differ only in where they are:
//
//   - **filed** — delivered, in the collection, with a front, a back and an extra photo;
//   - **no picture** — delivered, for sale, no photo at all, which must still be listed;
//   - **on its way** — ordered, which is held (bought) and therefore listed too;
//   - **written off** — disposed of after delivery, no longer his;
//   - **damaged** — never usably arrived, no longer his;
//
// plus one copy of a **neighbouring** stamp, which must never leak into this stamp's list.

const ts = Date.now();

describe("the held copies of a stamp, as pictures to compare (#1207)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let conditionId: string;
  let stampId: string;
  let otherStampId: string;
  let filedId: string, noPictureId: string, onItsWayId: string;
  let writtenOffId: string, damagedId: string, neighbourId: string;
  let frontId: string, backId: string, extraId: string;

  before(async () => {
    userId = `test-user-heldpics-${ts}`;
    otherUserId = `test-user-heldpics-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-heldpics-${ts}`, name: "Pictures", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Mint never hinged", abbreviation: "MNH", sortOrder: 0 },
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Chopin" } })).id;
    otherStampId = (await prisma.stamp.create({ data: { collectionId, name: "Moniuszko" } })).id;

    const copyOf = (stamp: string, extra: Record<string, unknown>) =>
      createItem(userId, collectionId, { stampId: stamp, conditionId, ...extra });

    filedId = (await copyOf(stampId, { deliveryState: "delivered", inCollection: true })).id;
    noPictureId = (await copyOf(stampId, { deliveryState: "delivered", forSale: true })).id;
    onItsWayId = (await copyOf(stampId, { deliveryState: "ordered" })).id;
    writtenOffId = (await copyOf(stampId, { deliveryState: "delivered", inCollection: true })).id;
    damagedId = (await copyOf(stampId, { deliveryState: "damaged" })).id;
    neighbourId = (await copyOf(otherStampId, { deliveryState: "delivered", inCollection: true }))
      .id;
    await prisma.item.update({ where: { id: writtenOffId }, data: { disposedAt: new Date() } });

    // Created out of display order — extra, back, front — so the read has to sort them.
    const photo = (role: string | null, sortOrder: number) =>
      prisma.photo.create({
        data: {
          itemId: filedId,
          role,
          storageKey: `test/heldpics-${ts}-${role ?? "extra"}`,
          mime: "image/jpeg",
          width: 100,
          height: 100,
          sizeBytes: 1000,
          sortOrder,
        },
      });
    extraId = (await photo(null, 0)).id;
    backId = (await photo("back", 5)).id;
    frontId = (await photo("front", 9)).id;
  });

  after(async () => {
    await prisma.photo.deleteMany({ where: { item: { collectionId } } });
    await prisma.item.deleteMany({ where: { collectionId } });
    await prisma.stamp.deleteMany({ where: { collectionId } });
    await prisma.stampCondition.deleteMany({ where: { collectionId } });
    await prisma.collection.delete({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("lists every copy still held, the one on its way included, and none that are gone", async () => {
    const copies = await listHeldCopyPictures(userId, collectionId, stampId, null);
    assert.deepEqual(
      copies.map((c) => c.id).sort(),
      [filedId, noPictureId, onItsWayId].sort()
    );
    for (const gone of [writtenOffId, damagedId, neighbourId]) {
      assert.ok(!copies.some((c) => c.id === gone), `${gone} is not a held copy of this stamp`);
    }
  });

  it("lists the same copies the holdings line counts", async () => {
    const copies = await listHeldCopyPictures(userId, collectionId, stampId, null);
    const rows = (await countHeldCopyRowsByStamp(collectionId, [stampId])).get(stampId) ?? [];
    assert.equal(
      copies.length,
      rows.reduce((sum, row) => sum + row.count, 0)
    );
  });

  it("carries a copy's photos front, back, then the rest", async () => {
    const copies = await listHeldCopyPictures(userId, collectionId, stampId, null);
    const filed = copies.find((c) => c.id === filedId)!;
    assert.deepEqual(
      filed.photos.map((p) => [p.id, p.role]),
      [
        [frontId, "front"],
        [backId, "back"],
        [extraId, null],
      ]
    );
  });

  it("keeps a copy with no photo, saying so by an empty list rather than by leaving it out", async () => {
    const copies = await listHeldCopyPictures(userId, collectionId, stampId, null);
    const bare = copies.find((c) => c.id === noPictureId);
    assert.ok(bare, "a copy without a picture is still held");
    assert.deepEqual(bare.photos, []);
    assert.equal(bare.forSale, true);
    assert.equal(bare.deliveryState, "delivered");
  });

  it("leaves out the copy being re-identified, and only that one", async () => {
    const copies = await listHeldCopyPictures(userId, collectionId, stampId, filedId);
    assert.deepEqual(
      copies.map((c) => c.id).sort(),
      [noPictureId, onItsWayId].sort()
    );
  });

  it("refuses a collection the caller does not own", async () => {
    await assert.rejects(listHeldCopyPictures(otherUserId, collectionId, stampId, null));
  });
});
