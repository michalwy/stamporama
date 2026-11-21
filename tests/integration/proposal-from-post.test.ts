import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState, type NewOfferInput, type OfferInput } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  addFacebookLots,
  createFacebookPost,
  deleteFacebookPost,
  getFacebookPostScreen,
  publishOfferOrPost,
  removeFacebookLot,
  reorderFacebookLots,
} from "../../src/lib/facebook-posts";
import {
  addProposalLots,
  convertProposalToSale,
  createProposalFromPost,
  getProposalSaleOptions,
  getProposalScreen,
  listPreparingProposals,
  moveProposal,
  removeProposalLot,
} from "../../src/lib/proposals";
import { reorderLotGroup } from "../../src/lib/offer-lot-groups";

// A Facebook post not yet up made into a proposal for one buyer (#2602). The proposal's lots are the
// post's own offers, under the post's numbers: a lot the buyer takes is sold in the post and does not
// go up with it, the rest stay in the post, and declining touches none of them. While the proposal is
// being prepared it follows the post's lots; once sent, the post's lots are fixed with it. The pure
// half is in `tests/unit/proposal-rules.test.ts`.

describe("a Facebook post made into a proposal (#2602)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;
  let nextContact = 0;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-postprop-${ts}`;
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
        data: { slug: `col-postprop-${ts}`, name: `postprop-${ts}`, baseCurrency: "PLN", ownerId: userId },
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
      })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.proposal.deleteMany({ where: { collection: { ownerId: userId } } });
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

  /** A Ready Facebook offer of one fresh copy, in a post of one of its own. */
  async function lotOffer(): Promise<string> {
    const item = await createItem(userId, collectionId, { stampId, conditionId, forSale: true });
    const offerId = await createOffer(userId, collectionId, input(), { seedItemIds: [item.id] });
    await prisma.offer.update({ where: { id: offerId }, data: { price: "3.00" } });
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  /** A post of `count` Ready lots, in lot order. */
  async function post(count: number): Promise<{ postId: string; postNo: number; lots: string[] }> {
    const lots: string[] = [];
    for (let i = 0; i < count; i++) lots.push(await lotOffer());
    const { postId, postNo } = await createFacebookPost(userId, collectionId, lots, "Test post");
    return { postId, postNo, lots };
  }

  async function contact(): Promise<string> {
    nextContact += 1;
    return (await prisma.contact.create({ data: { collectionId, name: `Buyer ${nextContact}` } })).id;
  }

  const rows = (ids: readonly string[]) =>
    prisma.offer
      .findMany({
        where: { id: { in: [...ids] } },
        select: { id: true, state: true, facebookPostId: true, facebookLotNo: true, proposalId: true, proposalLotNo: true },
      })
      .then((found) => ids.map((id) => found.find((r) => r.id === id)!));

  it("makes a post of 12 lots into a proposal of the same 12 lots and numbers, the two linked", async () => {
    const { postId, postNo, lots } = await post(12);
    const contactId = await contact();
    const { proposalId, proposalNo } = await createProposalFromPost(userId, postId, contactId);

    const screen = await getProposalScreen(userId, proposalId);
    assert.ok(screen);
    assert.equal(screen.status, "preparing");
    assert.deepEqual(
      screen.lots.map((l) => [l.offerId, l.lotNo]),
      lots.map((id, i) => [id, i + 1])
    );
    assert.equal(screen.post?.postNo, postNo);
    const postScreen = await getFacebookPostScreen(userId, postId);
    assert.deepEqual(postScreen?.proposal, {
      proposalId,
      proposalNo,
      contactName: screen.contact.name,
      status: "preparing",
    });
    // The lots stay on Facebook, in the post.
    assert.ok((await rows(lots)).every((r) => r.facebookPostId === postId));

    // A post has one open proposal at a time, and it takes no other offers than the post's.
    await assert.rejects(() => createProposalFromPost(userId, postId, contactId), /still open on this post/);
    await assert.rejects(() => addProposalLots(userId, proposalId, [lots[0]!]), /lots are the post's/);
    await assert.rejects(() => removeProposalLot(userId, proposalId, lots[0]!), /lots are the post's/);
    assert.ok(!(await listPreparingProposals(userId, collectionId)).some((p) => p.proposalId === proposalId));
    // Nor is the post deleted from under it.
    await assert.rejects(() => deleteFacebookPost(userId, postId), /still open/);
  });

  it("sells the lots the buyer took in the post, leaving the rest to go up with it", async () => {
    const { postId, lots } = await post(12);
    const contactId = await contact();
    const { proposalId } = await createProposalFromPost(userId, postId, contactId);
    await moveProposal(userId, proposalId, "send");

    const options = await getProposalSaleOptions(userId, proposalId);
    assert.equal(options.platformName, "Facebook");
    assert.deepEqual(options.post?.groupName, "Znaczki — aukcje");

    const result = await convertProposalToSale(userId, proposalId, {
      lots: [
        { offerId: lots[2]!, price: "4.00" },
        { offerId: lots[7]!, price: "5.00" },
      ],
      target: { newSale: true },
    });
    assert.equal(result.created, true);
    const sale = await prisma.sale.findUniqueOrThrow({ where: { id: result.saleId }, select: { platformId: true, buyerId: true } });
    assert.deepEqual(sale, { platformId: facebookId, buyerId: contactId });

    const after = await rows(lots);
    assert.deepEqual(
      after.map((r) => r.state),
      lots.map((_, i) => (i === 2 || i === 7 ? "sold" : "ready")),
      "lots 3 and 8 are sold, the other 10 are untouched"
    );
    assert.ok(after.every((r) => r.facebookPostId === postId), "every lot is still in the post");
    assert.equal((await getProposalScreen(userId, proposalId))?.status, "sold");

    // Published, the sold lots stay as they are and the rest go up.
    await publishOfferOrPost(userId, lots[0]!, "https://www.facebook.com/groups/123456/posts/1");
    assert.deepEqual(
      (await rows(lots)).map((r) => r.state),
      lots.map((_, i) => (i === 2 || i === 7 ? "sold" : "active"))
    );
  });

  it("publishes the post with its proposal open, and leaves the proposal open", async () => {
    const { postId, lots } = await post(3);
    const { proposalId } = await createProposalFromPost(userId, postId, await contact());
    await publishOfferOrPost(userId, lots[0]!, "https://www.facebook.com/groups/123456/posts/2");
    assert.equal((await getProposalScreen(userId, proposalId))?.status, "preparing");
    assert.deepEqual(
      (await rows(lots)).map((r) => [r.state, r.proposalId]),
      lots.map(() => ["active", proposalId])
    );
    // The buyer can still be sold what is unsold.
    const result = await convertProposalToSale(userId, proposalId, {
      lots: [{ offerId: lots[1]!, price: "3.00" }],
      target: { newSale: true },
    });
    assert.ok(result.saleId);
    assert.deepEqual(
      (await rows(lots)).map((r) => r.state),
      ["active", "sold", "active"]
    );
  });

  it("declines without touching any lot of the post, and the next proposal takes them", async () => {
    const { postId, lots } = await post(4);
    const { proposalId } = await createProposalFromPost(userId, postId, await contact());
    await moveProposal(userId, proposalId, "decline");
    assert.deepEqual(
      (await rows(lots)).map((r) => [r.state, r.facebookPostId]),
      lots.map(() => ["ready", postId])
    );
    const next = await createProposalFromPost(userId, postId, await contact());
    assert.deepEqual(
      (await rows(lots)).map((r) => [r.proposalId, r.proposalLotNo]),
      lots.map((_, i) => [next.proposalId, i + 1])
    );
  });

  it("follows the post's lots while it is being prepared", async () => {
    const { postId, lots } = await post(3);
    const { proposalId } = await createProposalFromPost(userId, postId, await contact());

    // A lot added to the post joins the proposal with the same number.
    const added = await lotOffer();
    await addFacebookLots(userId, postId, [added]);
    assert.deepEqual(await rows([added]).then(([r]) => [r!.proposalId, r!.facebookLotNo, r!.proposalLotNo]), [
      proposalId,
      4,
      4,
    ]);

    // A lot taken out of the post leaves it, and the numbers follow the post's.
    await removeFacebookLot(userId, lots[0]!);
    const [gone, ...rest] = await rows([lots[0]!, lots[1]!, lots[2]!, added]);
    assert.equal(gone!.proposalId, null);
    assert.deepEqual(
      rest.map((r) => [r.facebookLotNo, r.proposalLotNo]),
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ]
    );

    // Put in another order on either screen, both follow.
    await reorderFacebookLots(userId, postId, [added, lots[1]!, lots[2]!]);
    assert.deepEqual(
      (await rows([added, lots[1]!, lots[2]!])).map((r) => [r.facebookLotNo, r.proposalLotNo]),
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ]
    );
    await reorderLotGroup(userId, { kind: "proposal", id: proposalId }, [lots[2]!, lots[1]!, added]);
    assert.deepEqual(
      (await rows([lots[2]!, lots[1]!, added])).map((r) => [r.facebookLotNo, r.proposalLotNo]),
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ]
    );
  });

  it("fixes the post's lots while the proposal is sent, until it is reopened", async () => {
    const { postId, lots } = await post(3);
    const { proposalId } = await createProposalFromPost(userId, postId, await contact());
    await moveProposal(userId, proposalId, "send");

    const extra = await lotOffer();
    await assert.rejects(() => addFacebookLots(userId, postId, [extra]), /has been sent/);
    await assert.rejects(() => removeFacebookLot(userId, lots[0]!), /has been sent/);
    await assert.rejects(() => reorderFacebookLots(userId, postId, [lots[2]!, lots[1]!, lots[0]!]), /has been sent/);
    assert.deepEqual(
      (await rows(lots)).map((r) => [r.facebookLotNo, r.proposalLotNo]),
      [
        [1, 1],
        [2, 2],
        [3, 3],
      ]
    );

    await moveProposal(userId, proposalId, "reopen");
    await addFacebookLots(userId, postId, [extra]);
    assert.equal((await rows([extra]))[0]!.proposalId, proposalId);
  });

  it("is made only before the post is up", async () => {
    const { postId, lots } = await post(2);
    await publishOfferOrPost(userId, lots[0]!, "https://www.facebook.com/groups/123456/posts/3");
    const contactId = await contact();
    await assert.rejects(() => createProposalFromPost(userId, postId, contactId), /is up/);
  });
});
