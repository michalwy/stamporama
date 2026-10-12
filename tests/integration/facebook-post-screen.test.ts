import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import sharp from "sharp";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, listOffersPaginated, setOfferState } from "../../src/lib/offers";
import { stageUpload, applyPhotoChangeSet } from "../../src/lib/photos";
import { setFacebookPlatform } from "../../src/lib/facebook";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { getFacebookOfferKit } from "../../src/lib/facebook-auctions";
import {
  createFacebookPost,
  findFacebookPostId,
  getFacebookPostScreen,
  publishOfferOrPost,
  removeFacebookLot,
} from "../../src/lib/facebook-posts";
import { addSaleLines, createSale } from "../../src/lib/sales";

// Bytes go through the filesystem backend, pointed at a throwaway directory (the photo tests' rule).
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-fb-post-screen-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A multi-lot Facebook post's own screen (#1842): the post's short number — allocated per collection
// and never reused — the screen's read of the post (its lots in order and each lot's sale), and the
// offers list narrowed to one post's lots, each row naming its post and lot. The moves a post makes
// as one are the existing ones (`facebook-auctions.test.ts`); which of them the screen offers is pure
// (`tests/unit/facebook-post-rules.test.ts`).

describe("a multi-lot Facebook post's screen (#1842)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbpostscreen-${ts}`;
    otherUserId = `test-user-fbpostscreen-other-${ts}`;
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
        data: { slug: `col-fbpostscreen-${ts}`, name: `fbpostscreen-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.contact.create({
        data: { collectionId, name: "Facebook", platform: true, platformCurrency: "PLN", maxPhotoEdge: 2000 },
      })
    ).id;
    await setFacebookPlatform(userId, collectionId, facebookId);
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — posty",
        url: "https://www.facebook.com/groups/180000",
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

  it("numbers each post from the collection's counter, and a dissolved post's number is never reused", async () => {
    const a = (await offer()).offerId;
    const b = (await offer()).offerId;
    const c = (await offer()).offerId;
    const d = (await offer()).offerId;
    const first = await createFacebookPost(userId, collectionId, [a, b]);
    const second = await createFacebookPost(userId, collectionId, [c, d]);
    assert.equal(second.postNo, first.postNo + 1);
    assert.equal(await findFacebookPostId(userId, collectionId, first.postNo), first.postId);
    assert.equal((await getFacebookOfferKit(a))!.post!.postNo, first.postNo);

    // Taking one of two lots out dissolves the post — and its number goes with it. The newest post is
    // the one dissolved, so a `max + 1` allocation would hand its number straight out again.
    await removeFacebookLot(userId, d);
    assert.equal(await findFacebookPostId(userId, collectionId, second.postNo), null);
    const third = await createFacebookPost(userId, collectionId, [c, d]);
    assert.equal(third.postNo, second.postNo + 1);
  });

  it("reads the post's lots in lot order, with the sale each sold lot left on", async () => {
    const one = await offer();
    const two = await offer();
    const three = await offer();
    const { postId, postNo } = await createFacebookPost(userId, collectionId, [two.offerId, one.offerId, three.offerId]);
    await publishOfferOrPost(userId, one.offerId, "https://www.facebook.com/groups/180000/posts/1");

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
    const set = await prisma.offerSet.findFirstOrThrow({ where: { offerId: one.offerId }, select: { id: true } });
    await addSaleLines(userId, saleId, [
      { offerId: one.offerId, offerSetId: set.id, price: "12.00", itemIds: [one.itemId] },
    ]);
    const { saleNo } = await prisma.sale.findUniqueOrThrow({ where: { id: saleId }, select: { saleNo: true } });

    const screen = (await getFacebookPostScreen(userId, postId))!;
    assert.equal(screen.postNo, postNo);
    assert.equal(screen.collectionId, collectionId);
    assert.equal(screen.platform.id, facebookId);
    assert.deepEqual(
      screen.kit.lots.map((l) => [l.lotNo, l.offerId]),
      [
        [1, two.offerId],
        [2, one.offerId],
        [3, three.offerId],
      ]
    );
    assert.deepEqual(screen.sales[one.offerId], [{ id: saleId, saleNo }]);
    assert.equal(screen.sales[two.offerId], undefined);

    // Somebody else's post is not read.
    await assert.rejects(getFacebookPostScreen(otherUserId, postId));
    await assert.rejects(findFacebookPostId(otherUserId, collectionId, postNo));
  });

  it("narrows the offers list to one post's lots, each row naming its post and lot", async () => {
    const x = (await offer()).offerId;
    const y = (await offer()).offerId;
    const alone = (await offer()).offerId;
    const { postNo } = await createFacebookPost(userId, collectionId, [y, x]);

    const { items } = await listOffersPaginated(userId, collectionId, { facebookPostNo: postNo });
    assert.deepEqual(
      items.map((i) => [i.id, i.facebookPost]).sort(),
      [
        [x, { postNo, lotNo: 2 }],
        [y, { postNo, lotNo: 1 }],
      ].sort()
    );

    const all = await listOffersPaginated(userId, collectionId, {});
    assert.equal(all.items.find((i) => i.id === alone)!.facebookPost, null);
  });
});
