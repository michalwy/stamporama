import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { deletePurchase, startPurchaseOnPhone } from "../../src/lib/purchases";
import {
  addPurchasePhotos,
  getCollectionPhotoStorageBytes,
  getPhotoForServing,
  listPurchasePhotos,
  removePurchasePhoto,
  stageUpload,
} from "../../src/lib/photos";
import { getStorage, variantKey } from "../../src/lib/storage";
import type { PhonePurchaseInput } from "../../src/lib/phone-purchase-rules";

// The filesystem backend under a throwaway directory, as the other photo tests do.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-purchase-photos-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Photos on a purchase (#2011, ADR-0072): pictures of what was bought as a whole, taken on the phone
// when the purchase is started and afterwards, kept on the purchase — added and removed at the desk,
// served like every photo, counted in the collection's storage, and deleted with the purchase.

async function picture(red: number): Promise<Buffer> {
  return sharp({ create: { width: 160, height: 120, channels: 3, background: { r: red, g: 120, b: 60 } } })
    .jpeg()
    .toBuffer();
}

async function bytesExist(photo: { storageBackend: string; storageKey: string; mime: string }): Promise<boolean> {
  const storage = getStorage(photo.storageBackend);
  try {
    for (const variant of ["full", "thumb"] as const) {
      await storage.get(variantKey(photo.storageKey, variant, photo.mime), photo.mime, "delivery");
    }
    return true;
  } catch {
    return false;
  }
}

describe("photos on a purchase (#2011)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let otherCollectionId: string;

  function input(patch: Partial<PhonePurchaseInput> = {}): PhonePurchaseInput {
    return {
      sellerContactId: null,
      sellerName: "Fair stall 7",
      amount: 80,
      currency: "PLN",
      purchasedAt: "2026-10-18",
      description: "Stockbook",
      stampIds: [],
      photoUploadIds: [],
      ...patch,
    };
  }

  async function stage(red: number, inCollection = collectionId): Promise<string> {
    return (await stageUpload(userId, inCollection, { bytes: await picture(red), mime: "image/jpeg" })).id;
  }

  async function photoRows(purchaseId: string) {
    return prisma.photo.findMany({
      where: { purchaseId },
      orderBy: { sortOrder: "asc" },
      select: { id: true, role: true, sortOrder: true, storageBackend: true, storageKey: true, mime: true },
    });
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-purchase-photos-${ts}`;
    strangerId = `test-user-purchase-photos-stranger-${ts}`;
    for (const id of [userId, strangerId]) {
      await prisma.user.create({
        data: { id, name: id, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-purchase-photos-${ts}`, name: `Purchase photos ${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-purchase-photos-other-${ts}`, name: `Other ${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
  });

  it("keeps the photos the phone took when it started the purchase, in the order taken", async () => {
    const first = await stage(10);
    const second = await stage(20);
    const { id, photoError } = await startPurchaseOnPhone(userId, collectionId, input({ photoUploadIds: [first, second] }));
    assert.equal(photoError, null);

    const rows = await photoRows(id);
    assert.equal(rows.length, 2);
    assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1]);
    assert.ok(rows.every((r) => r.role === null));
    for (const r of rows) assert.ok(await bytesExist(r));
    // The staged uploads are consumed.
    assert.equal(await prisma.photoUpload.count({ where: { id: { in: [first, second] } } }), 0);

    const listed = await listPurchasePhotos(userId, id);
    assert.deepEqual(listed.map((p) => p.id), rows.map((r) => r.id));
  });

  it("refuses the purchase when a photo taken never arrived, and writes nothing", async () => {
    const before = await prisma.purchase.count({ where: { collectionId } });
    const real = await stage(30);
    await assert.rejects(
      () => startPurchaseOnPhone(userId, collectionId, input({ photoUploadIds: [real, "missing-upload"] })),
      /not received/
    );
    // An upload staged in another collection is not this collection's either.
    const foreign = await stage(31, otherCollectionId);
    await assert.rejects(() => startPurchaseOnPhone(userId, collectionId, input({ photoUploadIds: [foreign] })));
    assert.equal(await prisma.purchase.count({ where: { collectionId } }), before);
  });

  it("adds more after the ones it has, and removes one with its bytes", async () => {
    const { id } = await startPurchaseOnPhone(userId, collectionId, input({ photoUploadIds: [await stage(40)] }));
    await addPurchasePhotos(userId, id, [await stage(41), await stage(42)]);
    const rows = await photoRows(id);
    assert.deepEqual(rows.map((r) => r.sortOrder), [0, 1, 2]);

    const gone = rows[1];
    await removePurchasePhoto(userId, id, gone.id);
    assert.deepEqual((await photoRows(id)).map((r) => r.id), [rows[0].id, rows[2].id]);
    assert.equal(await bytesExist(gone), false);
  });

  it("is the owner's alone: a stranger cannot add, and a photo of another purchase is not removed", async () => {
    const { id: a } = await startPurchaseOnPhone(userId, collectionId, input({ photoUploadIds: [await stage(50)] }));
    const { id: b } = await startPurchaseOnPhone(userId, collectionId, input());
    const [photo] = await photoRows(a);

    await assert.rejects(() => addPurchasePhotos(strangerId, b, [photo.id]));
    await assert.rejects(() => removePurchasePhoto(userId, b, photo.id));
    await assert.rejects(() => removePurchasePhoto(strangerId, a, photo.id));
    assert.equal((await photoRows(a)).length, 1);
  });

  it("is served through the collection's photo route and counted in its storage", async () => {
    const { id } = await startPurchaseOnPhone(userId, collectionId, input({ photoUploadIds: [await stage(60)] }));
    const [photo] = await photoRows(id);
    const served = await getPhotoForServing(photo.id);
    assert.equal(served?.collectionId, collectionId);
    assert.equal(served?.ownerId, userId);

    const total = await getCollectionPhotoStorageBytes(userId, collectionId);
    const purchaseBytes = await prisma.photo.aggregate({
      where: { purchase: { collectionId } },
      _sum: { sizeBytes: true },
    });
    assert.ok((purchaseBytes._sum.sizeBytes ?? 0) > 0);
    assert.ok(total >= (purchaseBytes._sum.sizeBytes ?? 0));
  });

  it("deletes its photos with the purchase — and keeps them when the delete is refused", async () => {
    const { id } = await startPurchaseOnPhone(userId, collectionId, input({ photoUploadIds: [await stage(70)] }));
    const [photo] = await photoRows(id);

    // A lot still holding a copy refuses the delete; the photo must survive that.
    const conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: "Held" } })).id;
    const lot = await prisma.purchaseLot.findFirstOrThrow({ where: { purchaseId: id } });
    const copy = await createItem(userId, collectionId, { stampId, conditionId, lotId: lot.id });
    await assert.rejects(() => deletePurchase(userId, id), /Detach the copies/);
    assert.ok(await bytesExist(photo));

    await prisma.item.delete({ where: { id: copy.id } });
    await deletePurchase(userId, id);
    assert.equal(await prisma.photo.count({ where: { id: photo.id } }), 0);
    assert.equal(await bytesExist(photo), false);
  });
});
