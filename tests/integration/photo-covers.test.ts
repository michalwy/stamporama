import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import {
  addOfferSet,
  createOffer,
  getOfferDetail,
  setOfferState,
  updateOfferPhotoConfig,
} from "../../src/lib/offers";
import { applyPhotoChangeSet, stageUpload } from "../../src/lib/photos";
import {
  claimNextOfferPhotoGeneration,
  enqueueOfferPhotoGeneration,
  getOfferPhotoPlanState,
  markOfferPhotosNothingToCover,
  OfferPhotoGenerationError,
  readOfferCoverWalk,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { listItemPhotoCovers, PhotoCoverValidationError, savePhotoCovers } from "../../src/lib/photo-covers";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { getStorage, variantKey } from "../../src/lib/storage";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-photo-covers-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Covering symbols on offer photos (#1665): covers kept on the copy's photo, drawn into the offer's
// images only, checked once and remembered, and what an offer needing them asks before it is ready.

describe("covering symbols on offer photos (#1665)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let conditionId: string;
  /** A platform that needs covers — Facebook's rule. */
  let coveredPlatformId: string;
  /** One that does not. */
  let plainPlatformId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-covers-${ts}`;
    otherUserId = `test-user-covers-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-covers-${ts}`, name: `Covers ${ts}`, baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    coveredPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: `Covered ${ts}`, platform: true, maxPhotoEdge: 600, coverSymbols: true },
      })
    ).id;
    plainPlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: `Plain ${ts}`, platform: true, maxPhotoEdge: 600 },
      })
    ).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  let seq = 0;

  /** A copy with a bright red front scan, so a black bar drawn over it is unmistakable. */
  async function scannedCopy(): Promise<{ itemId: string; photoId: string }> {
    seq += 1;
    const stampRow = await prisma.stamp.create({
      data: { collectionId, name: `Reich ${seq}`, primaryCatalogSortKey: catalogSortKeyOf(String(seq)) },
    });
    const item = await createItem(userId, collectionId, { stampId: stampRow.id, conditionId, forSale: true });
    const bytes = await sharp({
      create: { width: 200, height: 200, channels: 3, background: { r: 230, g: 20, b: 20 } },
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

  async function preparingOffer(platformId: string, itemIds: string[]): Promise<string> {
    const offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "9.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      preferSingles: false,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageGridMode: "fixed" as const,
        collageGridShape: "landscape" as const,
        collageRows: 1,
        collageColumns: 1,
        collageGapPercent: 0,
        collageBackground: "#ffffff",
        collageLabelPercent: 1,
      },
    });
    for (const itemId of itemIds) await addOfferSet(userId, offerId, [itemId]);
    return offerId;
  }

  async function generate(offerId: string): Promise<void> {
    await enqueueOfferPhotoGeneration(userId, offerId);
    await claimNextOfferPhotoGeneration({ offerId });
    await runOfferPhotoGeneration(offerId);
  }

  async function fullBytes(photoId: string): Promise<Buffer> {
    const photo = await prisma.photo.findUniqueOrThrow({ where: { id: photoId } });
    const object = await getStorage(photo.storageBackend).get(
      variantKey(photo.storageKey, "full", photo.mime),
      photo.mime,
      "delivery"
    );
    const chunks: Buffer[] = [];
    for await (const chunk of object.stream) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
    return Buffer.concat(chunks);
  }

  /** The centre pixel of the offer's one generated image. */
  async function generatedCentre(offerId: string): Promise<number[]> {
    const entry = await prisma.offerPhotoEntry.findFirstOrThrow({ where: { offerId } });
    const { data, info } = await sharp(await fullBytes(entry.photoId))
      .raw()
      .toBuffer({ resolveWithObject: true });
    const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    return [data[i], data[i + 1], data[i + 2]];
  }

  const codes = async (offerId: string) =>
    (await getOfferDetail(userId, offerId))?.readyBlockers.map((b) => b.code);

  it("holds an offer needing covers back from Ready until every photo is checked", async () => {
    const a = await scannedCopy();
    const b = await scannedCopy();
    const offerId = await preparingOffer(coveredPlatformId, [a.itemId, b.itemId]);
    await generate(offerId);

    const detail = await getOfferDetail(userId, offerId);
    const blocker = detail?.readyBlockers.find((r) => r.code === "photo-covers-unchecked");
    assert.ok(blocker && "count" in blocker && blocker.count === 2);
    await assert.rejects(() => setOfferState(userId, offerId, "ready"), /not been checked/);

    // The walk lists both, unchecked, in plan order.
    const walk = await readOfferCoverWalk(userId, offerId);
    assert.equal(walk.needed, true);
    assert.deepEqual(
      walk.photos.map((p) => [p.photoId, p.checked]),
      [
        [a.photoId, false],
        [b.photoId, false],
      ]
    );

    // Nothing to cover on either: both checked, and the images — unchanged by a pixel — stay current.
    await savePhotoCovers(userId, a.photoId, []);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).covers.uncheckedCount, 1);
    await savePhotoCovers(userId, b.photoId, []);
    assert.deepEqual(await codes(offerId), []);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).outOfDate, false);
    await setOfferState(userId, offerId, "ready");
  });

  it("draws covers into the offer's images only, and marks them out of date until regenerated", async () => {
    const copy = await scannedCopy();
    const offerId = await preparingOffer(coveredPlatformId, [copy.itemId]);
    await generate(offerId);
    const [r] = await generatedCentre(offerId);
    assert.ok(r > 200, "the uncovered image shows the red stamp");
    const original = await fullBytes(copy.photoId);

    await savePhotoCovers(userId, copy.photoId, [
      { shape: "rect", style: "bar", x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    ]);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).outOfDate, true);
    assert.deepEqual(await codes(offerId), ["photos-outdated"]);

    await generate(offerId);
    const centre = await generatedCentre(offerId);
    assert.ok(centre.every((c) => c < 40), `the covered centre is black, got ${centre}`);
    // The copy's own photo is the same bytes it was.
    assert.ok((await fullBytes(copy.photoId)).equals(original));
    assert.deepEqual(await codes(offerId), []);
  });

  it("draws a bar in its own colour, and a new colour puts the images out of date (#1702)", async () => {
    await prisma.contact.update({ where: { id: coveredPlatformId }, data: { coverColor: "#f3ead3" } });
    const copy = await scannedCopy();
    const offerId = await preparingOffer(coveredPlatformId, [copy.itemId]);
    // The walk starts the first bar in the platform's colour.
    assert.equal((await readOfferCoverWalk(userId, offerId)).defaultColor, "#f3ead3");

    const bar = { shape: "rect" as const, style: "bar" as const, x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    await savePhotoCovers(userId, copy.photoId, [{ ...bar, color: "#FFFFFF" }]);
    // The generated image is lossy, so a channel may land a step or two off the colour drawn.
    const near = (actual: number[], expected: number[]) =>
      assert.ok(actual.every((c, i) => Math.abs(c - expected[i]) <= 3), `expected ${expected}, got ${actual}`);
    await generate(offerId);
    near(await generatedCentre(offerId), [255, 255, 255]);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).outOfDate, false);

    await savePhotoCovers(userId, copy.photoId, [{ ...bar, color: "#f3ead3" }]);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).outOfDate, true);
    await generate(offerId);
    near(await generatedCentre(offerId), [0xf3, 0xea, 0xd3]);

    // Read back as saved; a pixelation sent with a colour is stored without one.
    await savePhotoCovers(userId, copy.photoId, [
      { ...bar, color: "#808080" },
      { ...bar, style: "pixelate", color: "#808080", x: 0, width: 0.2 },
    ]);
    const [state] = await listItemPhotoCovers(userId, copy.itemId);
    assert.deepEqual(
      state.covers.map((c) => [c.style, c.color]),
      [
        ["bar", "#808080"],
        ["pixelate", undefined],
      ]
    );
    await prisma.contact.update({ where: { id: coveredPlatformId }, data: { coverColor: "#000000" } });
  });

  it("the database holds a bar to one colour and anything else to none (#1702)", async () => {
    const copy = await scannedCopy();
    const row = { photoId: copy.photoId, shape: "rect", x: 0, y: 0, width: 0.5, height: 0.5 };
    await assert.rejects(() => prisma.photoCover.create({ data: { ...row, style: "bar" } }));
    await assert.rejects(() => prisma.photoCover.create({ data: { ...row, style: "bar", color: "red" } }));
    await assert.rejects(() => prisma.photoCover.create({ data: { ...row, style: "blur", color: "#ffffff" } }));
    await prisma.photoCover.create({ data: { ...row, style: "bar", color: "#ffffff" } });
  });

  it("remembers covers: the same piece on another offer needs nothing redone", async () => {
    const copy = await scannedCopy();
    const first = await preparingOffer(coveredPlatformId, [copy.itemId]);
    await savePhotoCovers(userId, copy.photoId, [
      { shape: "ellipse", style: "pixelate", x: 0.1, y: 0.1, width: 0.3, height: 0.3 },
    ]);
    await prisma.offer.update({ where: { id: first }, data: { state: "withdrawn" } });

    const second = await preparingOffer(coveredPlatformId, [copy.itemId]);
    await generate(second);
    assert.deepEqual(await codes(second), []);
    const walk = await readOfferCoverWalk(userId, second);
    assert.equal(walk.photos[0].covers[0].shape, "ellipse");
  });

  it("asks nothing and applies nothing where the platform needs no covers, unless the offer overrides it", async () => {
    const copy = await scannedCopy();
    await savePhotoCovers(userId, copy.photoId, [
      { shape: "rect", style: "bar", x: 0.25, y: 0.25, width: 0.5, height: 0.5 },
    ]);
    const unchecked = await scannedCopy();
    const offerId = await preparingOffer(plainPlatformId, [copy.itemId, unchecked.itemId]);
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      preferSingles: false,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageGridMode: "fixed" as const,
        collageGridShape: "landscape" as const,
        collageRows: 1,
        collageColumns: 1,
        collageGapPercent: 0,
        collageBackground: "#ffffff",
        collageLabelPercent: 1,
      },
    });
    await generate(offerId);
    assert.deepEqual(await codes(offerId), []);
    const entry = await prisma.offerPhotoEntry.findFirstOrThrow({
      where: { offerId, itemIds: { has: copy.itemId } },
    });
    const { data, info } = await sharp(await fullBytes(entry.photoId)).raw().toBuffer({ resolveWithObject: true });
    const i = (Math.floor(info.height / 2) * info.width + Math.floor(info.width / 2)) * info.channels;
    assert.ok(data[i] > 200, "covers are not applied on a platform that needs none");

    // Overriding it on: the unchecked photo now holds the offer back, and the drawn cover applies.
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      preferSingles: false,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageGridMode: "fixed" as const,
        collageGridShape: "landscape" as const,
        collageRows: 1,
        collageColumns: 1,
        collageGapPercent: 0,
        collageBackground: "#ffffff",
        collageLabelPercent: 1,
      },
      coverSymbols: true,
    });
    assert.deepEqual(await codes(offerId), ["photos-outdated", "photo-covers-unchecked"]);
  });

  it("an offer can switch covers off on a platform that needs them", async () => {
    const copy = await scannedCopy();
    const offerId = await preparingOffer(coveredPlatformId, [copy.itemId]);
    await prisma.offer.update({ where: { id: offerId }, data: { coverSymbols: false } });
    await generate(offerId);
    assert.deepEqual(await codes(offerId), []);
    assert.equal((await readOfferCoverWalk(userId, offerId)).needed, false);
  });

  it("refuses covers on a photo that is not the owner's copy photo", async () => {
    const copy = await scannedCopy();
    await assert.rejects(() => savePhotoCovers(otherUserId, copy.photoId, []), PhotoCoverValidationError);
    await assert.rejects(
      () => savePhotoCovers(userId, copy.photoId, [{ shape: "rect", style: "bar", x: 2, y: 0, width: 1, height: 1 }]),
      PhotoCoverValidationError
    );
    const states = await listItemPhotoCovers(userId, copy.itemId);
    assert.deepEqual(states, [{ photoId: copy.photoId, checked: false, covers: [] }]);
    assert.deepEqual(await listItemPhotoCovers(otherUserId, copy.itemId), []);
  });

  it("marks the remaining photos nothing to cover in one action, a copy's or all, touching only the unchecked (#1701)", async () => {
    const covered = await scannedCopy();
    const a = await scannedCopy();
    const b = await scannedCopy();
    const c = await scannedCopy();
    const offerId = await preparingOffer(coveredPlatformId, [covered.itemId, a.itemId, b.itemId, c.itemId]);
    await generate(offerId);
    const bar = { shape: "rect" as const, style: "bar" as const, x: 0.25, y: 0.25, width: 0.5, height: 0.5 };
    await savePhotoCovers(userId, covered.photoId, [bar]);
    await generate(offerId);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).covers.uncheckedCount, 3);

    // Someone else's offer is refused outright.
    await assert.rejects(() => markOfferPhotosNothingToCover(otherUserId, offerId), OfferPhotoGenerationError);

    // One copy's photos only.
    assert.deepEqual(await markOfferPhotosNothingToCover(userId, offerId, a.itemId), [a.photoId]);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).covers.uncheckedCount, 2);

    // Then every one remaining: the covered photo keeps its cover, and the marked ones are recorded
    // exactly as pressing *nothing to cover* on each would be.
    assert.deepEqual(
      new Set(await markOfferPhotosNothingToCover(userId, offerId)),
      new Set([b.photoId, c.photoId])
    );
    assert.deepEqual(await markOfferPhotosNothingToCover(userId, offerId), []);
    const walk = await readOfferCoverWalk(userId, offerId);
    assert.deepEqual(
      walk.photos.map((p) => [p.photoId, p.checked, p.covers.length]),
      [
        [covered.photoId, true, 1],
        [a.photoId, true, 0],
        [b.photoId, true, 0],
        [c.photoId, true, 0],
      ]
    );
    // Nothing drawn changed, so the images stay current and the offer goes ready.
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).outOfDate, false);
    assert.deepEqual(await codes(offerId), []);
    await setOfferState(userId, offerId, "ready");

    // A later offer reuses the check, and a marked photo can still be given covers.
    const later = await preparingOffer(coveredPlatformId, [b.itemId]);
    assert.equal((await getOfferPhotoPlanState(userId, later)).covers.uncheckedCount, 0);
    await savePhotoCovers(userId, b.photoId, [bar]);
    assert.equal((await readOfferCoverWalk(userId, later)).photos[0].covers.length, 1);
  });

  it("a platform newly named as Facebook starts needing covers, and naming it again keeps the collector's choice", async () => {
    const fb = (
      await prisma.contact.create({ data: { collectionId, name: `Facebook ${seq}`, platform: true } })
    ).id;
    await setFacebookPlatform(userId, collectionId, fb);
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: fb } })).coverSymbols, true);

    await prisma.contact.update({ where: { id: fb }, data: { coverSymbols: false } });
    await setFacebookPlatform(userId, collectionId, fb);
    assert.equal((await prisma.contact.findUniqueOrThrow({ where: { id: fb } })).coverSymbols, false);
  });
});
