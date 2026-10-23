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
  takeFacebookPostBackToPreparing,
} from "../../src/lib/facebook-posts";

// A Facebook post not yet up taken back to Preparing from its own screen (#2115): every Ready lot goes
// through the ordinary `ready → preparing`, prices and lot order staying; a lot already Preparing is
// left alone. Refused once the post waits for approval or is up — those have their own moves back.

describe("a Facebook post not yet up goes back to Preparing (#2115)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let conditionId: string;
  let groupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbprep-${ts}`;
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
        data: { slug: `col-fbprep-${ts}`, name: `fbprep-${ts}`, baseCurrency: "PLN", ownerId: userId },
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
        name: "Znaczki — do przygotowania",
        url: "https://www.facebook.com/groups/211501",
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

  const read = (id: string) =>
    prisma.offer.findUniqueOrThrow({
      where: { id },
      select: { state: true, price: true, facebookPostId: true, facebookLotNo: true },
    });

  it("takes every Ready lot back, leaving prices, the post and the lot order as they were", async () => {
    const [a, b, c] = [await offer({ quickBuy: true }), await offer({ quickBuy: true }), await offer({ quickBuy: true })];
    const { postId } = await createFacebookPost(userId, collectionId, [a, b, c], "Polska 1960");
    await patchOffer(userId, a, { price: "42.00" });
    await setOfferState(userId, c, "preparing");

    assert.equal(await takeFacebookPostBackToPreparing(userId, postId), 2);
    const lots = await Promise.all([a, b, c].map(read));
    assert.deepEqual(
      lots.map((l) => l.state),
      ["preparing", "preparing", "preparing"]
    );
    assert.deepEqual(
      lots.map((l) => l.facebookLotNo),
      [1, 2, 3]
    );
    assert.ok(lots.every((l) => l.facebookPostId === postId));
    assert.equal(lots[0].price.toFixed(2), "42.00", "the price stays");

    // Marking ready again undoes it.
    for (const id of [a, b, c]) await setOfferState(userId, id, "ready");
    assert.equal((await read(b)).state, "ready");
  });

  it("is refused once the post waits for approval or is up", async () => {
    const [p, q] = [await offer(), await offer()];
    const pending = await createFacebookPost(userId, collectionId, [p, q], "Pending");
    await publishOfferOrPost(userId, p, "https://www.facebook.com/groups/211501/pending_posts/1", "pending");
    await assert.rejects(() => takeFacebookPostBackToPreparing(userId, pending.postId), /has gone up/);
    assert.equal((await read(q)).state, "pending");

    const [r, s] = [await offer(), await offer()];
    const up = await createFacebookPost(userId, collectionId, [r, s], "Up");
    await publishOfferOrPost(userId, r, "https://www.facebook.com/groups/211501/posts/1");
    await assert.rejects(() => takeFacebookPostBackToPreparing(userId, up.postId), /has gone up/);
    assert.equal((await read(s)).state, "active");
  });
});
