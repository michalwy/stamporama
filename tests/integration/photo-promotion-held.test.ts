import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem, updateItem } from "../../src/lib/items";
import {
  applyPhotoChangeSet,
  applyPhotoPromotions,
  parsePhotoPromotions,
  PhotoValidationError,
  stageUpload,
} from "../../src/lib/photos";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-promote-held-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A photo promoted from the copy's edit dialog goes to the stamp chosen in that dialog (#1878). While
// the stamp change is unsaved the dialog holds the promotion and sends it with the Save, and
// `updateItemAction` carries it out after the re-point — the order pinned here.

describe("a promotion held for the copy's Save (#1878)", () => {
  let userId: string;
  let collectionId: string;
  let conditionId: string;
  let seq = 0;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-promote-held-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-promote-held-${ts}`, name: `Held ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  async function stamp(): Promise<string> {
    seq += 1;
    return (
      await prisma.stamp.create({
        data: { collectionId, name: `Stamp ${seq}`, primaryCatalogSortKey: catalogSortKeyOf(String(seq)) },
      })
    ).id;
  }

  /** A copy of `stampId` with a saved front photo — which also seeds the stamp's main (#149). */
  async function photographedCopy(stampId: string): Promise<{ itemId: string; photoId: string }> {
    const item = await createItem(userId, collectionId, { stampId, conditionId });
    const bytes = await sharp({
      create: { width: 40, height: 40, channels: 3, background: { r: 20, g: 120, b: 220 } },
    })
      .png()
      .toBuffer();
    const upload = await stageUpload(userId, collectionId, { bytes, mime: "image/png" });
    await applyPhotoChangeSet(userId, item.id, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
    const photo = await prisma.photo.findFirstOrThrow({ where: { itemId: item.id, role: "front" } });
    return { itemId: item.id, photoId: photo.id };
  }

  const stampPhotos = (stampId: string) =>
    prisma.photo.findMany({ where: { stampId }, select: { id: true, role: true, title: true } });

  it("re-pointed from A to B, the held promotion gives B the photo and leaves A untouched", async () => {
    const a = await stamp();
    const b = await stamp();
    const { itemId, photoId } = await photographedCopy(a);
    const aBefore = await stampPhotos(a);

    // What `updateItemAction` does with the dialog's form: re-point, then the held promotions.
    const form = new FormData();
    form.set("photoPromotions", JSON.stringify([{ photoId, role: null, title: " Back side " }]));
    await updateItem(userId, itemId, { stampId: b });
    await applyPhotoPromotions(userId, itemId, parsePhotoPromotions(form));

    assert.deepEqual(await stampPhotos(a), aBefore);
    const onB = await stampPhotos(b);
    assert.equal(onB.length, 1);
    assert.equal(onB[0].role, null);
    assert.equal(onB[0].title, "Back side");
    // The copy keeps its own photo.
    assert.equal(await prisma.photo.count({ where: { id: photoId, itemId } }), 1);
  });

  it("nothing held — the Save promotes nothing", async () => {
    const a = await stamp();
    const b = await stamp();
    const { itemId } = await photographedCopy(a);
    const aBefore = await stampPhotos(a);

    await updateItem(userId, itemId, { stampId: b });
    await applyPhotoPromotions(userId, itemId, parsePhotoPromotions(new FormData()));

    assert.deepEqual(await stampPhotos(a), aBefore);
    assert.equal((await stampPhotos(b)).length, 0);
  });

  it("refuses a photo that is not this copy's", async () => {
    const a = await stamp();
    const other = await photographedCopy(a);
    const { itemId } = await photographedCopy(await stamp());
    await assert.rejects(
      applyPhotoPromotions(userId, itemId, [{ photoId: other.photoId, role: "main", title: null }]),
      PhotoValidationError
    );
  });

  it("reads a malformed or absent field as no promotions", () => {
    const form = new FormData();
    assert.deepEqual(parsePhotoPromotions(form), []);
    form.set("photoPromotions", "{not json");
    assert.deepEqual(parsePhotoPromotions(form), []);
    form.set("photoPromotions", JSON.stringify([{ role: "main" }, { photoId: "p1", role: "nonsense" }]));
    assert.deepEqual(parsePhotoPromotions(form), [{ photoId: "p1", role: null, title: null }]);
  });
});
