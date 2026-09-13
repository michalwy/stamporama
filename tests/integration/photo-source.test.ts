import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import {
  applyStampPhotoChangeSet,
  listStampPhotos,
  PhotoValidationError,
  stageUpload,
} from "../../src/lib/photos";
import { PHOTO_SOURCE_MAX_LENGTH } from "../../src/lib/photo-source";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-photo-source-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Where a reference photo came from (#1001, ADR-0049 §3): written through the stamp photo change-set
// the editor sends, read back through the list the editor opens with. Free text under a length cap —
// a book citation is as good a value as a URL.

async function png(): Promise<Buffer> {
  return sharp({ create: { width: 40, height: 60, channels: 3, background: { r: 200, g: 40, b: 40 } } })
    .png()
    .toBuffer();
}

describe("a photo's source (#1001)", () => {
  let userId: string;
  let collectionId: string;
  let stampId: string;

  async function stage() {
    return stageUpload(userId, collectionId, { bytes: await png(), mime: "image/png" });
  }

  async function sources() {
    return (await listStampPhotos(userId, stampId)).map((p) => [p.title, p.sourceUrl]);
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-photo-source-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User photo-source-${ts}`,
        email: `test-photo-source-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-photo-source-${ts}`,
          name: `Collection photo-source-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    stampId = (
      await prisma.stamp.create({
        data: { collectionId, name: "Referenced", primaryCatalogSortKey: catalogSortKeyOf("1") },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { id: collectionId } });
    await prisma.user.deleteMany({ where: { id: userId } });
    await prisma.$disconnect();
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("is stored with a new photo, trimmed, and a blank one is none", async () => {
    const [a, b] = [await stage(), await stage()];
    await applyStampPhotoChangeSet(userId, stampId, {
      add: [
        { uploadId: a.id, role: "main", title: null, sortOrder: 0, sourceUrl: "  https://colnect.com/en/stamps/stamp/1  " },
        { uploadId: b.id, role: null, title: "Book", sortOrder: 1, sourceUrl: "   " },
      ],
      update: [],
      remove: [],
    });
    assert.deepEqual(await sources(), [
      [null, "https://colnect.com/en/stamps/stamp/1"],
      ["Book", null],
    ]);
  });

  it("is changed, left alone and cleared by an update", async () => {
    const [main, book] = await listStampPhotos(userId, stampId);

    await applyStampPhotoChangeSet(userId, stampId, {
      add: [],
      update: [{ photoId: book.id, sourceUrl: "Michel Spezial 2020, p. 114" }],
      remove: [],
    });
    assert.deepEqual(await sources(), [
      [null, "https://colnect.com/en/stamps/stamp/1"],
      ["Book", "Michel Spezial 2020, p. 114"],
    ]);

    // An update that does not name the source — every save from a copy's editor — keeps it.
    await applyStampPhotoChangeSet(userId, stampId, {
      add: [],
      update: [{ photoId: book.id, title: "Handbook", sortOrder: 1 }],
      remove: [],
    });
    assert.deepEqual(await sources(), [
      [null, "https://colnect.com/en/stamps/stamp/1"],
      ["Handbook", "Michel Spezial 2020, p. 114"],
    ]);

    await applyStampPhotoChangeSet(userId, stampId, {
      add: [],
      update: [{ photoId: main.id, sourceUrl: "" }],
      remove: [],
    });
    assert.deepEqual(await sources(), [
      [null, null],
      ["Handbook", "Michel Spezial 2020, p. 114"],
    ]);
  });

  it("is refused over the cap, and the refusal writes nothing", async () => {
    const [, book] = await listStampPhotos(userId, stampId);
    const upload = await stage();
    const tooLong = "x".repeat(PHOTO_SOURCE_MAX_LENGTH + 1);

    await assert.rejects(
      applyStampPhotoChangeSet(userId, stampId, {
        add: [{ uploadId: upload.id, role: null, title: null, sortOrder: 2 }],
        update: [{ photoId: book.id, sourceUrl: tooLong }],
        remove: [],
      }),
      PhotoValidationError
    );
    assert.deepEqual(await sources(), [
      [null, null],
      ["Handbook", "Michel Spezial 2020, p. 114"],
    ]);
    // The staged upload was not consumed either — it is still there to be saved.
    assert.ok(await prisma.photoUpload.findUnique({ where: { id: upload.id } }));

    const atCap = "x".repeat(PHOTO_SOURCE_MAX_LENGTH);
    await applyStampPhotoChangeSet(userId, stampId, {
      add: [],
      update: [{ photoId: book.id, sourceUrl: atCap }],
      remove: [],
    });
    assert.equal((await listStampPhotos(userId, stampId))[1].sourceUrl, atCap);
  });
});
