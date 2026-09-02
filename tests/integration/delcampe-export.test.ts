import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { addOfferSet, createOffer, updateOfferPhotoConfig } from "../../src/lib/offers";
import { applyPhotoChangeSet, stageUpload } from "../../src/lib/photos";
import {
  claimNextOfferPhotoGeneration,
  enqueueOfferPhotoGeneration,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { setDelcampePlatform } from "../../src/lib/delcampe";
import { createDelcampeListingProfile } from "../../src/lib/delcampe-listing-profile";
import { DELCAMPE_PROFILE_DEFAULTS } from "../../src/lib/delcampe-listing-profile-rules";
import { setDelcampeOfferCategory } from "../../src/lib/delcampe-offer-listing";
import {
  buildDelcampeUploadBundle,
  DelcampeExportError,
} from "../../src/lib/delcampe-export";
import { DELCAMPE_UPLOAD_CSV_NAME } from "../../src/lib/delcampe-export-rules";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

// Bytes go through the filesystem backend, so point it at a throwaway directory rather than the
// repo's `.data`, exactly as the photo-generation test does.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-delcampe-export-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;
// The Easy Uploader bundle (#610). What the pure tests cannot reach is exactly what is exercised
// here: that the CSV's `images` column names the files that are actually in the archive, that a
// batch which cannot be written produces **no file at all** and a reason per offer, and that the
// archive is flat — the whole reason the names have to be unique in the first place.

/** One scan's worth of bytes. */
async function scan(red: number): Promise<Buffer> {
  return sharp({ create: { width: 120, height: 160, channels: 3, background: { r: red, g: 120, b: 200 } } })
    .png()
    .toBuffer();
}

/** Read a ZIP back by walking its local file headers, in written order. */
function readZipEntries(archive: Buffer): { name: string; contents: Buffer }[] {
  const entries: { name: string; contents: Buffer }[] = [];
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const method = archive.readUInt16LE(offset + 8);
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    const name = archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const start = offset + 30 + nameLength + extraLength;
    const payload = archive.subarray(start, start + compressedSize);
    entries.push({ name, contents: method === 0 ? Buffer.from(payload) : inflateRawSync(payload) });
    offset = start + compressedSize;
  }
  return entries;
}

/** The data rows of the file, split on the columns Delcampe states — enough for a file whose only
 *  quoted fields hold no separators of their own. */
function csvRows(csv: string): string[][] {
  return csv
    .trimEnd()
    .split("\r\n")
    .slice(1)
    .map((line) => line.match(/("([^"]|"")*"|[^,]*)/g)!.filter((_, i) => i % 2 === 0))
    .map((cells) => cells.map((cell) => cell.replace(/^"|"$/g, "").replace(/""/g, '"')));
}

describe("Delcampe Easy Uploader export (#610)", () => {
  let userId: string;
  let collectionId: string;
  let collectionSlug: string;
  let platformId: string;
  let offerId: string;
  let secondOfferId: string;
  let offerNo: number;

  async function preparedOffer(name: string, price: string, red: number): Promise<string> {
    const id = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price,
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await updateOfferPhotoConfig(userId, id, {
      photoSides: "front",
      preferSingles: false,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageGridMode: "fixed" as const,
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });
    const condition = await prisma.stampCondition.findFirstOrThrow({ where: { collectionId } });
    const stamp = await prisma.stamp.create({
      data: { collectionId, name, primaryCatalogSortKey: catalogSortKeyOf(String(red)) },
    });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId: condition.id,
      forSale: true,
    });
    const upload = await stageUpload(userId, collectionId, {
      bytes: await scan(red),
      mime: "image/png",
    });
    await applyPhotoChangeSet(userId, item.id, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
    await addOfferSet(userId, id, [item.id]);
    await prisma.offer.update({
      where: { id },
      data: { name, description: "One stamp, as scanned.", state: "ready" },
    });
    return id;
  }

  /** Stand in for the worker: queue the run, claim it, render it. */
  async function generatePhotos(id: string): Promise<void> {
    await enqueueOfferPhotoGeneration(userId, id);
    await claimNextOfferPhotoGeneration({ offerId: id });
    await runOfferPhotoGeneration(id);
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-delcexp-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User delcexp-${ts}`,
        email: `test-delcexp-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionSlug = `col-delcexp-${ts}`;
    collectionId = (
      await prisma.collection.create({
        data: { slug: collectionSlug, name: `Collection delcexp-${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    await prisma.stampCondition.create({
      data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
    });
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: "Delcampe",
          platform: true,
          platformCurrency: "EUR",
          maxPhotos: 6,
          maxPhotoEdge: 900,
          // The cap the export refuses over (#610) — a platform setting, never a constant.
          maxTitleLength: 80,
        },
      })
    ).id;
    await setDelcampePlatform(userId, collectionId, platformId);
    await createDelcampeListingProfile(userId, collectionId, {
      ...DELCAMPE_PROFILE_DEFAULTS,
      name: "Standard letter",
      shippingModel: "Fee template",
    });

    offerId = await preparedOffer("Poland 1921 Sowing Man used", "0.10", 40);
    offerNo = (await prisma.offer.findUniqueOrThrow({ where: { id: offerId }, select: { offerNo: true } })).offerNo;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("refuses the whole batch, naming every reason, before a file exists", async () => {
    const result = await buildDelcampeUploadBundle(userId, collectionId, [offerId]);
    assert.equal(result.ok, false);
    assert.ok(!result.ok);
    assert.equal(result.refusals.length, 1);
    const [refusal] = result.refusals;
    assert.equal(refusal.offerId, offerId);
    assert.equal(refusal.label, "Poland 1921 Sowing Man used");
    // Both faults at once — a category nobody picked and photos nobody generated.
    assert.ok(refusal.reasons.some((r) => /category/.test(r)), refusal.reasons.join(" | "));
    assert.ok(refusal.reasons.some((r) => /no generated images|no photos/.test(r)), refusal.reasons.join(" | "));
  });

  it("exports a CSV whose images column names exactly the files in the bundle", async () => {
    await setDelcampeOfferCategory(userId, offerId, {
      categoryId: "7945",
      categoryName: "Used stamps",
      categoryPath: "Stamps > Europe > Poland > 1944-60 > Used stamps",
    });
    await generatePhotos(offerId);

    const result = await buildDelcampeUploadBundle(userId, collectionId, [offerId]);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.bundle.rowCount, 1);

    const entries = readZipEntries(result.bundle.bytes);
    assert.equal(entries[0].name, DELCAMPE_UPLOAD_CSV_NAME, "the file that names the rest goes first");
    const pictures = entries.slice(1).map((entry) => entry.name);
    assert.equal(pictures.length, result.bundle.imageCount);
    assert.ok(pictures.length > 0);
    // Flat: the CSV names its pictures by file name and nothing else.
    assert.ok(pictures.every((name) => !name.includes("/")), pictures.join(" | "));

    const [row] = csvRows(entries[0].contents.toString("utf8"));
    const [categoryId, title, personalReference, description, sellingType, price, bidStep, quantity, images] = row;
    assert.equal(categoryId, "7945");
    assert.equal(title, "Poland 1921 Sowing Man used");
    // The offer's own number and nothing else (#635): the column is capped at 20 characters, and
    // the export no longer needs the instance to know its own address to write one.
    assert.equal(personalReference, String(offerNo));
    assert.ok(personalReference.length <= 20);
    assert.equal(description, "One stamp, as scanned.");
    assert.equal(sellingType, "fixed_price");
    assert.equal(price, "0,10", "the upload direction writes a decimal comma (#611 reads a dot back)");
    assert.equal(bidStep, "0,01");
    assert.equal(quantity, "1");
    assert.deepEqual(images.split("|"), pictures, "the column and the archive name the same files");
  });

  it("refuses an over-long title rather than truncating it", async () => {
    await prisma.offer.update({ where: { id: offerId }, data: { name: "x".repeat(84) } });
    const result = await buildDelcampeUploadBundle(userId, collectionId, [offerId]);
    assert.ok(!result.ok);
    assert.match(result.refusals[0].reasons[0], /84 characters, 4 over this platform's 80/);
    await prisma.offer.update({
      where: { id: offerId },
      data: { name: "Poland 1921 Sowing Man used" },
    });
  });

  it("keeps two offers' pictures apart in a flat archive", async () => {
    // The same title, so both offers slug the same and every file name would collide.
    secondOfferId = await preparedOffer("Poland 1921 Sowing Man used", "1.50", 90);
    await setDelcampeOfferCategory(userId, secondOfferId, {
      categoryId: "7946",
      categoryName: "Used stamps",
      categoryPath: null,
    });
    await generatePhotos(secondOfferId);

    const result = await buildDelcampeUploadBundle(userId, collectionId, [offerId, secondOfferId]);
    assert.ok(result.ok, JSON.stringify(result));
    assert.equal(result.bundle.rowCount, 2);

    const entries = readZipEntries(result.bundle.bytes);
    const pictures = entries.slice(1).map((entry) => entry.name);
    assert.equal(new Set(pictures).size, pictures.length, "no two files share a name");

    const rows = csvRows(entries[0].contents.toString("utf8"));
    assert.deepEqual(rows.flatMap((row) => row[8].split("|")).sort(), [...pictures].sort());
    // The dearer listing takes the upper bid step, at the profile's seeded threshold of 1.
    assert.equal(rows[1][5], "1,50");
    assert.equal(rows[1][6], "0,10");
  });

  it("refuses an auction rather than uploading it as a quick buy", async () => {
    await prisma.offer.update({
      where: { id: secondOfferId },
      data: { listingType: "auction", startingPrice: "1.00" },
    });
    const result = await buildDelcampeUploadBundle(userId, collectionId, [offerId, secondOfferId]);
    assert.ok(!result.ok);
    assert.equal(result.refusals.length, 1, "the sound offer is not exported either — the batch is one file");
    assert.match(result.refusals[0].reasons[0], /auction/);
    await prisma.offer.update({
      where: { id: secondOfferId },
      data: { listingType: "fixed", startingPrice: null },
    });
  });

  it("refuses a batch that is not this collection's Delcampe platform, or not ready", async () => {
    const otherPlatformId = (
      await prisma.contact.create({ data: { collectionId, name: "Allegro", platform: true } })
    ).id;
    const elsewhere = await createOffer(userId, collectionId, {
      platformId: otherPlatformId,
      url: null,
      price: "1.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await assert.rejects(
      () => buildDelcampeUploadBundle(userId, collectionId, [elsewhere]),
      (err: unknown) => err instanceof DelcampeExportError && /not the platform/.test((err as Error).message)
    );

    await prisma.offer.update({ where: { id: offerId }, data: { state: "preparing" } });
    await assert.rejects(
      () => buildDelcampeUploadBundle(userId, collectionId, [offerId]),
      (err: unknown) => err instanceof DelcampeExportError && /not ready/.test((err as Error).message)
    );
    await prisma.offer.update({ where: { id: offerId }, data: { state: "ready" } });
  });

  it("refuses an offer from another collection rather than writing it into somebody's upload", async () => {
    const strangerId = `${userId}-stranger`;
    await prisma.user.create({
      data: {
        id: strangerId,
        name: "Stranger",
        email: `${strangerId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    try {
      await assert.rejects(
        () => buildDelcampeUploadBundle(strangerId, collectionId, [offerId]),
        /Collection not found/
      );
    } finally {
      await prisma.user.delete({ where: { id: strangerId } });
    }
  });
});
