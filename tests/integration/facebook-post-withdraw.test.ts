import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState, type NewOfferInput, type OfferInput } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  createFacebookPost,
  getFacebookPostScreen,
  publishOfferOrPost,
  readFacebookPostWithdrawal,
  withdrawFacebookPost,
} from "../../src/lib/facebook-posts";
import { facebookPostMoves, facebookPostStage } from "../../src/lib/facebook-post-rules";
import { addSaleLines, createSale, listSellableOffers } from "../../src/lib/sales";

// *Withdraw post…* (#2590): in any stage, every lot of a post still for sale is withdrawn, as its own
// *Withdraw* would; sold lots stay sold with their sales, an auction up with a recorded bid stays up,
// and nothing is deleted — the post keeps its lots and its number. The pure half is in
// `tests/unit/facebook-post-rules.test.ts`.

describe("withdrawing a whole Facebook post (#2590)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;
  let buyerId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbwdraw-${ts}`;
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
        data: { slug: `col-fbwdraw-${ts}`, name: `fbwdraw-${ts}`, baseCurrency: "PLN", ownerId: userId },
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
      select: { id: true, state: true, facebookLotNo: true },
    });

  const stageOf = async (postId: string) => {
    const screen = await getFacebookPostScreen(userId, postId);
    assert.ok(screen, "the post is still there");
    return { stage: facebookPostStage(screen.kit.lots), moves: facebookPostMoves(screen.kit.lots) };
  };

  it("withdraws the lots still for sale of a post being prepared and keeps the sold ones", async () => {
    const { postId, lots } = await post("ready", "preparing", "ready", "ready", "preparing");
    const saleId = await sell([lots[1], lots[3]]);

    assert.deepEqual(await readFacebookPostWithdrawal(userId, postId), {
      postNo: (await prisma.facebookPost.findUniqueOrThrow({ where: { id: postId } })).postNo,
      title: "Test post",
      withdrawCount: 3,
      soldCount: 2,
      bidLots: [],
      submitted: false,
    });
    assert.equal((await stageOf(postId)).moves.withdraw, true);

    const done = await withdrawFacebookPost(userId, postId);
    assert.equal(done.withdrawn, 3);
    assert.deepEqual(
      (await lotRows(postId)).map((r) => [r.facebookLotNo, r.state]),
      [
        [1, "withdrawn"],
        [2, "sold"],
        [3, "withdrawn"],
        [4, "sold"],
        [5, "withdrawn"],
      ],
      "every lot stays in the post with its number"
    );
    assert.equal(await prisma.saleLine.count({ where: { saleId } }), 2, "the sale is untouched");

    const after = await stageOf(postId);
    assert.equal(after.stage, "over");
    assert.equal(after.moves.withdraw, false, "a post with nothing for sale does not offer it");
    assert.equal((await readFacebookPostWithdrawal(userId, postId)).withdrawCount, 0);
    assert.equal((await withdrawFacebookPost(userId, postId)).withdrawn, 0, "asking again changes nothing");
  });

  it("withdraws a post that is up, leaving an auction with a recorded bid up", async () => {
    const { postId, lots } = await post("ready", "ready", "ready");
    await publishOfferOrPost(userId, lots[0], "https://www.facebook.com/groups/123456/posts/77");
    // An auction up with no bid has a price of zero; lot 2 has one (#1545: the running bid is the
    // offer's own price). The post's helper priced every lot to make it Ready.
    await prisma.offer.updateMany({ where: { id: { in: lots } }, data: { price: "0.00" } });
    await prisma.offer.update({ where: { id: lots[1] }, data: { price: "12.00" } });
    const offerNo = (await prisma.offer.findUniqueOrThrow({ where: { id: lots[1] } })).offerNo;

    const read = await readFacebookPostWithdrawal(userId, postId);
    assert.equal(read.withdrawCount, 2);
    assert.deepEqual(read.bidLots, [{ lotNo: 2, offerNo }]);
    assert.equal(read.submitted, true, "the confirmation says the group's post is not touched");

    await withdrawFacebookPost(userId, postId);
    assert.deepEqual(
      (await lotRows(postId)).map((r) => r.state),
      ["withdrawn", "active", "withdrawn"]
    );
    assert.equal((await stageOf(postId)).stage, "up", "the auction with a bid keeps the post up");
  });

  it("withdraws a post waiting for approval, as before", async () => {
    const { postId, lots } = await post("ready", "ready");
    await publishOfferOrPost(userId, lots[0], "https://www.facebook.com/groups/123456/pending_posts/9", "pending");
    assert.deepEqual((await lotRows(postId)).map((r) => r.state), ["pending", "pending"]);
    assert.equal((await stageOf(postId)).moves.withdraw, true);

    await withdrawFacebookPost(userId, postId);
    assert.deepEqual((await lotRows(postId)).map((r) => r.state), ["withdrawn", "withdrawn"]);
    assert.equal((await stageOf(postId)).stage, "over");
  });
});
