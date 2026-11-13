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
import { STATE_CHANGED_RECORDED_FROM } from "../../src/lib/facebook-post-list-figures";
import {
  createFacebookPost,
  listFacebookPostsPaginated,
  publishOfferOrPost,
  type FacebookPostListItem,
} from "../../src/lib/facebook-posts";
import { addSaleLines, cancelSale, createSale } from "../../src/lib/sales";

// Bytes go through the filesystem backend, pointed at a throwaway directory (the photo tests' rule).
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-fb-posts-figures-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// The list of posts' dates and figures (#2502): a post waiting for approval with its creation and
// submission dates and nothing sold, a post up with its auctions' end and the lot sold — not the one
// in a cancelled sale — an unpriced lot counted, and a submission from before it was recorded left out.

describe("the list of Facebook posts — dates and figures (#2502)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;
  const ENDS = new Date("2030-01-15T19:00:00.000Z");

  /** A Facebook auction over one fresh copy costing `cost` PLN, with a front scan; Ready when it has a
   *  starting price. */
  async function offer(startingPrice: string | null, cost: string): Promise<{ offerId: string; itemId: string; setId: string }> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    await prisma.item.update({ where: { id: item.id }, data: { costBasis: cost } });
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
        startingPrice,
        currency: "PLN",
        listingDate: null,
        facebookGroupId: groupId,
      },
      { seedItemIds: [item.id] }
    );
    if (startingPrice) await setOfferState(userId, offerId, "ready");
    const setId = (await prisma.offerSet.findFirstOrThrow({ where: { offerId }, select: { id: true } })).id;
    return { offerId, itemId: item.id, setId };
  }

  async function sellLot(lot: { offerId: string; itemId: string; setId: string }, price: string): Promise<string> {
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
    await addSaleLines(userId, saleId, [{ offerId: lot.offerId, offerSetId: lot.setId, price, itemIds: [lot.itemId] }]);
    return saleId;
  }

  async function row(postId: string): Promise<FacebookPostListItem> {
    const { items } = await listFacebookPostsPaginated(userId, collectionId);
    return items.find((i) => i.postId === postId)!;
  }

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpostsfig-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User ${userId}`,
        email: `${userId}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-fbpostsfig-${ts}`, name: `fbpostsfig-${ts}`, baseCurrency: "PLN", ownerId: userId },
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
        name: "Aukcje znaczków",
        url: "https://www.facebook.com/groups/190100",
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
    await prisma.user.deleteMany({ where: { id: userId } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  it("a post waiting for approval shows when it was made and submitted, its figures, and nothing sold", async () => {
    const lots = [await offer("3.00", "1.50"), await offer("4.50", "2.00")];
    const post = await createFacebookPost(userId, collectionId, lots.map((l) => l.offerId), "Waiting");
    const before = Date.now();
    await publishOfferOrPost(userId, lots[0].offerId, "https://www.facebook.com/groups/190100/pending_posts/1", "pending");

    const item = await row(post.postId);
    assert.equal(item.stage, "pending");
    assert.ok(item.dates.createdAt);
    assert.ok(item.dates.submittedAt, "the submission is dated");
    assert.ok(new Date(item.dates.submittedAt!).getTime() >= before - 1000);
    assert.equal(item.dates.upSince, null);
    assert.equal(item.baseCurrency, "PLN");
    assert.equal(item.figures.lotCount, 2);
    assert.equal(item.figures.copyCount, 2);
    assert.deepEqual(item.figures.asking, { amount: "7.50", unpriced: 0, unconvertible: 0 });
    assert.equal(item.figures.cost.amount, "3.50");
    assert.equal(item.figures.cost.lots, 2);
    assert.deepEqual(item.figures.sold, { lots: 0, amount: null, unconvertible: 0 });
  });

  it("a post up shows since when and when its auctions end, and the lots sold — not one in a cancelled sale", async () => {
    const lots = [await offer("3.00", "1.00"), await offer("5.00", "1.00"), await offer("6.00", "1.00")];
    const post = await createFacebookPost(userId, collectionId, lots.map((l) => l.offerId), "Up");
    await publishOfferOrPost(userId, lots[0].offerId, "https://www.facebook.com/groups/190100/posts/2");
    await prisma.offer.updateMany({ where: { facebookPostId: post.postId }, data: { endsAt: ENDS } });

    await sellLot(lots[0], "7.00");
    const cancelled = await sellLot(lots[1], "9.00");
    await cancelSale(userId, cancelled, { reason: "Not paid", offerOutcomes: {} });

    const item = await row(post.postId);
    assert.equal(item.stage, "up");
    assert.equal(item.dates.upSince, new Date().toISOString().slice(0, 10));
    assert.equal(item.dates.endsFrom, ENDS.toISOString());
    assert.equal(item.dates.endsTo, ENDS.toISOString());
    assert.equal(item.dates.submittedAt, null);
    assert.deepEqual(item.figures.sold, { lots: 1, amount: "7.00", unconvertible: 0 });
    assert.equal(item.figures.asking.amount, "14.00");
  });

  it("a post with lots still unpriced counts them and sums the priced ones", async () => {
    const lots = [await offer("3.00", "1.00"), await offer(null, "1.00"), await offer(null, "1.00")];
    for (const l of lots.slice(0, 1)) await setOfferState(userId, l.offerId, "preparing");
    const post = await createFacebookPost(userId, collectionId, lots.map((l) => l.offerId), "Unpriced");

    const item = await row(post.postId);
    assert.equal(item.stage, "preparing");
    assert.deepEqual(item.figures.asking, { amount: "3.00", unpriced: 2, unconvertible: 0 });
  });

  it("a submission from before it was recorded is left out", async () => {
    // An offer is in a post of one from the moment it is made (#2116).
    const lots = [await offer("3.00", "1.00")];
    const post = {
      postId: (await prisma.offer.findUniqueOrThrow({ where: { id: lots[0].offerId } })).facebookPostId!,
    };
    await publishOfferOrPost(userId, lots[0].offerId, "https://www.facebook.com/groups/190100/pending_posts/3", "pending");
    await prisma.offer.update({
      where: { id: lots[0].offerId },
      data: { stateChangedAt: new Date(STATE_CHANGED_RECORDED_FROM.getTime() - 86_400_000) },
    });

    const item = await row(post.postId);
    assert.equal(item.stage, "pending");
    assert.ok(item.dates.createdAt);
    assert.equal(item.dates.submittedAt, null);
  });
});
