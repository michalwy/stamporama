import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, addOfferSet, deleteOffer, updateOfferPhotoConfig } from "../../src/lib/offers";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import { FULL_MAX_EDGE } from "../../src/lib/photos/process";
import { attachOfferCopyPhoto } from "../../src/lib/offer-photo-attachments";
import { createSale, addSaleLines } from "../../src/lib/sales";
import { inflateRawSync } from "node:zlib";
import {
  buildOfferPhotoArchive,
  buildOffersPhotoArchive,
  claimNextOfferPhotoGeneration,
  deleteOfferPhotoBytes,
  enqueueOfferPhotoGeneration,
  getOfferPhotoPlanState,
  OfferPhotoGenerationError,
  requeueStalledOfferPhotoGenerations,
  runOfferPhotoGeneration,
} from "../../src/lib/offer-photo-generation";
import { getStorage, variantKey } from "../../src/lib/storage";

// Bytes go through the filesystem backend, so point it at a throwaway directory rather than the repo's
// `.data`. `dataDir()` reads the env var on every call, so setting it here — before any test body runs
// — is enough; nothing touches storage at import time.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-offer-photos-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Persisted generated offer images (#311). The plan's grouping rules (#309), the collage geometry
// (#310) and the fingerprint (#311) are all unit-tested; what is exercised here is the wiring that
// needs a database and a storage backend:
//
//   - a queued run is claimed and rendered into `Photo` rows owned by the *offer*, ordered by their
//     plan entries, with real bytes behind both variants;
//   - staleness is reported (never repaired) once the offer changes underneath stored images;
//   - regenerating replaces wholesale — old rows and old files both go;
//   - deleting the offer leaves no orphaned files;
//   - a sold set leaves the plan while manual attachments stay (#315);
//   - enqueuing refuses the two cases that could only produce nothing.

/** One scan's worth of bytes: a solid PNG of the given size, distinct per colour so nothing collapses. */
async function scan(width: number, height: number, red: number): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: red, g: 120, b: 200 } },
  })
    .png()
    .toBuffer();
}

/** Does the storage backend still hold both variants of this photo? */
async function bytesExist(photo: {
  storageBackend: string;
  storageKey: string;
  mime: string;
}): Promise<boolean> {
  const storage = getStorage(photo.storageBackend);
  try {
    for (const variant of ["full", "thumb"] as const) {
      await storage.get(variantKey(photo.storageKey, variant, photo.mime), photo.mime);
    }
    return true;
  } catch {
    return false;
  }
}

/** Read a ZIP back by walking its local file headers, in written order (#314). */
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
    entries.push({
      name,
      contents: method === 0 ? Buffer.from(payload) : inflateRawSync(payload),
    });
    offset = start + compressedSize;
  }
  return entries;
}

describe("offer photo generation (#311)", () => {
  let userId: string;
  let collectionId: string;
  let platformId: string;
  let barePlatformId: string;
  /** The offer under test: three single-copy sets, front + back scans, a 2×2 collage. */
  let offerId: string;
  let conditionId: string;
  const setIds: string[] = [];

  before(async () => {
    const ts = Date.now();
    userId = `test-user-offer-photos-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User offer-photos-${ts}`,
        email: `test-offer-photos-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    const col = await prisma.collection.create({
      data: {
        slug: `col-offer-photos-${ts}`,
        name: `Collection offer-photos-${ts}`,
        baseCurrency: "EUR",
        ownerId: userId,
      },
    });
    collectionId = col.id;

    conditionId = (
      await prisma.stampCondition.create({
        data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 },
      })
    ).id;
    // The platform's limits are read live by the renderer; a modest edge keeps the test fast.
    platformId = (
      await prisma.contact.create({
        data: {
          collectionId,
          name: `Delcampe ${ts}`,
          platform: true,
          maxPhotos: 6,
          maxPhotoEdge: 900,
        },
      })
    ).id;
    barePlatformId = (
      await prisma.contact.create({
        data: { collectionId, name: `Bare ${ts}`, platform: true },
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
    // Sides + collage numbers: without them there is nothing to lay out.
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "both",
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });

    // Three copies, each with a front and a back scan, each its own single-copy set. The plan chunks
    // singles up to the collage's capacity (4), so this is one group → one front + one back image.
    for (const [index, size] of [
      [120, 160],
      [140, 150],
      [100, 180],
    ].entries()) {
      const stamp = await prisma.stamp.create({
        data: { collectionId, name: `Stamp ${index}`, primaryCatalogSortKey: index },
      });
      const item = await createItem(userId, collectionId, {
        stampId: stamp.id,
        conditionId,
        forSale: true,
      });
      for (const [role, red] of [
        ["front", 10 + index * 20],
        ["back", 200 - index * 20],
      ] as const) {
        const upload = await stageUpload(userId, collectionId, {
          bytes: await scan(size[0], size[1], red),
          mime: "image/png",
        });
        await applyPhotoChangeSet(userId, item.id, {
          add: [{ uploadId: upload.id, role, title: null, sortOrder: 0 }],
          update: [],
          remove: [],
        });
      }
      setIds.push(await addOfferSet(userId, offerId, [item.id]));
    }
  });

  after(async () => {
    // A sale (#315) holds its copies by foreign key; its test cleans up after itself, but a failure
    // partway through must not block the teardown.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.delete({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("plans two images (front + back) and reports nothing generated yet", async () => {
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "none");
    assert.equal(state.images.length, 0);
    assert.equal(state.plan.configured, true);
    assert.equal(state.plan.imageCount, 2, "three singles chunk into one group → front + back");
    assert.equal(state.outOfDate, false, "nothing stored, so nothing can be stale");
  });

  it("queues a run, then renders it into offer-owned photos with real bytes", async () => {
    await enqueueOfferPhotoGeneration(userId, offerId);
    const queued = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(queued.status, "queued");
    assert.equal(queued.plannedCount, 2);

    // Stand in for the worker: claim the job, then run it.
    const claimed = await claimNextOfferPhotoGeneration({ offerId });
    assert.equal(claimed, offerId);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "running");
    await runOfferPhotoGeneration(offerId);

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.status, "ready");
    assert.equal(state.error, null);
    assert.equal(state.renderedCount, 2);
    assert.equal(state.images.length, 2);
    assert.equal(state.outOfDate, false);

    // Plan metadata: upload order, both sides, one pair, and the sets that fed them.
    assert.deepEqual(
      state.images.map((i) => [i.sortOrder, i.side, i.source]),
      [
        [0, "front", "collage"],
        [1, "back", "collage"],
      ]
    );
    assert.equal(state.images[0].pairKey, state.images[1].pairKey, "front and back are one pair");
    assert.deepEqual([...state.images[0].setIds].sort(), [...setIds].sort());

    const photos = await prisma.photo.findMany({
      where: { id: { in: state.images.map((i) => i.photoId) } },
    });
    assert.equal(photos.length, 2);
    for (const photo of photos) {
      assert.equal(photo.offerId, offerId, "a generated listing image is owned by the offer");
      assert.equal(photo.itemId, null);
      assert.equal(photo.stampId, null);
      assert.equal(photo.kind, "generated");
      assert.equal(photo.role, null, "plan images order via the plan, not a role slot");
      assert.equal(photo.mime, "image/jpeg", "collages are always JPEG");
      assert.ok(photo.width > 0 && photo.height > 0);
      assert.ok(photo.width <= 900 && photo.height <= 900, "the platform's edge limit is obeyed");
      assert.ok(await bytesExist(photo), "both variants are stored");
    }
  });

  it("reports the plan as out of date once the offer changes, without touching the files", async () => {
    const before = await getOfferPhotoPlanState(userId, offerId);
    const storedIds = before.images.map((i) => i.photoId);

    // Editing the photo configuration is exactly the case #308 promised would mark the plan stale.
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });

    const after = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(after.outOfDate, true);
    assert.equal(after.status, "ready", "staleness is a signal, not a new job");
    assert.deepEqual(after.images.map((i) => i.photoId), storedIds, "stored images are untouched");
    assert.equal(after.plan.imageCount, 1, "front-only now plans a single image");
  });

  it("replaces wholesale on a second run — old rows and old files both go", async () => {
    const before = await getOfferPhotoPlanState(userId, offerId);
    const old = await prisma.photo.findMany({
      where: { id: { in: before.images.map((i) => i.photoId) } },
      select: { id: true, storageBackend: true, storageKey: true, mime: true },
    });

    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);

    const after = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(after.status, "ready");
    assert.equal(after.images.length, 1, "front-only configuration renders one image");
    assert.equal(after.outOfDate, false, "the fingerprint now matches the offer again");

    const survivors = await prisma.photo.findMany({ where: { id: { in: old.map((p) => p.id) } } });
    assert.equal(survivors.length, 0, "the previous generated rows are gone");
    assert.equal(
      await prisma.offerPhotoEntry.count({ where: { offerId } }),
      1,
      "entries are replaced with the photos they describe"
    );
    for (const photo of old) {
      assert.equal(await bytesExist(photo), false, "the displaced files are deleted");
    }
  });

  it("refuses to queue a run that could only produce nothing", async () => {
    // No collage numbers: nothing can be laid out at all.
    const bare = await createOffer(userId, collectionId, {
      platformId: barePlatformId,
      url: null,
      price: "1.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await assert.rejects(
      () => enqueueOfferPhotoGeneration(userId, bare),
      OfferPhotoGenerationError,
      "an offer without collage numbers cannot be generated"
    );

    // Configured, but its copy has no scans for the chosen side.
    await updateOfferPhotoConfig(userId, bare, {
      photoSides: "front",
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageRows: 1,
        collageColumns: 1,
        collageGapPercent: 4,
        collageBackground: "#ffffff",
        collageLabelPercent: 0,
      },
    });
    const stamp = await prisma.stamp.create({ data: { collectionId, name: "Unscanned" } });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    await addOfferSet(userId, bare, [item.id]);
    await assert.rejects(
      () => enqueueOfferPhotoGeneration(userId, bare),
      OfferPhotoGenerationError,
      "no scans for the chosen sides means nothing to render"
    );

    await deleteOffer(userId, bare);
  });

  it("is idempotent while a run is already queued", async () => {
    await enqueueOfferPhotoGeneration(userId, offerId);
    const first = await prisma.offerPhotoGeneration.findUnique({ where: { offerId } });
    await enqueueOfferPhotoGeneration(userId, offerId);
    const second = await prisma.offerPhotoGeneration.findUnique({ where: { offerId } });
    assert.equal(second?.status, "queued");
    assert.deepEqual(second?.queuedAt, first?.queuedAt, "the queued run is left alone, not restacked");
    assert.equal(
      await prisma.offerPhotoGeneration.count({ where: { offerId } }),
      1,
      "one row per offer"
    );
  });

  it("requeues a run left running by a restart", async () => {
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "running");

    // The process went away mid-render; the next boot picks it back up.
    assert.equal(await requeueStalledOfferPhotoGenerations({ offerId }), 1);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "queued");

    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "ready");
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), null, "the queue is drained");
  });

  // ── Tile labels (#312) ─────────────────────────────────────────────────────

  it("labels tiles from the offer's templates, and restamps them when a copy's ref changes", async () => {
    const frontOnly = {
      photoSides: "front" as const,
      collage: {
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    };
    const items = await prisma.item.findMany({
      where: { offerSetMemberships: { some: { offerSet: { offerId } } } },
      select: { id: true },
      orderBy: { id: "asc" },
    });
    await prisma.item.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { locationRef: "A234" },
    });

    // The label template is part of the configuration, so setting it makes the stored images stale.
    await updateOfferPhotoConfig(userId, offerId, {
      ...frontOnly,
      photoLabelLeftTemplate: "{ref}",
      photoLabelRightTemplate: "{name}",
    });
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).outOfDate, true);

    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
    const labelled = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(labelled.status, "ready");
    assert.equal(labelled.outOfDate, false);

    // The label is drawn into the pixels, so editing the ref of one copy — no scan replaced, no
    // setting touched — leaves images that no longer say what the inventory says.
    await prisma.item.update({ where: { id: items[0].id }, data: { locationRef: "B999" } });
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).outOfDate, true);

    // A copy with nothing to render for the template's tokens is not a change to anything else.
    await prisma.item.updateMany({
      where: { id: { in: items.map((i) => i.id) } },
      data: { locationRef: null },
    });
    await updateOfferPhotoConfig(userId, offerId, {
      ...frontOnly,
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
    });
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);
    const unlabelled = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(unlabelled.status, "ready");
    assert.equal(unlabelled.images.length, 1, "unlabelled tiles still render");
    assert.equal(unlabelled.outOfDate, false);
  });

  // ── The panel (#314) ───────────────────────────────────────────────────────

  it("says what each image was rendered from, and numbers the files for upload", async () => {
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.images.length, 1, "front-only, one group");
    const [image] = state.images;

    assert.equal(
      image.fileName,
      `offer-${offerId.slice(-6)}-01.jpg`,
      "the offer's stem (#326), then plan position, padded, with the stored mime's extension"
    );
    assert.equal(image.itemIds.length, 3, "the three copies the collage actually shows");
    assert.deepEqual(image.copyLabels, ["Stamp 0", "Stamp 1", "Stamp 2"]);
    assert.deepEqual([...image.setLabels].sort(), ["Stamp 0", "Stamp 1", "Stamp 2"]);
  });

  it("hands the whole plan over as one ordered ZIP", async () => {
    const archive = await buildOfferPhotoArchive(userId, offerId);
    assert.match(archive.fileName, /-photos\.zip$/);

    const entries = readZipEntries(archive.bytes);
    assert.deepEqual(
      entries.map((e) => e.name),
      [`offer-${offerId.slice(-6)}-01.jpg`],
      "one file per stored image, numbered in plan order"
    );

    // The archived bytes are the stored bytes — nothing is re-rendered on download (#311).
    const state = await getOfferPhotoPlanState(userId, offerId);
    const photo = await prisma.photo.findUniqueOrThrow({
      where: { id: state.images[0].photoId },
      select: { storageBackend: true, storageKey: true, mime: true },
    });
    const stored = await getStorage(photo.storageBackend).get(
      variantKey(photo.storageKey, "full", photo.mime),
      photo.mime
    );
    const chunks: Buffer[] = [];
    for await (const chunk of stored.stream) chunks.push(Buffer.from(chunk));
    assert.deepEqual(entries[0].contents, Buffer.concat(chunks));
  });

  it("names every file after the offer, so it stays identifiable outside the app (#326)", async () => {
    await prisma.offer.update({ where: { id: offerId }, data: { name: "Węgry 1950 — zestaw" } });

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.deepEqual(
      state.images.map((i) => i.fileName),
      ["wegry-1950-zestaw-01.jpg"],
      "diacritics are folded rather than dropped, so the stem stays readable"
    );

    const archive = await buildOfferPhotoArchive(userId, offerId);
    assert.equal(archive.fileName, "wegry-1950-zestaw-photos.zip");
    assert.deepEqual(
      readZipEntries(archive.bytes).map((e) => e.name),
      ["wegry-1950-zestaw-01.jpg"],
      "the archive and its contents carry the same stem"
    );

    // Back to unnamed, which the tests around this one are written against — and which falls back
    // to the offer's id rather than a constant, so two unnamed offers still differ.
    await prisma.offer.update({ where: { id: offerId }, data: { name: null } });
    const unnamed = await getOfferPhotoPlanState(userId, offerId);
    assert.deepEqual(
      unnamed.images.map((i) => i.fileName),
      [`offer-${offerId.slice(-6)}-01.jpg`]
    );
  });

  // ── The batch archive (#323) ───────────────────────────────────────────────

  it("packs several offers into one ZIP, a folder each, skipping those with nothing to upload", async () => {
    // A second offer of the same batch: one copy, one front scan, its own generated image.
    const stamp = await prisma.stamp.create({
      data: { collectionId, name: "Stamp bulk", primaryCatalogSortKey: 99 },
    });
    const item = await createItem(userId, collectionId, {
      stampId: stamp.id,
      conditionId,
      forSale: true,
    });
    const upload = await stageUpload(userId, collectionId, {
      bytes: await scan(110, 150, 60),
      mime: "image/png",
    });
    await applyPhotoChangeSet(userId, item.id, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
    const secondId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "5.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await updateOfferPhotoConfig(userId, secondId, {
      photoSides: "front",
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });
    await addOfferSet(userId, secondId, [item.id]);
    await enqueueOfferPhotoGeneration(userId, secondId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId: secondId }), secondId);
    await runOfferPhotoGeneration(secondId);

    // A third offer that was never generated: it belongs to the batch, has nothing to upload, and
    // must not deny the other two their archive.
    const emptyId = await createOffer(userId, collectionId, {
      platformId,
      url: null,
      price: "3.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });

    // Both generated offers carry the *same* name, which the generated titles make likely.
    await prisma.offer.updateMany({
      where: { id: { in: [offerId, secondId] } },
      data: { name: "Wegry 1950" },
    });

    const archive = await buildOffersPhotoArchive(userId, [offerId, secondId, emptyId]);
    assert.equal(archive.offerCount, 2);
    assert.deepEqual(
      archive.skipped.map((s) => s.offerId),
      [emptyId],
      "the offer with nothing to upload is reported, not thrown"
    );

    const names = readZipEntries(archive.bytes).map((e) => e.name);
    assert.equal(names.length, archive.imageCount);
    assert.ok(
      names.every((n) => n.includes("/")),
      "every file sits in its offer's folder"
    );
    assert.deepEqual(
      [...new Set(names.map((n) => n.split("/")[0]))].sort(),
      [`wegry-1950`, `wegry-1950-${secondId.slice(-6)}`].sort(),
      "one folder per offer; the first namesake keeps the plain slug, the later one carries its id"
    );

    // Nothing to upload anywhere is the one case that refuses: an empty archive says nothing.
    await assert.rejects(
      () => buildOffersPhotoArchive(userId, [emptyId]),
      OfferPhotoGenerationError
    );

    // Leave the batch as the tests around this one expect it.
    await prisma.offer.update({ where: { id: offerId }, data: { name: null } });
    await deleteOffer(userId, secondId);
    await deleteOffer(userId, emptyId);
  });

  it("reports a side skipped for want of a complete set of scans", async () => {
    const back = await prisma.photo.findFirstOrThrow({
      where: {
        role: "back",
        item: { offerSetMemberships: { some: { offerSet: { offerId } } } },
      },
      select: { id: true, itemId: true },
    });
    await applyPhotoChangeSet(userId, back.itemId!, { add: [], update: [], remove: [back.id] });
    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "both",
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });

    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(state.plan.imageCount, 1, "the front collage survives; the back one cannot be made");
    assert.equal(state.plan.skipped.length, 1);
    const [skipped] = state.plan.skipped;
    assert.equal(skipped.side, "back");
    assert.equal(skipped.copyCount, 3);
    assert.equal(skipped.missingCopyLabels.length, 1, "one copy is the reason the group is short");
    assert.ok(skipped.setLabels.length > 0, "the notice names the sets it is about");
  });

  it("refuses to archive an offer that has nothing generated", async () => {
    const empty = await createOffer(userId, collectionId, {
      platformId: barePlatformId,
      url: null,
      price: "1.00",
      currency: "EUR",
      listingDate: null,
      state: "preparing",
    });
    await assert.rejects(
      () => buildOfferPhotoArchive(userId, empty),
      OfferPhotoGenerationError,
      "there is no archive to build before a run has produced images"
    );
    await deleteOffer(userId, empty);
  });

  // ── Sold sets (#315) ───────────────────────────────────────────────────────

  it("drops a sold set from the plan, keeps attachments, and marks the stored images out of date", async () => {
    // An attachment of a surviving copy: a regeneration must recompute the collages around it and
    // leave it exactly where it is — it is not reproducible from any rule (#313).
    const survivingItem = await prisma.offerSetItem.findFirstOrThrow({
      where: { offerSetId: setIds[1] },
      select: { itemId: true },
    });
    const attachedPhoto = await prisma.photo.findFirstOrThrow({
      where: { itemId: survivingItem.itemId, role: "front" },
      select: { id: true },
    });
    const attachment = await attachOfferCopyPhoto(userId, offerId, {
      itemId: survivingItem.itemId,
      photoId: attachedPhoto.id,
      title: "Detail",
    });

    await updateOfferPhotoConfig(userId, offerId, {
      photoSides: "front",
      photoLabelLeftTemplate: null,
      photoLabelRightTemplate: null,
      collage: {
        collageRows: 2,
        collageColumns: 2,
        collageGapPercent: 8,
        collageBackground: "#ffffff",
        collageLabelPercent: 16,
      },
    });
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);

    const before = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(before.outOfDate, false);
    assert.equal(before.images.length, 2, "one collage of three copies, plus the attachment");
    const soldItem = await prisma.offerSetItem.findFirstOrThrow({
      where: { offerSetId: setIds[0] },
      select: { itemId: true },
    });
    assert.ok(
      before.images.some((i) => i.itemIds.includes(soldItem.itemId)),
      "the copy about to sell is in the images generated so far"
    );

    // One set of this multi-set offer sells; the offer stays live for the rest. A sale only records
    // against a live listing, so the offer goes active first.
    await prisma.offer.update({ where: { id: offerId }, data: { state: "active" } });
    const saleId = await createSale(userId, collectionId, {
      platformId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "EUR",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(userId, saleId, [
      { offerId, offerSetId: setIds[0], price: "9.00", itemIds: [soldItem.itemId] },
    ]);

    const after = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(after.plan.excludedSets.length, 1, "the sold set leaves the plan");
    assert.equal(after.plan.excludedSets[0].setId, setIds[0]);
    assert.equal(after.plan.excludedSets[0].reason, "sold");
    assert.ok(after.plan.excludedSets[0].label.length > 0, "the notice can name the set");
    assert.equal(
      after.outOfDate,
      true,
      "a sale alone marks the stored images out of date — the composition changed"
    );
    assert.deepEqual(
      after.images.map((i) => i.photoId),
      before.images.map((i) => i.photoId),
      "nothing is regenerated behind the collector's back"
    );
    assert.equal(
      after.plan.images.filter((i) => i.source === "collage").length,
      1,
      "the two remaining copies still chunk into one collage"
    );
    assert.equal(
      after.plan.images.filter((i) => i.attachmentId === attachment.id).length,
      1,
      "the attachment is untouched by the sale"
    );

    // Regenerating renders what is still available.
    await enqueueOfferPhotoGeneration(userId, offerId);
    assert.equal(await claimNextOfferPhotoGeneration({ offerId }), offerId);
    await runOfferPhotoGeneration(offerId);

    const regenerated = await getOfferPhotoPlanState(userId, offerId);
    assert.equal(regenerated.status, "ready");
    assert.equal(regenerated.outOfDate, false);
    assert.equal(regenerated.images.length, 2, "one collage of the survivors, plus the attachment");
    assert.ok(
      regenerated.images.every((i) => !i.itemIds.includes(soldItem.itemId)),
      "the sold copy is in none of the new images"
    );
    assert.equal(
      regenerated.images.filter((i) => i.source === "copy_photo").length,
      1,
      "the manual attachment is rendered again, not dropped"
    );
    assert.equal(
      await prisma.offerPhotoAttachment.count({ where: { offerId } }),
      1,
      "regeneration recomputes the collages only — the attachment row survives"
    );

    // Undo the sale: an offer holding a sold set cannot be deleted, and the next test deletes this
    // one. The offer goes back to where the previous tests left it.
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.update({ where: { id: offerId }, data: { state: "preparing" } });
  });

  it("leaves no files behind when the offer is deleted", async () => {
    const state = await getOfferPhotoPlanState(userId, offerId);
    assert.ok(state.images.length > 0);
    const photos = await prisma.photo.findMany({
      where: { id: { in: state.images.map((i) => i.photoId) } },
      select: { storageBackend: true, storageKey: true, mime: true },
    });

    await deleteOffer(userId, offerId);

    assert.equal(await prisma.photo.count({ where: { offerId } }), 0);
    assert.equal(await prisma.offerPhotoEntry.count({ where: { offerId } }), 0);
    assert.equal(await prisma.offerPhotoGeneration.count({ where: { offerId } }), 0);
    for (const photo of photos) {
      assert.equal(await bytesExist(photo), false);
    }
    // Idempotent: cleaning an offer with nothing left is a no-op, not an error.
    await deleteOfferPhotoBytes(offerId);
  });

  it("records the pre-downscale dimensions of an oversized scan", async () => {
    // The original bytes are never stored, so this row is the only record of how far the scan was
    // shrunk — and the only thing that lets the renderer put it back beside an unclamped one.
    const upload = await stageUpload(userId, collectionId, {
      bytes: await scan(FULL_MAX_EDGE * 2, FULL_MAX_EDGE, 90),
      mime: "image/png",
    });

    const row = await prisma.photoUpload.findUniqueOrThrow({ where: { id: upload.id } });
    assert.equal(row.width, FULL_MAX_EDGE);
    assert.equal(row.originalWidth, FULL_MAX_EDGE * 2);
    assert.equal(row.originalHeight, FULL_MAX_EDGE);
  });

  it("records an unclamped scan's dimensions as its stored ones", async () => {
    const upload = await stageUpload(userId, collectionId, {
      bytes: await scan(300, 200, 90),
      mime: "image/png",
    });

    const row = await prisma.photoUpload.findUniqueOrThrow({ where: { id: upload.id } });
    assert.equal(row.width, 300);
    assert.equal(row.originalWidth, 300);
    assert.equal(row.originalHeight, 200);
  });
});
