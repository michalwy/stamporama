import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState } from "../../src/lib/offers";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  createFacebookPost,
  deleteFacebookPost,
  findFacebookPostId,
  publishOfferOrPost,
  readFacebookPostDeletion,
} from "../../src/lib/facebook-posts";
import { addSaleLines, createSale } from "../../src/lib/sales";

// Bytes go through the filesystem backend, pointed at a throwaway directory (the photo tests' rule).
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-fb-post-delete-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// Deleting a Facebook post together with every offer in it (#2060): in any stage, the copies staying,
// the post's number never given again — and refused, naming the lots, while any lot has a sold set.
// The refusal's wording is pure (`tests/unit/facebook-post-rules.test.ts`).

describe("deleting a Facebook post with its offers (#2060)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpostdelete-${ts}`;
    otherUserId = `test-user-fbpostdelete-other-${ts}`;
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
        data: { slug: `col-fbpostdelete-${ts}`, name: `fbpostdelete-${ts}`, baseCurrency: "PLN", ownerId: userId },
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
        name: "Znaczki — do usunięcia",
        url: "https://www.facebook.com/groups/181000",
        postTemplate: "{lot}. {title}",
        custom: ["postTemplate"],
      })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** A Ready Facebook auction over one fresh copy with a front scan. */
  async function offer(): Promise<{ offerId: string; itemId: string }> {
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
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        startingPrice: "3.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
      },
      { seedItemIds: [item.id] }
    );
    await setOfferState(userId, offerId, "ready");
    return { offerId, itemId: item.id };
  }

  async function sell(offerId: string, itemId: string): Promise<void> {
    const saleId = await createSale(userId, collectionId, {
      platformId: facebookId,
      buyerId: null,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date(),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    const set = await prisma.offerSet.findFirstOrThrow({ where: { offerId }, select: { id: true } });
    await addSaleLines(userId, saleId, [{ offerId, offerSetId: set.id, price: "12.00", itemIds: [itemId] }]);
  }

  it("deletes a post not yet up with all its offers, keeps the copies, and never gives its number again", async () => {
    const lots = [await offer(), await offer(), await offer()];
    const { postId, postNo } = await createFacebookPost(
      userId,
      collectionId,
      lots.map((l) => l.offerId),
      "Batch made by mistake"
    );

    assert.deepEqual(await readFacebookPostDeletion(userId, postId), {
      postNo,
      title: "Batch made by mistake",
      offerCount: 3,
      soldLots: [],
      submitted: false,
    });

    assert.deepEqual(await deleteFacebookPost(userId, postId), { postNo, offerCount: 3 });
    assert.equal(await prisma.facebookPost.count({ where: { id: postId } }), 0);
    assert.equal(await prisma.offer.count({ where: { id: { in: lots.map((l) => l.offerId) } } }), 0);
    assert.equal(await prisma.item.count({ where: { id: { in: lots.map((l) => l.itemId) } } }), 3);
    assert.equal(await findFacebookPostId(userId, collectionId, postNo), null);

    // The newest post went, so a `max + 1` allocation would hand its number straight out again — to
    // the next offer's post of one (#2116), the next post made.
    const next = await offer();
    const nextPost = await prisma.offer.findUniqueOrThrow({
      where: { id: next.offerId },
      select: { facebookPost: { select: { postNo: true } } },
    });
    assert.equal(nextPost.facebookPost?.postNo, postNo + 1);
  });

  it("deletes a post that is up, saying it was submitted to the group", async () => {
    const lots = [await offer(), await offer()];
    const { postId, postNo } = await createFacebookPost(userId, collectionId, lots.map((l) => l.offerId), "Up");
    await publishOfferOrPost(userId, lots[0].offerId, "https://www.facebook.com/groups/181000/posts/1");

    const deletion = await readFacebookPostDeletion(userId, postId);
    assert.equal(deletion.submitted, true);
    assert.equal(deletion.offerCount, 2);

    assert.deepEqual(await deleteFacebookPost(userId, postId), { postNo, offerCount: 2 });
    assert.equal(await prisma.offer.count({ where: { id: { in: lots.map((l) => l.offerId) } } }), 0);
  });

  it("deletes a post of one offer posted alone", async () => {
    const alone = await offer();
    await publishOfferOrPost(userId, alone.offerId, "https://www.facebook.com/groups/181000/posts/2");
    const { facebookPostId } = await prisma.offer.findUniqueOrThrow({
      where: { id: alone.offerId },
      select: { facebookPostId: true },
    });
    assert.ok(facebookPostId);
    assert.equal((await deleteFacebookPost(userId, facebookPostId)).offerCount, 1);
    assert.equal(await prisma.offer.count({ where: { id: alone.offerId } }), 0);
  });

  it("refuses while any lot has a sold set, naming those lots, and deletes nothing", async () => {
    const lots = [await offer(), await offer(), await offer()];
    const { postId } = await createFacebookPost(userId, collectionId, lots.map((l) => l.offerId), "Partly sold");
    await publishOfferOrPost(userId, lots[0].offerId, "https://www.facebook.com/groups/181000/posts/3");
    await sell(lots[1].offerId, lots[1].itemId);

    const offerNo = (
      await prisma.offer.findUniqueOrThrow({ where: { id: lots[1].offerId }, select: { offerNo: true } })
    ).offerNo;
    const deletion = await readFacebookPostDeletion(userId, postId);
    assert.deepEqual(deletion.soldLots, [{ lotNo: 2, offerNo }]);

    await assert.rejects(deleteFacebookPost(userId, postId), new RegExp(`Lot 2 \\(#${offerNo}\\) has a sold set`));
    assert.equal(await prisma.facebookPost.count({ where: { id: postId } }), 1);
    assert.equal(await prisma.offer.count({ where: { id: { in: lots.map((l) => l.offerId) } } }), 3);
  });

  it("is the owner's alone", async () => {
    const lots = [await offer(), await offer()];
    const { postId } = await createFacebookPost(userId, collectionId, lots.map((l) => l.offerId), "Mine");
    await assert.rejects(readFacebookPostDeletion(otherUserId, postId));
    await assert.rejects(deleteFacebookPost(otherUserId, postId));
    assert.equal(await prisma.facebookPost.count({ where: { id: postId } }), 1);
  });
});
