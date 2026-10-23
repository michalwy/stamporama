import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import { createOffer, listPreparingOffers, patchOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost, getFacebookPostLotsPrepare, publishOfferOrPost } from "../../src/lib/facebook-posts";

// Bytes go through the filesystem backend, pointed at a throwaway directory (the photo tests' rule).
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-fb-post-prepare-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A post's screen prices and readies its lots (#2031): its lots are read as the Prepare screen reads
// its offers — Preparing and Ready lots alike — and not at all once the post is up. The pricing and
// the readying themselves are the Prepare screen's actions (`patchOffer`, `markOffersReadyAction`,
// `applyEstimatedPrices`), asked of the lots' ids, so nothing new runs server-side but the read.

describe("a post's lots as Prepare rows (#2031)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpostprep-${ts}`;
    otherUserId = `test-user-fbpostprep-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: {
          id,
          name: `Test User ${id}`,
          email: `${id}@example.com`,
          emailVerified: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-fbpostprep-${ts}`, name: `fbpostprep-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-fbpostprep-o-${ts}`, name: `fbpostprep-o-${ts}`, baseCurrency: "PLN", ownerId: otherUserId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({
        data: { collectionId, name: "Facebook", platformCurrency: "PLN", maxPhotoEdge: 2000 },
      })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — przygotowanie",
        url: "https://www.facebook.com/groups/203100",
        postTemplate: "{lot}. {title}",
        custom: ["postTemplate"],
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** A Preparing Facebook auction over one fresh copy with a front scan, with no starting price yet. */
  async function preparing(): Promise<string> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    const scan = await sharp({ create: { width: 80, height: 100, channels: 3, background: { r: 40, g: 90, b: 160 } } })
      .png()
      .toBuffer();
    const upload = await stageUpload(userId, collectionId, { bytes: scan, mime: "image/png" });
    await applyPhotoChangeSet(userId, item.id, {
      add: [{ uploadId: upload.id, role: "front", title: null, sortOrder: 0 }],
      update: [],
      remove: [],
    });
    return createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: null,
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
      },
      { seedItemIds: [item.id] }
    );
  }

  it("reads every lot not yet up as the Prepare screen reads it, Ready lots included", async () => {
    const a = await preparing();
    const b = await preparing();
    await patchOffer(userId, b, { startingPrice: "4.00" });
    const post = await createFacebookPost(userId, collectionId, [a, b], "Prepared together");

    const rows = await getFacebookPostLotsPrepare(userId, collectionId, post.postId);
    assert.ok(rows);
    assert.deepEqual(Object.keys(rows).sort(), [a, b].sort());
    assert.equal(rows[a].startingPrice, null, "the unpriced lot reads as unpriced");
    assert.equal(rows[b].startingPrice, "4.00");

    // Row by construction: the lot reads exactly as its row on the Prepare screen does.
    const onPrepare = (await listPreparingOffers(userId, collectionId, { facebookGroupId: groupId })).items;
    assert.deepEqual(rows[a], onPrepare.find((o) => o.id === a));

    // A Ready lot is still read — it is repriced from the post's screen until the post is up.
    await setOfferState(userId, b, "ready");
    const afterReady = await getFacebookPostLotsPrepare(userId, collectionId, post.postId);
    assert.ok(afterReady?.[b], "a Ready lot keeps its row");
    assert.ok(afterReady?.[a]);
  });

  it("reads nothing once the post is up: pricing and readying belong to before", async () => {
    const a = await preparing();
    const b = await preparing();
    for (const id of [a, b]) {
      await patchOffer(userId, id, { startingPrice: "5.00" });
      await setOfferState(userId, id, "ready");
    }
    const post = await createFacebookPost(userId, collectionId, [a, b], "Going up");
    assert.ok(await getFacebookPostLotsPrepare(userId, collectionId, post.postId));
    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/203100/posts/1");
    assert.equal(await getFacebookPostLotsPrepare(userId, collectionId, post.postId), null);
  });

  it("holds the post while a Ready lot's photos are being made again, and moves nothing (#2114)", async () => {
    const a = await preparing();
    const b = await preparing();
    for (const id of [a, b]) {
      await patchOffer(userId, id, { startingPrice: "5.00" });
      await setOfferState(userId, id, "ready");
    }
    await createFacebookPost(userId, collectionId, [a, b], "Held for its photos");
    // Covers changed on the second lot after it was readied: its run is queued.
    await prisma.offerPhotoGeneration.create({ data: { offerId: b, status: "queued" } });

    await assert.rejects(
      () => publishOfferOrPost(userId, a, "https://www.facebook.com/groups/203100/posts/2"),
      /Lot 2 .*still being generated/
    );
    const states = await prisma.offer.findMany({ where: { id: { in: [a, b] } }, select: { state: true } });
    assert.deepEqual(states.map((o) => o.state), ["ready", "ready"], "no lot went up alone");

    await prisma.offerPhotoGeneration.update({ where: { offerId: b }, data: { status: "ready" } });
    await publishOfferOrPost(userId, a, "https://www.facebook.com/groups/203100/posts/2");
    assert.equal((await prisma.offer.findUniqueOrThrow({ where: { id: b } })).state, "active");
  });

  it("refuses a post read through another collection, or by another owner", async () => {
    const a = await preparing();
    const b = await preparing();
    const post = await createFacebookPost(userId, collectionId, [a, b], "Mine");
    await assert.rejects(() => getFacebookPostLotsPrepare(userId, otherCollectionId, post.postId), /Post not found/);
    await assert.rejects(() => getFacebookPostLotsPrepare(otherUserId, collectionId, post.postId));
  });
});
