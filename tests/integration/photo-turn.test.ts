import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { applyPhotoChangeSet, stageUpload } from "../../src/lib/photos";
import { getStorage, variantKey } from "../../src/lib/storage";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-photo-turn-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A sideways photo put the right way up as it is added (#1006). An uploaded photo addresses nothing
// outside itself, so the turn is written to its **bytes** — both derivatives — and the row records
// the size of the picture as it now stands. What is read below is which corner a mark landed in:
// a picture of the right size turned the wrong way is still a believable photograph.

const W = 120;
const H = 200;
const MARK = 30;
const RED: [number, number, number] = [220, 30, 30];
const GREEN: [number, number, number] = [30, 200, 30];

/** A tall red picture with a green corner at its top left. */
async function markedScan(): Promise<Buffer> {
  const mark = await sharp({
    create: { width: MARK, height: MARK, channels: 3, background: { r: 30, g: 200, b: 30 } },
  })
    .png()
    .toBuffer();
  return sharp({ create: { width: W, height: H, channels: 3, background: { r: 220, g: 30, b: 30 } } })
    .composite([{ input: mark, left: 0, top: 0 }])
    .png()
    .toBuffer();
}

async function pixels(
  photo: { storageBackend: string; storageKey: string; mime: string },
  variant: "full" | "thumb"
) {
  const object = await getStorage(photo.storageBackend).get(
    variantKey(photo.storageKey, variant, photo.mime),
    photo.mime,
    "delivery"
  );
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
  return sharp(Buffer.concat(chunks)).raw().toBuffer({ resolveWithObject: true });
}

function colourAt(
  px: { data: Buffer; info: { width: number; channels: number } },
  x: number,
  y: number
): [number, number, number] {
  const at = (y * px.info.width + x) * px.info.channels;
  return [px.data[at], px.data[at + 1], px.data[at + 2]];
}

describe("turning a photo as it is added (#1006)", () => {
  let userId: string;
  let collectionId: string;
  let itemId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-photo-turn-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User photo-turn-${ts}`,
        email: `test-photo-turn-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-photo-turn-${ts}`,
          name: `Collection photo-turn-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    const condition = await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    const stamp = await prisma.stamp.create({
      data: { collectionId, name: "Sideways", primaryCatalogSortKey: catalogSortKeyOf("1") },
    });
    itemId = (
      await createItem(userId, collectionId, { stampId: stamp.id, conditionId: condition.id })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("writes the turn into both derivatives and records the size it now stands at", async () => {
    const upload = await stageUpload(userId, collectionId, {
      bytes: await markedScan(),
      mime: "image/png",
    });
    await applyPhotoChangeSet(userId, itemId, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0, turn: 90 }],
      update: [],
      remove: [],
    });

    const photo = await prisma.photo.findFirstOrThrow({ where: { itemId, role: "front" } });
    assert.deepEqual([photo.width, photo.height], [H, W]);
    assert.deepEqual([photo.originalWidth, photo.originalHeight], [H, W]);

    // A quarter clockwise takes the top-left corner to the top right — on the thumbnail too, which
    // is what every list draws.
    const full = await pixels(photo, "full");
    assert.deepEqual([full.info.width, full.info.height], [H, W]);
    assert.deepEqual(colourAt(full, H - 10, 10), GREEN);
    assert.deepEqual(colourAt(full, 10, 10), RED);
    const thumb = await pixels(photo, "thumb");
    assert.ok(thumb.info.width > thumb.info.height, "the thumbnail is turned as well");
    // The size recorded is the turned bytes', not the staged upload's.
    assert.equal(photo.sizeBytes, (await readFull(photo)).byteLength);

    // The staged bytes are gone: nothing is left behind under the upload's own key.
    const staged = await prisma.photoUpload.count({ where: { id: upload.id } });
    assert.equal(staged, 0);
  });

  it("leaves a photo added without a turn exactly as it was uploaded", async () => {
    const upload = await stageUpload(userId, collectionId, {
      bytes: await markedScan(),
      mime: "image/png",
    });
    await applyPhotoChangeSet(userId, itemId, {
      add: [{ uploadId: upload.id, role: "back", title: null, sortOrder: 1 }],
      update: [],
      remove: [],
    });
    const photo = await prisma.photo.findFirstOrThrow({ where: { itemId, role: "back" } });
    assert.deepEqual([photo.width, photo.height], [W, H]);
    assert.deepEqual(colourAt(await pixels(photo, "full"), 10, 10), GREEN);
  });

  it("reads anything but a quarter-turn as none", async () => {
    const upload = await stageUpload(userId, collectionId, {
      bytes: await markedScan(),
      mime: "image/png",
    });
    await applyPhotoChangeSet(userId, itemId, {
      add: [{ uploadId: upload.id, role: null, title: "odd", sortOrder: 2, turn: 45 }],
      update: [],
      remove: [],
    });
    const photo = await prisma.photo.findFirstOrThrow({ where: { itemId, title: "odd" } });
    assert.deepEqual([photo.width, photo.height], [W, H]);
  });
});

async function readFull(photo: { storageBackend: string; storageKey: string; mime: string }) {
  const object = await getStorage(photo.storageBackend).get(
    variantKey(photo.storageKey, "full", photo.mime),
    photo.mime,
    "delivery"
  );
  const chunks: Buffer[] = [];
  for await (const chunk of object.stream) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}
