import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, updateOfferPhotoConfig } from "../../src/lib/offers";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import {
  attachOfferCopyPhoto,
  attachOfferItemFrontPhotos,
  attachOfferPhotoCollage,
  attachOfferUpload,
  listOfferPhotoAttachments,
  OfferPhotoAttachmentError,
  removeOfferPhotoAttachment,
  setOfferPhotoPlanOrder,
  setOfferPhotoPublish,
} from "../../src/lib/offer-photo-attachments";
import {
  buildOfferPhotoArchive,
  claimNextOfferPhotoGeneration,
  enqueueOfferPhotoGeneration,
  getOfferPhotoPlanState,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { getStorage, variantKey } from "../../src/lib/storage";
import { catalogSortKeyOf } from "../../src/lib/catalog-sort-key";

const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-offer-attachments-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Manual photo attachments on an offer (#313). Placement and truncation are unit-tested on the pure
// plan engine (#309); what needs a database and a storage backend is the wiring:
//
//   - a copy's *specific* photo, and an arbitrary upload, both become plan entries;
//   - they hold explicit positions between the generated groups, and a reorder rewrites them;
//   - a run renders them as annotated one-tile images, with their own entry `source`;
//   - removing an upload takes its bytes with it; removing a copy attachment leaves the scan alone;
//   - the guards: a copy outside the offer, a photo that is not that copy's, another user's offer;
//   - and, since #331, a collage the collector composed by hand: several chosen photos — a copy's
//     scan and an upload mixed freely — rendered as one image at the width they picked, whose
//     uploaded tiles go with it and whose borrowed scans do not.

async function scan(width: number, height: number, red: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: red, g: 90, b: 160 } },
  })
    .png()
    .toBuffer();
}

async function bytesExist(photo: {
  storageBackend: string;
  storageKey: string;
  mime: string;
}): Promise<boolean> {
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

/** The names in a ZIP, in written order — walking the local file headers. Names only, so unlike the
 * reader in `offer-photo-generation.test.ts` this one never has to inflate a payload. */
function zipEntryNames(archive: Buffer): string[] {
  const names: string[] = [];
  let offset = 0;
  while (offset + 4 <= archive.length && archive.readUInt32LE(offset) === 0x04034b50) {
    const compressedSize = archive.readUInt32LE(offset + 18);
    const nameLength = archive.readUInt16LE(offset + 26);
    const extraLength = archive.readUInt16LE(offset + 28);
    names.push(archive.subarray(offset + 30, offset + 30 + nameLength).toString("utf8"));
    offset = offset + 30 + nameLength + extraLength + compressedSize;
  }
  return names;
}

describe("offer photo attachments (#313)", () => {
  let userId: string;
  let strangerId: string;
  let collectionId: string;
  let offerId: string;
  /** The stem every one of this offer's file names starts with (#326). The fixture offer is
   *  unnamed, so it falls back to a slice of the offer's id. A function, not a constant: `offerId`
   *  is only assigned in `before`. */
  const stem = () => `offer-${offerId.slice(-6)}`;
  /** The one copy in the offer, with a front and a back scan. */
  let itemId: string;
  let frontPhotoId: string;
  let backPhotoId: string;
  /** A copy of the same collection that the offer does **not** hold. */
  let outsiderItemId: string;
  let outsiderPhotoId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-offer-attach-${ts}`;
    strangerId = `test-user-offer-attach-other-${ts}`;
    for (const [id, label] of [
      [userId, "owner"],
      [strangerId, "stranger"],
    ] as const) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User offer-attach-${label}-${ts}`,
          email: `test-offer-attach-${label}-${ts}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    const col = await prisma.collection.create({
      data: {
        slug: `col-offer-attach-${ts}`,
        name: `Collection offer-attach-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: `Delcampe ${ts}`,
          platform: true,
          maxPhotos: 6,
          maxPhotoEdge: 700,
        },
      })
    ).id;

    offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "10.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    // A literal in the label template is what an attachment with no copy renders (#313 mode b):
    // `{ref}` resolves empty against no copy, and the engine tidies what it leaves behind.
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "both",
      preferSingles: false,
      photoLabelLeftTemplate: "{ref}",
      photoLabelRightTemplate: "Lot 7",
      collage: {
        collageGridMode: "fixed",
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });

    const makeCopy = async (index: number) => {
      const stamp = await prisma.stamp.create({
        data: { collectionId, name: `Stamp ${index}`, primaryCatalogSortKey: catalogSortKeyOf(String(index)) },
      });
      const item = await createItem(userId, collectionId, {
        stampId: stamp.id,
        conditionId,
        forSale: true,
      });
      for (const [role, red] of [
        ["front", 20 + index * 30],
        ["back", 180 - index * 30],
      ] as const) {
        const upload = await stageUpload(userId, collectionId, {
          bytes: await scan(120, 160, red),
          mime: "image/png",
        });
        await applyPhotoChangeSet(userId, item.id, {
          add: [{ uploadId: upload.id, role, title: null, sortOrder: 0 }],
          update: [],
          remove: [],
        });
      }
      return item.id;
    };

    itemId = await makeCopy(0);
    outsiderItemId = await makeCopy(1);
    await addOfferSet(userId, offerId, [itemId]);

    const photos = await prisma.photo.findMany({ where: { itemId }, select: { id: true, role: true } });
    frontPhotoId = photos.find((p) => p.role === "front")!.id;
    backPhotoId = photos.find((p) => p.role === "back")!.id;
    outsiderPhotoId = (await prisma.photo.findFirst({
      where: { itemId: outsiderItemId, role: "front" },
      select: { id: true },
    }))!.id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, strangerId] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("refuses a copy the offer does not hold, and a photo that is not that copy's", async () => {
    await assert.rejects(
      () => attachOfferCopyPhoto(userId, offerId, { itemId: outsiderItemId, photoId: outsiderPhotoId }),
      OfferPhotoAttachmentError,
      "a copy outside the offer would show a stamp the buyer is not being sold"
    );
    await assert.rejects(
      () => attachOfferCopyPhoto(userId, offerId, { itemId, photoId: outsiderPhotoId }),
      OfferPhotoAttachmentError
    );
    await assert.rejects(
      () => attachOfferCopyPhoto(strangerId, offerId, { itemId, photoId: frontPhotoId }),
      OfferPhotoAttachmentError
    );
    await assert.rejects(
      () => listOfferPhotoAttachments(strangerId, offerId),
      OfferPhotoAttachmentError
    );
  });

  it("attaches a specific photo of a copy, at the end of the plan", async () => {
    const attachment = await attachOfferCopyPhoto(userId, offerId, {
      itemId,
      photoId: backPhotoId,
      title: "Perforation",
    });
    assert.equal(attachment.source, "copy_photo");
    assert.equal(attachment.itemId, itemId);
    assert.equal(attachment.photoId, backPhotoId);

    const state = await getOfferPhotoPlanState(userId, offerId);
    // One copy with both scans → a front and a back collage, then the attachment.
    assert.deepEqual(
      state.plan.images.map((i) => [i.source, i.side, i.attachmentId]),
      [
        ["collage", "front", null],
        ["collage", "back", null],
        ["copy_photo", null, attachment.id],
      ]
    );
    assert.equal(state.plan.images[2].title, "Perforation");
    assert.deepEqual(state.plan.images[2].copyLabels.length, 1, "it renders from a copy, so it is labelled");
  });

  it("attaches an uploaded image, promoting the staged bytes to an offer-owned original", async () => {
    const upload = await stageUpload(userId, collectionId, {
      bytes: await scan(300, 200, 240),
      mime: "image/png",
    });
    const attachment = await attachOfferUpload(userId, offerId, upload.id, "Shipping note");
    assert.equal(attachment.source, "upload");
    assert.equal(attachment.itemId, null);

    const photo = await prisma.photo.findUnique({ where: { id: attachment.photoId! } });
    assert.equal(photo?.offerId, offerId, "an uploaded attachment is owned by the offer");
    assert.equal(photo?.kind, "original", "it is a source image, not something the app generated");
    assert.equal(photo?.itemId, null);
    assert.ok(await bytesExist(photo!), "the staged bytes moved to their permanent key");
    assert.equal(
      await prisma.photoUpload.count({ where: { id: upload.id } }),
      0,
      "the staging row is consumed"
    );

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.plan.imageCount, 4);
    assert.equal(state.plan.images[3].source, "upload");
    assert.deepEqual(state.plan.images[3].copyLabels, [], "an upload has no copy to name");
  });

  it("reorders the whole plan by tokens — attachments between the generated groups", async () => {
    // Natural order is [front, back, detail(copy_photo), note(upload)]. Drag it into
    // [detail, front, note, back] and store that as the plan order.
    const before = await getOfferPhotoPlanState(userId, offerId);
    const tok = (pred: (i: (typeof before.plan.images)[number]) => boolean) =>
      before.plan.images.find(pred)!.token;
    const front = tok((i) => i.source === "collage" && i.side === "front");
    const back = tok((i) => i.source === "collage" && i.side === "back");
    const detail = tok((i) => i.source === "copy_photo");
    const note = tok((i) => i.source === "upload");
    await setOfferPhotoPlanOrder(userId, offerId, [detail, front, note, back]);

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.deepEqual(
      state.plan.images.map((i) => [i.source, i.side]),
      [
        ["copy_photo", null],
        ["collage", "front"],
        ["upload", null],
        ["collage", "back"],
      ]
    );
  });

  it("renders the attachments in their planned positions, each as its own entry", async () => {
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "ready");
    assert.equal(state.outOfDate, false, "the fingerprint covers the attachments too");
    assert.deepEqual(
      state.images.map((i) => [i.sortOrder, i.source, i.side]),
      [
        [0, "copy_photo", null],
        [1, "collage", "front"],
        [2, "upload", null],
        [3, "collage", "back"],
      ]
    );
    // File names are the offer's stem (#326) plus a dense 1..n run in plan order, attachments
    // included (#314).
    assert.deepEqual(
      state.images.map((i) => i.fileName),
      [1, 2, 3, 4].map((n) => `${stem()}-0${n}.jpg`)
    );

    const rendered = await prisma.photo.findMany({
      where: { id: { in: state.images.map((i) => i.photoId) } },
    });
    for (const photo of rendered) {
      assert.equal(photo.offerId, offerId);
      assert.equal(photo.kind, "generated", "even an attachment is rendered, never passed through");
      assert.equal(photo.mime, "image/jpeg");
      assert.ok(await bytesExist(photo));
    }
    // The uploaded original is a source, not an output: the run must not have swapped it away.
    const originals = await prisma.photo.findMany({ where: { offerId, kind: "original" } });
    assert.equal(originals.length, 1);
    assert.ok(await bytesExist(originals[0]));
  });

  it("applies a reorder to the stored images themselves, without regenerating anything", async () => {
    const before = await getOfferPhotoPlanState(userId, offerId);
    // Reverse the order — a different upload sequence for the very same images.
    await setOfferPhotoPlanOrder(
      userId,
      offerId,
      [...before.plan.images].reverse().map((i) => i.token)
    );

    const after = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(
      after.outOfDate,
      false,
      "a reorder changes no image, so there is nothing to regenerate"
    );
    assert.deepEqual(
      after.images.map((i) => i.photoId),
      [...before.images].reverse().map((i) => i.photoId),
      "the stored files are renumbered into the new order"
    );
    assert.deepEqual(
      after.images.map((i) => i.fileName),
      [1, 2, 3, 4].map((n) => `${stem()}-0${n}.jpg`),
      "and keep a dense upload run"
    );
    assert.deepEqual(
      after.images.map((i) => i.token),
      after.plan.images.map((i) => i.token),
      "the stored list and the plan agree on the sequence"
    );

    // Put it back, so the tests that follow read the order they were written against.
    await setOfferPhotoPlanOrder(userId, offerId, before.plan.images.map((i) => i.token));
  });

  it("keeps an image over the platform's limit generated, but out of the upload set and the ZIP", async () => {
    // The platform takes 6; this offer plans 4. Squeeze it to 2 and the last two are over the limit
    // — still rendered and stored, just not going up.
    await prisma.contact.update({
      where: { id: (await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).platformId },
      data: { maxPhotos: 2 },
    });

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.plan.imageCount, 4, "nothing is dropped from the plan");
    assert.equal(state.plan.uploadCount, 2);
    assert.equal(state.plan.overLimitCount, 2);
    assert.deepEqual(
      state.images.map((i) => i.fileName),
      [`${stem()}-01.jpg`, `${stem()}-02.jpg`, `${stem()}-over-limit-01.jpg`, `${stem()}-over-limit-02.jpg`],
      "only the upload set takes upload numbers"
    );

    const archive = await buildOfferPhotoArchive(userId, offerId);
    assert.deepEqual(
      zipEntryNames(archive.bytes),
      [`${stem()}-01.jpg`, `${stem()}-02.jpg`],
      "the ZIP is the upload set alone"
    );

    await prisma.contact.update({
      where: { id: (await prisma.offer.findUniqueOrThrow({ where: { id: offerId } })).platformId },
      data: { maxPhotos: 6 },
    });
  });

  it("holds a collage back from the upload set when it is marked do-not-publish", async () => {
    const before = await getOfferPhotoPlanState(userId, offerId);
    const collage = before.plan.images.find((i) => i.source === "collage")!;

    await setOfferPhotoPublish(userId, offerId, collage.token, false);

    const state = await getOfferPhotoPlanState(userId, offerId);
    const held = state.images.find((i) => i.token === collage.token)!;
    assert.equal(held.publish, false);
    assert.ok(held.fileName.startsWith(`${stem()}-unpublished-`), "it takes no upload number");
    assert.equal(state.plan.uploadCount, 3, "the other three still go up");
    assert.equal(
      state.outOfDate,
      false,
      "the image is unchanged — holding it back is not a reason to regenerate"
    );
    assert.ok(await bytesExist((await prisma.photo.findUniqueOrThrow({ where: { id: held.photoId } }))));

    const archive = await buildOfferPhotoArchive(userId, offerId);
    assert.deepEqual(
      zipEntryNames(archive.bytes),
      [1, 2, 3].map((n) => `${stem()}-0${n}.jpg`),
      "the held-back image is absent and the run stays dense"
    );

    await setOfferPhotoPublish(userId, offerId, collage.token, true);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).plan.uploadCount, 4);
  });

  it("previews a planned collage with the image generated for it", async () => {
    const state = await getOfferPhotoPlanState(userId, offerId);
    for (const image of state.plan.images) {
      assert.ok(image.generatedPhotoId, `${image.token} has been generated`);
      assert.equal(
        image.previewPhotoId,
        image.generatedPhotoId,
        "the plan shows the real image, not one of its stamps"
      );
    }
  });

  it("removes an upload with its bytes, and a copy attachment without touching the scan", async () => {
    const attachments = await listOfferPhotoAttachments(userId, offerId);
    const upload = attachments.find((a) => a.source === "upload")!;
    const copyAttachment = attachments.find((a) => a.source === "copy_photo")!;
    const uploadPhoto = (await prisma.photo.findUnique({ where: { id: upload.photoId! } }))!;

    await assert.rejects(
      () => removeOfferPhotoAttachment(strangerId, upload.id),
      OfferPhotoAttachmentError
    );

    await removeOfferPhotoAttachment(userId, upload.id);
    assert.equal(await prisma.photo.count({ where: { id: upload.photoId! } }), 0);
    assert.equal(await bytesExist(uploadPhoto), false, "an uploaded image exists only for its attachment");

    await removeOfferPhotoAttachment(userId, copyAttachment.id);
    const scanRow = await prisma.photo.findUnique({ where: { id: copyAttachment.photoId! } });
    assert.ok(scanRow, "the copy still owns its scan");
    assert.ok(await bytesExist(scanRow!), "and its bytes");

    assert.deepEqual(await listOfferPhotoAttachments(userId, offerId), []);
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.deepEqual(
      state.plan.images.map((i) => i.source),
      ["collage", "collage"],
      "the plan is back to what the composition alone produces"
    );
    assert.equal(
      state.images.length,
      4,
      "the images already generated are kept — removing an attachment is a plan change"
    );
  });

  it("reorders the generated collages themselves and renders in that order", async () => {
    // Only the two collage sides remain now (#313 independent plan order): put the back before the
    // front and regenerate, and the stored images take that order.
    const before = await getOfferPhotoPlanState(userId, offerId);
    const front = before.plan.images.find((i) => i.side === "front")!.token;
    const back = before.plan.images.find((i) => i.side === "back")!.token;
    await setOfferPhotoPlanOrder(userId, offerId, [back, front]);

    const planned = await getOfferPhotoPlanState(userId, offerId);
    assert.deepEqual(
      planned.plan.images.map((i) => i.side),
      ["back", "front"],
      "the collage order is the collector's now, not front-before-back"
    );

    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "ready");
    assert.equal(state.outOfDate, false, "the fingerprint covers the manual order");
    assert.deepEqual(
      state.images.map((i) => [i.sortOrder, i.side]),
      [
        [0, "back"],
        [1, "front"],
      ],
      "the stored images are numbered in the collector's order"
    );
  });

  it("builds one collage from a hand-picked selection, mixing a copy's scan with an upload (#331)", async () => {
    const upload = await stageUpload(userId, collectionId, {
      bytes: await scan(300, 200, 60),
      mime: "image/png",
    });
    const attachment = await attachOfferPhotoCollage(userId, offerId, {
      tiles: [
        { kind: "copy_photo", itemId, photoId: frontPhotoId },
        { kind: "upload", uploadId: upload.id },
      ],
      columns: 2,
      title: "Detail pair",
    });

    assert.equal(attachment.source, "manual_collage");
    assert.equal(attachment.photoId, null, "a collage shows its tiles, not one photo");
    assert.equal(attachment.collageColumns, 2);
    const tiles = await prisma.offerPhotoAttachmentTile.findMany({
      where: { attachmentId: attachment.id },
      orderBy: { sortOrder: "asc" },
    });
    assert.deepEqual(
      tiles.map((t) => [t.source, t.itemId]),
      [
        ["copy_photo", itemId],
        ["upload", null],
      ],
      "the tiles keep the order they were picked in"
    );
    const uploadedTile = tiles[1];
    const tilePhoto = (await prisma.photo.findUnique({ where: { id: uploadedTile.photoId } }))!;
    assert.equal(tilePhoto.offerId, offerId, "a collage's uploaded tile is owned by the offer");
    assert.equal(tilePhoto.kind, "original");
    assert.ok(await bytesExist(tilePhoto), "the staged bytes moved to their permanent key");
    assert.equal(await prisma.photoUpload.count({ where: { id: upload.id } }), 0);

    const planned = await getOfferPhotoPlanState(userId, offerId);
    // Found by id, not by position: the offer already carries a manual plan order, so a newcomer
    // seats itself after its natural predecessor rather than at the end (#313).
    const entry = planned.plan.images.find((i) => i.attachmentId === attachment.id)!;
    assert.equal(entry.source, "manual_collage");
    assert.equal(entry.attachmentId, attachment.id);
    assert.equal(entry.tileCount, 2);
    assert.equal(entry.title, "Detail pair");
    assert.deepEqual(entry.copyLabels.length, 1, "only one of its two tiles comes from a copy");

    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.outOfDate, false, "the fingerprint covers the collage's tiles and width");
    const image = state.images.find((i) => i.token === entry.token)!;
    assert.equal(image.source, "manual_collage");
    assert.deepEqual(image.itemIds, [itemId], "an uploaded tile has no copy to name");
    assert.ok(
      image.width > image.height,
      "two tiles side by side make a wide image; one on its own would not"
    );
  });

  it("removes a hand-built collage, taking only its own uploaded tiles (#331)", async () => {
    const attachment = (await listOfferPhotoAttachments(userId, offerId)).find(
      (a) => a.source === "manual_collage"
    )!;
    const tiles = await prisma.offerPhotoAttachmentTile.findMany({
      where: { attachmentId: attachment.id },
    });
    const uploadedPhotoId = tiles.find((t) => t.source === "upload")!.photoId;
    const uploadedPhoto = (await prisma.photo.findUnique({ where: { id: uploadedPhotoId } }))!;

    await removeOfferPhotoAttachment(userId, attachment.id);

    assert.equal(await prisma.offerPhotoAttachmentTile.count({ where: { attachmentId: attachment.id } }), 0);
    assert.equal(await prisma.photo.count({ where: { id: uploadedPhotoId } }), 0);
    assert.equal(await bytesExist(uploadedPhoto), false, "its uploaded tile existed for it alone");
    const scanRow = await prisma.photo.findUnique({ where: { id: frontPhotoId } });
    assert.ok(scanRow && (await bytesExist(scanRow)), "the copy still owns the scan it lent");
  });

  it("drops an attachment from the plan when the photo it shows is deleted", async () => {
    const attachment = await attachOfferCopyPhoto(userId, offerId, { itemId, photoId: frontPhotoId });
    await prisma.photo.delete({ where: { id: frontPhotoId } });
    assert.deepEqual(
      await prisma.offerPhotoAttachment.findMany({ where: { id: attachment.id } }),
      [],
      "the attachment cascades with the scan it pointed at"
    );
  });
});

// One photo per copy (#434) — the bulk form of mode a. Its own fixture and its own offer: the rules
// it exists for are about a *whole* offer (which copies it covers, which it names, what a second
// press does), and the offer above has been attached to, reordered and regenerated test by test.
describe("one photo per copy (#434)", () => {
  let userId: string;
  let collectionId: string;
  let offerId: string;
  /** A copy with a front scan, one with a back scan only, and one with no photos at all. */
  let withFrontId: string;
  let backOnlyId: string;
  let unscannedId: string;
  /** A copy in a set of its own, so that set does produce a collage. */
  let collagedId: string;
  let frontId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-offer-bulk-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offer-bulk-${ts}`,
        email: `test-offer-bulk-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: {
          slug: `col-offer-bulk-${ts}`,
          name: `Collection offer-bulk-${ts}`,
          baseCurrency: "EUR",
          ownerId: userId,
        },
      })
    ).id;
    const conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    const platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: `Delcampe bulk ${ts}`,
          platform: true,
          maxPhotos: 12,
          maxPhotoEdge: 700,
        },
      })
    ).id;
    offerId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "10.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      preferSingles: false,
      photoLabelLeftTemplate: "{ref}",
      photoLabelRightTemplate: "",
      collage: {
        collageGridMode: "fixed",
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });

    const makeCopy = async (index: number, roles: readonly ("front" | "back")[]) => {
      const stamp = await prisma.stamp.create({
        data: { collectionId, name: `Bulk stamp ${index}`, primaryCatalogSortKey: catalogSortKeyOf(String(index)) },
      });
      const item = await createItem(userId, collectionId, {
        stampId: stamp.id,
        conditionId,
        forSale: true,
      });
      for (const role of roles) {
        const upload = await stageUpload(userId, collectionId, {
          bytes: await scan(120, 160, 20 + index * 40),
          mime: "image/png",
        });
        await applyPhotoChangeSet(userId, item.id, {
          add: [{ uploadId: upload.id, role, title: null, sortOrder: 0 }],
          update: [],
          remove: [],
        });
      }
      return item.id;
    };

    withFrontId = await makeCopy(0, ["front", "back"]);
    backOnlyId = await makeCopy(1, ["back"]);
    unscannedId = await makeCopy(2, []);
    await addOfferSet(userId, offerId, [withFrontId, backOnlyId, unscannedId]);
    // A second set every copy of which has a front scan, so the offer plans a collage as well: the
    // first set cannot produce one, and an attachment has to be seen landing *after* the collages.
    collagedId = await makeCopy(3, ["front"]);
    await addOfferSet(userId, offerId, [collagedId]);
    frontId = (await prisma.photo.findFirstOrThrow({
      where: { itemId: withFrontId, role: "front" },
      select: { id: true },
    })).id;
  });

  after(async () => {
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("attaches every front scan and names the copies it could not cover", async () => {
    const result = await attachOfferItemFrontPhotos(userId, offerId);

    assert.equal(result.attached, 2, "the two copies that have a front scan");
    assert.equal(result.alreadyAttached, 0);
    assert.deepEqual(
      [...result.skipped].sort(),
      ["Bulk stamp 1", "Bulk stamp 2"],
      "a back-only copy is skipped like an unscanned one, and both are named rather than counted"
    );

    const attachments = await listOfferPhotoAttachments(userId, offerId);
    assert.deepEqual(
      attachments.map((a) => [a.source, a.itemId]),
      [
        ["copy_photo", withFrontId],
        ["copy_photo", collagedId],
      ],
      "one per covered copy, in set order"
    );
    assert.equal(
      attachments[0].photoId,
      frontId,
      "the front scan, and never a back or an extra in its place"
    );
    assert.ok(
      attachments.every((a) => a.itemId !== backOnlyId && a.itemId !== unscannedId),
      "a copy without a front scan gets no attachment at all"
    );
  });

  it("tops the plan up rather than doubling it when pressed again", async () => {
    const again = await attachOfferItemFrontPhotos(userId, offerId);
    assert.equal(again.attached, 0);
    assert.equal(again.alreadyAttached, 2, "both front scans are already attachments of their own");
    assert.equal(
      (await listOfferPhotoAttachments(userId, offerId)).length,
      2,
      "no second attachment for the same scan"
    );
  });

  it("lands at the end of the plan, after the generated collages", async () => {
    const state = await getOfferPhotoPlanState(userId, offerId);
    const last = state.plan.images[state.plan.images.length - 1];
    assert.equal(last.source, "copy_photo");
    assert.equal(state.plan.images[0].source, "collage");
  });

  it("refuses another user's offer", async () => {
    await assert.rejects(
      () => attachOfferItemFrontPhotos("nobody", offerId),
      OfferPhotoAttachmentError
    );
  });
});
