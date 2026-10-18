import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";
import {
  CopiesCollageError,
  getCollagePlatformSeed,
  makeCopiesCollage,
  type CopiesCollageRequest,
} from "../../src/lib/copies-collage";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-copies-collage-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// The one-off collage of ticked copies (#2052): the plan and the renderer are an offer's and tested
// there; what is exercised here is the wiring with no offer — the platform's seed, the two ways of
// composing the copies, the platform's limits, the report of what could not be drawn, and above all
// that nothing is stored.

async function scan(width: number, height: number, red: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: red, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

/** Every file under the data directory — what the collage must leave as it found it. */
async function storedFiles(): Promise<string[]> {
  return (await readdir(DATA_DIR, { recursive: true })).map(String).sort();
}

describe("a one-off collage of ticked copies (#2052)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let otherPlatformId: string;
  /** Three copies in catalogue order; the last has no back scan. */
  const itemIds: string[] = [];

  const COLLAGE = {
    collageGridMode: "fixed" as const,
    collageGridShape: "landscape" as const,
    collageRows: 2,
    collageColumns: 2,
    collageGapPercent: 8,
    collageBackground: "#ffffff",
    collageLabelPercent: 0,
  };

  function request(overrides: Partial<CopiesCollageRequest> = {}): CopiesCollageRequest {
    return {
      itemIds,
      platformId,
      packaging: "one-set",
      config: {
        photoSides: "front",
        preferSingles: false,
        photoLabelLeftTemplate: null,
        photoLabelRightTemplate: null,
        collage: COLLAGE,
      },
      ...overrides,
    };
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-copies-collage-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User copies-collage-${ts}`,
        email: `test-copies-collage-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-copies-collage-${ts}`, name: `Collage ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const template = await prisma.collageTemplate.create({
      data: { collectionId, name: "Three across", rows: 1, columns: 3, gapPercent: 5, background: "#000000", labelPercent: 4 },
    });
    platformId = (
      await prisma.platform.create({
        data: {
          collectionId,
          name: `Facebook ${ts}`,
          maxPhotos: 2,
          maxPhotoEdge: 600,
          photoSides: "both",
          tileLabelLeftTemplate: "{ref}",
          defaultCollageTemplateId: template.id,
        },
      })
    ).id;
    // Another collector's platform: never a source of settings here.
    const otherUser = `${userId}-other`;
    await prisma.user.create({
      data: {
        id: otherUser,
        name: "Other",
        email: `other-copies-collage-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const otherCollection = await prisma.collection.create({
      data: { slug: `col-copies-collage-o-${ts}`, name: "Other", baseCurrency: "EUR", ownerId: otherUser },
    });
    otherPlatformId = (await prisma.platform.create({ data: { collectionId: otherCollection.id, name: "Theirs" } })).id;

    for (const [index, sides] of ([["front", "back"], ["front", "back"], ["front"]] as const).entries()) {
      const stamp = await prisma.stamp.create({
        data: { collectionId, name: `Stamp ${index}`, primaryCatalogSortKey: catalogSortKeyOf(String(index + 1)) },
      });
      const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
      for (const role of sides) {
        const upload = await stageUpload(userId, collectionId, {
          bytes: await scan(120 + index * 10, 160, role === "front" ? 40 + index * 30 : 220),
          mime: "image/png",
        });
        await applyPhotoChangeSet(userId, item.id, {
          add: [{ uploadId: upload.id, role, title: null, sortOrder: 0 }],
          update: [],
          remove: [],
        });
      }
      itemIds.push(item.id);
    }
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, `${userId}-other`] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, `${userId}-other`] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("seeds the settings from the platform, as a new offer there would start", async () => {
    const seed = await getCollagePlatformSeed(userId, collectionId, platformId);
    assert.equal(seed.config.photoSides, "both");
    assert.equal(seed.config.photoLabelLeftTemplate, "{ref}");
    assert.equal(seed.config.coverSymbols, null, "the platform's rule is followed");
    assert.equal(seed.config.collage?.collageColumns, 3, "copied from the platform's default template");
    assert.deepEqual(seed.limits, { maxPhotos: 2, maxPhotoEdge: 600, maxPhotoFileSizeMib: null });
    await assert.rejects(getCollagePlatformSeed(userId, collectionId, otherPlatformId), CopiesCollageError);
  });

  it("draws the copies as one set onto one image, within the platform's edge, and stores nothing", async () => {
    const photosBefore = await prisma.photo.count();
    const offersBefore = await prisma.offer.count({ where: { collectionId } });
    const filesBefore = await storedFiles();

    const made = await makeCopiesCollage(userId, collectionId, request());

    assert.equal(made.images.length, 1);
    const [image] = made.images;
    assert.equal(image.tileCount, 3);
    assert.equal(image.side, "front");
    assert.equal(image.mime, "image/jpeg");
    const meta = await sharp(Buffer.from(image.base64, "base64")).metadata();
    assert.equal(meta.format, "jpeg");
    assert.ok(Math.max(meta.width!, meta.height!) <= 600, "the platform's longest edge applies");
    assert.deepEqual([meta.width, meta.height], [image.width, image.height]);
    assert.deepEqual(made.skipped, []);
    assert.deepEqual(made.missing, []);
    assert.equal(made.copyCount, 3);

    assert.equal(await prisma.photo.count(), photosBefore, "no photo row");
    assert.equal(await prisma.offer.count({ where: { collectionId } }), offersBefore, "no offer");
    assert.deepEqual(await storedFiles(), filesBefore, "no bytes");
  });

  it("spends the platform's photo limit on single photos when each copy is its own set", async () => {
    // Three singles, room for two photos, four to a collage: one alone, the other two collaged.
    const made = await makeCopiesCollage(
      userId,
      collectionId,
      request({ packaging: "per-copy", config: { ...request().config, preferSingles: true } })
    );
    assert.deepEqual(
      made.images.map((i) => i.tileCount),
      [1, 2]
    );
    assert.ok(made.images.every((i) => !i.overLimit));
  });

  it("reports a side not drawn and names the copy without the scan", async () => {
    const made = await makeCopiesCollage(
      userId,
      collectionId,
      request({ config: { ...request().config, photoSides: "both" } })
    );
    assert.deepEqual(
      made.images.map((i) => i.side),
      ["front"],
      "the back collage needs every copy's back"
    );
    assert.equal(made.skipped.length, 1);
    assert.equal(made.skipped[0].side, "back");
    assert.equal(made.skipped[0].copies.length, 1);
  });

  it("marks the images past the platform's photo limit and still draws them", async () => {
    const made = await makeCopiesCollage(
      userId,
      collectionId,
      request({ config: { ...request().config, collage: { ...COLLAGE, collageRows: 1, collageColumns: 1 } } })
    );
    assert.deepEqual(
      made.images.map((i) => i.overLimit),
      [false, false, true]
    );
  });

  it("refuses without collage numbers, and leaves out copies of another collection", async () => {
    await assert.rejects(
      makeCopiesCollage(userId, collectionId, request({ config: { ...request().config, collage: null } })),
      CopiesCollageError
    );
    await assert.rejects(
      makeCopiesCollage(userId, collectionId, request({ platformId: otherPlatformId })),
      CopiesCollageError
    );
    await assert.rejects(
      makeCopiesCollage(userId, collectionId, request({ itemIds: ["not-a-copy"] })),
      CopiesCollageError
    );
    const made = await makeCopiesCollage(userId, collectionId, request({ itemIds: [...itemIds, "not-a-copy"] }));
    assert.equal(made.copyCount, 3);
  });
});
