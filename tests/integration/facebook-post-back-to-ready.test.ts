import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  createFacebookPost,
  publishOfferOrPost,
  setFacebookPostLayout,
  takeFacebookPostBackToReady,
  withdrawOfferOrPost,
} from "../../src/lib/facebook-posts";

// A Facebook post that is up taken back to Ready (#1998) — a mistaken Publish, or a post gone from the
// group. Every lot still for sale goes back as if never published (no link, its text unfrozen, no
// listing date, an auction's bids cleared, its closing time kept); a lot sold or withdrawn stays in the
// post as it went up, and the others move into a new Ready post in the same group with the same title,
// layout and lot order. Refused while the post waits for approval, and once nothing in it is up.

describe("a Facebook post that is up goes back to Ready (#1998)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let conditionId: string;
  let groupId: string;
  let n = 0;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbback-${ts}`;
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
        data: { slug: `col-fbback-${ts}`, name: `fbback-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — z powrotem",
        url: "https://www.facebook.com/groups/199801",
        postTemplate: "{title} od {startingPrice}",
        quickBuyTemplate: "{title} za {price}",
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  /** A Ready Facebook offer over one fresh copy — an auction unless `quickBuy`. */
  async function offer({ quickBuy = false }: { quickBuy?: boolean } = {}): Promise<string> {
    const stamp = await prisma.stamp.create({ data: { collectionId, name: `Stamp ${Math.random()}` } });
    const item = await createItem(userId, collectionId, { stampId: stamp.id, conditionId, forSale: true });
    const offerId = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: quickBuy ? "30.00" : "0.00",
        startingPrice: quickBuy ? null : "5.00",
        currency: "PLN",
        listingDate: null,
        state: "preparing",
        facebookGroupId: groupId,
        listingType: quickBuy ? "fixed" : "auction",
        endsAt: quickBuy ? null : new Date("2026-11-01T19:00:00Z"),
      },
      { seedItemIds: [item.id] }
    );
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  const link = () => `https://www.facebook.com/groups/199801/posts/${++n}`;

  const read = (id: string) =>
    prisma.offer.findUniqueOrThrow({
      where: { id },
      select: {
        state: true,
        url: true,
        price: true,
        priceCheckedAt: true,
        listingDate: true,
        lastPostedAt: true,
        endsAt: true,
        facebookPostId: true,
        facebookLotNo: true,
        facebookPostSnapshot: true,
      },
    });

  it("takes every lot back when all are still for sale, in the same post, and it publishes again", async () => {
    const [a, b, c] = [await offer(), await offer(), await offer()];
    const { postId, postNo } = await createFacebookPost(userId, collectionId, [a, b, c], "Polska 1950");
    await publishOfferOrPost(userId, a, link());
    await patchOffer(userId, b, { price: "12.00" });
    await setOfferState(userId, c, "paused");
    assert.notEqual((await read(b)).facebookPostSnapshot, null);
    const closing = (await read(a)).endsAt;

    const moved = await takeFacebookPostBackToReady(userId, b);
    assert.deepEqual(moved, { postId, postNo, keptPostNo: null });
    for (const id of [a, b, c]) {
      const lot = await read(id);
      assert.equal(lot.state, "ready");
      assert.equal(lot.url, null, "the post's link is gone, not kept");
      assert.equal(lot.facebookPostSnapshot, null, "its text follows the template again");
      assert.equal(lot.listingDate, null);
      assert.equal(lot.facebookPostId, postId);
      assert.equal(lot.endsAt?.getTime(), closing?.getTime(), "the closing time stays");
    }
    assert.equal((await read(b)).price.toFixed(2), "0.00", "a recorded bid is cleared");
    assert.equal((await read(b)).priceCheckedAt, null);
    assert.deepEqual(
      await Promise.all([a, b, c].map(async (id) => (await read(id)).facebookLotNo)),
      [1, 2, 3]
    );

    const again = link();
    await publishOfferOrPost(userId, c, again);
    for (const id of [a, b, c]) {
      const lot = await read(id);
      assert.equal(lot.state, "active");
      assert.equal(lot.url, again);
      assert.notEqual(lot.listingDate, null, "published again as a first Publish");
    }
  });

  it("splits a post with lots sold or withdrawn: they stay, the rest move into a new Ready post", async () => {
    const [a, b, c, d] = [await offer(), await offer(), await offer(), await offer()];
    const { postId, postNo } = await createFacebookPost(userId, collectionId, [a, b, c, d], "Rosja 1960");
    await setFacebookPostLayout(userId, postId, "captions");
    const url = link();
    await publishOfferOrPost(userId, a, url);
    await prisma.offer.update({ where: { id: b }, data: { state: "sold" } });
    await withdrawOfferOrPost(userId, c);
    await patchOffer(userId, d, { price: "9.00" });

    const moved = await takeFacebookPostBackToReady(userId, d);
    assert.equal(moved.keptPostNo, postNo);
    assert.notEqual(moved.postId, postId);
    assert.ok(moved.postNo > postNo, "the new post has a number of its own");

    for (const [id, state, lotNo] of [[b, "sold", 2], [c, "withdrawn", 3]] as const) {
      const lot = await read(id);
      assert.equal(lot.state, state);
      assert.equal(lot.facebookPostId, postId, "a lot sold or withdrawn stays in the post as it went up");
      assert.equal(lot.facebookLotNo, lotNo);
      assert.equal(lot.url, url);
      assert.notEqual(lot.facebookPostSnapshot, null);
    }
    for (const [id, lotNo] of [[a, 1], [d, 2]] as const) {
      const lot = await read(id);
      assert.equal(lot.state, "ready");
      assert.equal(lot.facebookPostId, moved.postId);
      assert.equal(lot.facebookLotNo, lotNo, "in their lot order");
      assert.equal(lot.url, null);
    }
    assert.equal((await read(d)).price.toFixed(2), "0.00");
    const split = await prisma.facebookPost.findUniqueOrThrow({ where: { id: moved.postId } });
    assert.equal(split.groupId, groupId);
    assert.equal(split.title, "Rosja 1960");
    assert.equal(split.layout, "captions");

    // The new post is a post like any other: published, it goes up with a new link.
    const again = link();
    await publishOfferOrPost(userId, a, again);
    assert.equal((await read(d)).state, "active");
    assert.equal((await read(d)).url, again);
  });

  it("takes an offer posted alone back the same way, and stops its days up", async () => {
    const q = await offer({ quickBuy: true });
    await publishOfferOrPost(userId, q, link());
    await prisma.offer.update({ where: { id: q }, data: { lastPostedAt: new Date() } });
    const { facebookPostId } = await read(q);
    assert.notEqual(facebookPostId, null);

    const moved = await takeFacebookPostBackToReady(userId, q);
    assert.equal(moved.postId, facebookPostId);
    assert.equal(moved.keptPostNo, null);
    const lot = await read(q);
    assert.equal(lot.state, "ready");
    assert.equal(lot.url, null);
    assert.equal(lot.listingDate, null);
    assert.equal(lot.lastPostedAt, null);
    assert.equal(lot.price.toFixed(2), "30.00", "a quick buy's asking price is no bid");
  });

  it("is refused while the post waits for approval, before it is up, and once nothing is up", async () => {
    const pending = await offer();
    await publishOfferOrPost(userId, pending, "https://www.facebook.com/groups/199801/pending_posts/1", "pending");
    await assert.rejects(() => takeFacebookPostBackToReady(userId, pending), /waiting for the group's approval/);

    const [x, y] = [await offer(), await offer()];
    await createFacebookPost(userId, collectionId, [x, y], "Jeszcze nie");
    await assert.rejects(() => takeFacebookPostBackToReady(userId, x), /nothing up for sale/);

    const over = await offer();
    await publishOfferOrPost(userId, over, link());
    await withdrawOfferOrPost(userId, over);
    await assert.rejects(() => takeFacebookPostBackToReady(userId, over), /nothing up for sale/);

    const loose = await offer();
    await assert.rejects(() => takeFacebookPostBackToReady(userId, loose), /in no post/);
  });
});
