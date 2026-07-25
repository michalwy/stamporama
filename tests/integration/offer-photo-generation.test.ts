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
import {
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
      photoLabelTemplate: null,
      collage: {
        collageRows: 2,
        collageColumns: 2,
        collageGap: 10,
        collageBackground: "#ffffff",
        collageLabelStripHeight: 12,
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
    const claimed = await claimNextOfferPhotoGeneration();
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
      photoLabelTemplate: null,
      collage: {
        collageRows: 2,
        collageColumns: 2,
        collageGap: 10,
        collageBackground: "#ffffff",
        collageLabelStripHeight: 12,
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
    assert.equal(await claimNextOfferPhotoGeneration(), offerId);
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
      photoLabelTemplate: null,
      collage: {
        collageRows: 1,
        collageColumns: 1,
        collageGap: 4,
        collageBackground: "#ffffff",
        collageLabelStripHeight: 0,
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
    assert.equal(await claimNextOfferPhotoGeneration(), offerId);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "running");

    // The process went away mid-render; the next boot picks it back up.
    assert.ok((await requeueStalledOfferPhotoGenerations()) >= 1);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "queued");

    assert.equal(await claimNextOfferPhotoGeneration(), offerId);
    await runOfferPhotoGeneration(offerId);
    assert.equal((await getOfferPhotoPlanState(userId, offerId)).status, "ready");
    assert.equal(await claimNextOfferPhotoGeneration(), null, "the queue is drained");
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
});
