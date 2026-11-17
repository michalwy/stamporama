import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState, type NewOfferInput, type OfferInput } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { freezeUnfrozenFacebookPosts, getFacebookPostKit } from "../../src/lib/facebook-auctions";
import {
  createFacebookPost,
  getFacebookPostScreen,
  listFacebookPostsPaginated,
  publishOfferOrPost,
  removeFacebookLot,
} from "../../src/lib/facebook-posts";
import { facebookPostStage, isFacebookLotLeftOut } from "../../src/lib/facebook-post-rules";
import { buildFacebookPostPhotoArchive } from "../../src/lib/offer-photo-generation";
import { addSaleLines, createSale, deleteSale, listSellableOffers } from "../../src/lib/sales";

// A lot of a Facebook post sold before the post goes up (#2560): a buyer picks lots from the post's
// preview, and they are sold while the post is being prepared or Ready. The lot stays in the post,
// sold, with its number; the post stays where its other lots are; Publish puts up only the rest, the
// numbers keeping their gap; and a sale of a lot that never went up, once taken back, withdraws it.
// The pure half is in `tests/unit/facebook-post-rules.test.ts` and `tests/unit/sale-rules.test.ts`.

describe("selling a lot of a Facebook post before it goes up (#2560)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;
  let buyerId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbearly-${ts}`;
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
        data: { slug: `col-fbearly-${ts}`, name: `fbearly-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/123456",
        postTemplate: "Lot {lot}: {title}",
        currency: "PLN",
        custom: ["postTemplate", "currency"],
      })
    ).id;
    buyerId = (await prisma.contact.create({ data: { collectionId, name: "Jan Kowalski", buyer: true } })).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  function input(): OfferInput & NewOfferInput {
    return {
      platformId: facebookId,
      url: null,
      price: "0.00",
      currency: "PLN",
      listingDate: null,
      facebookGroupId: groupId,
      startingPrice: "3.00",
    };
  }

  /** A post of `states.length` auctions, each in the state given, in lot order. */
  async function post(...states: ("preparing" | "ready")[]): Promise<{ postId: string; lots: string[] }> {
    const lots: string[] = [];
    for (const state of states) {
      const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
      const offerId = await createOffer(userId, collectionId, input(), { seedItemIds: [item.id] });
      await prisma.offer.update({ where: { id: offerId }, data: { price: "3.00" } });
      if (state === "ready") await setOfferState(userId, offerId, "ready");
      lots.push(offerId);
    }
    const { postId } = await createFacebookPost(userId, collectionId, lots, "Test post");
    // A post made before every lot is Ready leaves the rest as they were.
    for (const [i, state] of states.entries()) {
      if (state === "preparing") await prisma.offer.update({ where: { id: lots[i] }, data: { state: "preparing" } });
    }
    return { postId, lots };
  }

  /** Sell these offers into a new sale, every set each has, as *Sell…* → *New sale* does. */
  async function sell(offerIds: readonly string[]): Promise<string> {
    const sellable = await listSellableOffers(userId, collectionId, { platformId: facebookId });
    const saleId = await createSale(userId, collectionId, {
      platformId: facebookId,
      buyerId,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-17"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await addSaleLines(
      userId,
      saleId,
      offerIds.flatMap((offerId) => {
        const offer = sellable.find((o) => o.offerId === offerId);
        assert.ok(offer, "the lot is offered to the sale");
        return offer.sets.map((set) => ({ offerId, offerSetId: set.offerSetId, itemIds: set.itemIds, price: "5.00" }));
      })
    );
    return saleId;
  }

  const lotRows = (postId: string) =>
    prisma.offer.findMany({
      where: { facebookPostId: postId },
      orderBy: { facebookLotNo: "asc" },
      select: { id: true, state: true, facebookLotNo: true, url: true, facebookPostSnapshot: true },
    });

  it("sells lots of a post being prepared, which stay in it as sold with their numbers", async () => {
    const { postId, lots } = await post("ready", "preparing", "ready", "ready", "ready");
    await sell([lots[1], lots[2], lots[3]]);

    const rows = await lotRows(postId);
    assert.deepEqual(
      rows.map((r) => [r.facebookLotNo, r.state]),
      [
        [1, "ready"],
        [2, "sold"],
        [3, "sold"],
        [4, "sold"],
        [5, "ready"],
      ],
      "every lot is still in the post, the sold ones with their numbers"
    );
    assert.ok(rows.every((r) => r.facebookPostSnapshot === null), "nothing of the post has gone up");

    // The post is still where its other lots are, and its screen still prices and readies them.
    const screen = await getFacebookPostScreen(userId, postId);
    assert.ok(screen);
    assert.equal(facebookPostStage(screen.kit.lots), "ready");
    assert.deepEqual(
      screen.kit.lots.filter(isFacebookLotLeftOut).map((l) => l.lotNo),
      [2, 3, 4]
    );
    const listed = await listFacebookPostsPaginated(userId, collectionId, { stage: "ready" });
    assert.ok(listed.items.some((p) => p.postId === postId), "the list's stage filter agrees");

    // A sold lot is not taken out of its post.
    await assert.rejects(() => removeFacebookLot(userId, lots[2]), /stays in its post/);
  });

  it("puts up only the lots not sold, leaving their numbers and the sold lots alone", async () => {
    const { postId, lots } = await post("ready", "ready", "ready");
    await sell([lots[1]]);
    const link = "https://www.facebook.com/groups/123456/posts/42";
    await publishOfferOrPost(userId, lots[0], link);

    const rows = await lotRows(postId);
    assert.deepEqual(
      rows.map((r) => [r.facebookLotNo, r.state, r.url]),
      [
        [1, "active", link],
        [2, "sold", null],
        [3, "active", link],
      ]
    );
    assert.equal(rows[1].facebookPostSnapshot, null, "the sold lot never went up, so nothing of it was frozen");
    assert.ok(rows[0].facebookPostSnapshot !== null && rows[2].facebookPostSnapshot !== null);

    // The start-up freeze leaves it so, and the post reads as up.
    await freezeUnfrozenFacebookPosts();
    assert.equal((await lotRows(postId))[1].facebookPostSnapshot, null);
    const kit = await getFacebookPostKit(postId);
    assert.ok(kit);
    assert.equal(facebookPostStage(kit.lots), "up");
  });

  it("leaves a lot sold before the post went up out of the post's photos", async () => {
    const { postId, lots } = await post("ready", "ready");
    await sell([lots[0]]);
    // No lot has photos here, so the archive is refused — and only for want of the unsold lot's.
    await assert.rejects(() => buildFacebookPostPhotoArchive(userId, postId), /None of this post's lots has images/);
  });

  it("refuses to publish a post whose every lot is sold", async () => {
    const { postId, lots } = await post("ready", "ready");
    await sell(lots);
    await assert.rejects(() => publishOfferOrPost(userId, lots[0], "https://www.facebook.com/x"), /nothing left to put up/);
    const kit = await getFacebookPostKit(postId);
    assert.ok(kit);
    assert.equal(facebookPostStage(kit.lots), "over");
  });

  it("names why an offer outside a post cannot be sold yet", async () => {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    const lone = await createOffer(userId, collectionId, { ...input(), platformId: facebookId }, { seedItemIds: [item.id] });
    // Off every post: the one lot of its own post taken off it, as an offer prepared elsewhere is.
    await prisma.offer.update({ where: { id: lone }, data: { facebookPostId: null, facebookLotNo: null } });
    const set = await prisma.offerSet.findFirstOrThrow({ where: { offerId: lone }, select: { id: true } });
    const saleId = await createSale(userId, collectionId, {
      platformId: facebookId,
      buyerId,
      externalRef: null,
      transactionUrl: null,
      soldAt: new Date("2026-11-17"),
      currency: "PLN",
      buyerHandling: null,
      buyerPaidTotal: null,
      commission: null,
    });
    await assert.rejects(
      () => addSaleLines(userId, saleId, [{ offerId: lone, offerSetId: set.id, itemIds: [item.id], price: "5.00" }]),
      /is still being prepared, so it cannot be sold/
    );
  });

  it("withdraws a lot sold before the post went up once its sale is taken back", async () => {
    const { postId, lots } = await post("ready", "ready");
    const saleId = await sell([lots[0]]);
    const link = "https://www.facebook.com/groups/123456/posts/43";
    await publishOfferOrPost(userId, lots[1], link);
    await deleteSale(userId, saleId);
    const rows = await lotRows(postId);
    assert.deepEqual(
      rows.map((r) => [r.facebookLotNo, r.state]),
      [
        [1, "withdrawn"],
        [2, "active"],
      ],
      "the lot that never went up is withdrawn, not put up"
    );
  });
});
