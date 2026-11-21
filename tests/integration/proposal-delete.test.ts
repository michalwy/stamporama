import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, setOfferState, type NewOfferInput, type OfferInput } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost } from "../../src/lib/facebook-posts";
import {
  addProposalLots,
  createProposal,
  createProposalFromPost,
  deleteProposal,
  getDirectPlatform,
  getProposalScreen,
  moveProposal,
  readProposalDeletion,
} from "../../src/lib/proposals";
import {
  createProposalShareToken,
  readSharedProposalDocument,
  verifyProposalShareToken,
} from "../../src/lib/proposal-handout";

// Deleting a proposal (#2641): any but a Sold one. Its lots go with it and their copies are free again;
// a lot with a sold set stays with its sale, and a proposal made from a post deletes no lot — they are
// the post's. Every lot that stays stops naming the proposal. The buyer's live link then says the offer
// is no longer available. The pure half is in `tests/unit/proposal-rules.test.ts`.

const ts = Date.now();

describe("Deleting a proposal (#2641)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let conditionId: string;
  let directId: string;
  let facebookId: string;
  let groupId: string;
  let nextStamp = 0;
  let nextContact = 0;
  let nextSale = 9000;

  async function copy(): Promise<string> {
    nextStamp += 1;
    const stampId = (await prisma.stamp.create({ data: { collectionId, name: `Stamp ${nextStamp}` } })).id;
    return (await createItem(userId, collectionId, { stampId, conditionId, forSale: true, deliveryState: "delivered" })).id;
  }

  async function contact(): Promise<string> {
    nextContact += 1;
    return (await prisma.contact.create({ data: { collectionId, name: `Buyer ${nextContact}`, buyer: true } })).id;
  }

  /** A Direct offer of one fresh copy, with its copy. */
  async function directLot(): Promise<{ offerId: string; itemId: string }> {
    const itemId = await copy();
    const offerId = await createOffer(
      userId,
      collectionId,
      { platformId: directId, url: null, price: "5.00", startingPrice: null, currency: "PLN", listingDate: null },
      { seedItemIds: [itemId] }
    );
    return { offerId, itemId };
  }

  /** A proposal of `count` fresh Direct lots. */
  async function proposalOf(count: number) {
    const lots = [];
    for (let i = 0; i < count; i++) lots.push(await directLot());
    const { proposalId, proposalNo } = await createProposal(userId, collectionId, await contact());
    await addProposalLots(userId, proposalId, lots.map((l) => l.offerId));
    return { proposalId, proposalNo, lots };
  }

  /** A Ready Facebook offer of one fresh copy. */
  async function facebookLot(): Promise<string> {
    const input: OfferInput & NewOfferInput = {
      platformId: facebookId,
      url: null,
      price: "0.00",
      currency: "PLN",
      listingDate: null,
      facebookGroupId: groupId,
      startingPrice: "3.00",
    };
    const offerId = await createOffer(userId, collectionId, input, { seedItemIds: [await copy()] });
    await prisma.offer.update({ where: { id: offerId }, data: { price: "3.00" } });
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  /** Sell one lot's set by hand, as a sale on another platform would. */
  async function sellLot(offerId: string): Promise<void> {
    const set = await prisma.offerSet.findFirstOrThrow({ where: { offerId }, select: { id: true, items: { select: { itemId: true } } } });
    nextSale += 1;
    const sale = await prisma.sale.create({
      data: { collectionId, saleNo: nextSale, platformId: directId, soldAt: new Date(), currency: "PLN" },
    });
    const line = await prisma.saleLine.create({ data: { saleId: sale.id, offerId, offerSetId: set.id, price: "5.00" } });
    for (const { itemId } of set.items) await prisma.saleLineItem.create({ data: { saleLineId: line.id, itemId } });
    await prisma.offer.update({ where: { id: offerId }, data: { state: "sold" } });
  }

  before(async () => {
    userId = `test-user-proposal-delete-${ts}`;
    otherUserId = `test-user-proposal-delete-other-${ts}`;
    for (const id of [userId, otherUserId]) {
      await prisma.user.create({
        data: { id, name: `Test User ${id}`, email: `${id}@example.com`, emailVerified: true, createdAt: new Date(), updatedAt: new Date() },
      });
    }
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-proposal-delete-${ts}`, name: "Proposal delete", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    facebookId = (await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    // After Facebook: making Direct makes every module platform the collection lacks.
    directId = (await getDirectPlatform(collectionId)).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/2641",
      })
    ).id;
  });

  after(async () => {
    await prisma.sale.deleteMany({ where: { collectionId } });
    await prisma.offer.deleteMany({ where: { collection: { ownerId: { in: [userId, otherUserId] } } } });
    await prisma.proposal.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
  });

  it("deletes a Preparing proposal of 5 lots with its 5 offers, the copies free to go into a new offer", async () => {
    const { proposalId, proposalNo, lots } = await proposalOf(5);
    const deletion = await readProposalDeletion(userId, proposalId);
    assert.equal(deletion.status, "preparing");
    assert.equal(deletion.lotCount, 5);
    assert.equal(deletion.soldLotCount, 0);
    assert.equal(deletion.post, null);
    assert.equal(deletion.hasLink, false);

    assert.deepEqual(await deleteProposal(userId, proposalId), { proposalNo, deletedLots: 5 });
    assert.equal(await prisma.proposal.count({ where: { id: proposalId } }), 0);
    assert.equal(await prisma.offer.count({ where: { id: { in: lots.map((l) => l.offerId) } } }), 0);
    assert.equal(await prisma.item.count({ where: { id: { in: lots.map((l) => l.itemId) } } }), 5);

    const again = await createOffer(
      userId,
      collectionId,
      { platformId: directId, url: null, price: "9.00", startingPrice: null, currency: "PLN", listingDate: null },
      { seedItemIds: lots.map((l) => l.itemId) }
    );
    assert.equal(await prisma.offerSetItem.count({ where: { offerSet: { offerId: again } } }), 5);
  });

  it("deletes a Sent proposal, its live link then saying the offer is no longer available, and never gives its number again", async () => {
    const { proposalId, proposalNo } = await proposalOf(2);
    await moveProposal(userId, proposalId, "send");
    const { token } = await createProposalShareToken(userId, proposalId);
    const deletion = await readProposalDeletion(userId, proposalId);
    assert.equal(deletion.status, "sent");
    assert.equal(deletion.hasLink, true);

    await deleteProposal(userId, proposalId);
    const access = await verifyProposalShareToken(token);
    assert.ok(access);
    assert.equal(access.proposalId, null);
    assert.equal((await readSharedProposalDocument(access)).standing, "gone");

    const next = await createProposal(userId, collectionId, await contact());
    assert.ok(next.proposalNo > proposalNo);
  });

  it("refuses a Sold proposal", async () => {
    const { proposalId } = await proposalOf(1);
    await prisma.proposal.update({ where: { id: proposalId }, data: { status: "sold", closedAt: new Date() } });
    assert.equal((await readProposalDeletion(userId, proposalId)).status, "sold");
    await assert.rejects(deleteProposal(userId, proposalId), /sold proposal cannot be deleted/);
    assert.equal(await prisma.proposal.count({ where: { id: proposalId } }), 1);
  });

  it("keeps a sold lot with its sale, no longer naming the proposal, and deletes the rest", async () => {
    const { proposalId, lots } = await proposalOf(3);
    await sellLot(lots[1].offerId);
    await moveProposal(userId, proposalId, "decline");
    const deletion = await readProposalDeletion(userId, proposalId);
    assert.equal(deletion.lotCount, 2);
    assert.equal(deletion.soldLotCount, 1);

    assert.equal((await deleteProposal(userId, proposalId)).deletedLots, 2);
    const kept = await prisma.offer.findUniqueOrThrow({
      where: { id: lots[1].offerId },
      select: { state: true, proposalId: true, proposalLotNo: true, proposalPickedAt: true },
    });
    assert.deepEqual(kept, { state: "sold", proposalId: null, proposalLotNo: null, proposalPickedAt: null });
    assert.equal(await prisma.offer.count({ where: { id: { in: [lots[0].offerId, lots[2].offerId] } } }), 0);
  });

  it("leaves a post's lots untouched in the post, and the post can have a new proposal made from it", async () => {
    const lots = [await facebookLot(), await facebookLot(), await facebookLot()];
    const { postId } = await createFacebookPost(userId, collectionId, lots, "Test post");
    const { proposalId } = await createProposalFromPost(userId, postId, await contact());
    await prisma.offer.update({ where: { id: lots[0] }, data: { proposalPickedAt: new Date() } });
    await moveProposal(userId, proposalId, "send");
    const before = await prisma.offer.findMany({
      where: { id: { in: lots } },
      orderBy: { facebookLotNo: "asc" },
      select: { id: true, state: true, facebookPostId: true, facebookLotNo: true, price: true },
    });
    const deletion = await readProposalDeletion(userId, proposalId);
    assert.equal(deletion.lotCount, 0);
    assert.equal(deletion.post?.lotCount, 3);

    assert.equal((await deleteProposal(userId, proposalId)).deletedLots, 0);
    const after = await prisma.offer.findMany({
      where: { id: { in: lots } },
      orderBy: { facebookLotNo: "asc" },
      select: { id: true, state: true, facebookPostId: true, facebookLotNo: true, price: true, proposalId: true, proposalLotNo: true, proposalPickedAt: true },
    });
    assert.deepEqual(
      after.map((l) => ({ id: l.id, state: l.state, facebookPostId: l.facebookPostId, facebookLotNo: l.facebookLotNo, price: l.price })),
      before
    );
    assert.ok(after.every((l) => l.proposalId === null && l.proposalLotNo === null && l.proposalPickedAt === null));

    const remade = await createProposalFromPost(userId, postId, await contact());
    assert.equal((await getProposalScreen(userId, remade.proposalId))?.lots.length, 3);
  });

  it("refuses another collector's proposal", async () => {
    const { proposalId } = await proposalOf(1);
    await assert.rejects(readProposalDeletion(otherUserId, proposalId));
    await assert.rejects(deleteProposal(otherUserId, proposalId));
    assert.equal(await prisma.proposal.count({ where: { id: proposalId } }), 1);
  });
});
