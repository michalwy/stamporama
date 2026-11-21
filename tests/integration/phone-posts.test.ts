import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, patchOffer, setOfferState } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import { createFacebookPost, publishOfferOrPost, rejectOfferOrPost } from "../../src/lib/facebook-posts";
import { getPhonePost } from "../../src/lib/phone-posts";
import { getFacebookPostKit } from "../../src/lib/facebook-auctions";
import { facebookPostMoves, facebookPostLink } from "../../src/lib/facebook-post-rules";
import { facebookPostPublishVia } from "../../src/lib/facebook-post-publish-rules";

// The post's photos are read with it, through the photo store.
const DATA_DIR = mkdtempSync(path.join(tmpdir(), "stamporama-phone-posts-"));
process.env.STAMPORAMA_DATA_DIR = DATA_DIR;

// A Facebook post on the phone (#2626): its group, stage and closing time, and every lot in lot order
// with the price the desk's post screen gives it — the starting price until a bid is recorded, then the
// bid — and its state. The pure wording is `tests/unit/phone-post-view.test.ts`.

describe("a Facebook post on the phone (#2626)", () => {
  let userId: string;
  let otherUserId: string;
  let collectionId: string;
  let otherCollectionId: string;
  let facebookId: string;
  let groupId: string;
  let stampId: string;
  let conditionId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-phone-posts-${ts}`;
    otherUserId = `test-user-phone-posts-other-${ts}`;
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
        data: { slug: `col-phone-posts-${ts}`, name: "Phone posts", baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    otherCollectionId = (
      await prisma.collection.create({
        data: { slug: `col-phone-posts-other-${ts}`, name: "Other", baseCurrency: "PLN", ownerId: otherUserId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/2626",
      })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collectionId } });
    await prisma.facebookPost.deleteMany({ where: { collectionId } });
    await prisma.collection.deleteMany({ where: { ownerId: { in: [userId, otherUserId] } } });
    await prisma.user.deleteMany({ where: { id: { in: [userId, otherUserId] } } });
    await rm(DATA_DIR, { recursive: true, force: true });
  });

  /** A Ready Facebook auction of one copy, starting at 3.00 PLN. */
  async function auction(): Promise<string> {
    const itemId = (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;
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
        facebookGroupId: groupId,
        listingType: "auction",
      },
      { seedItemIds: [itemId] }
    );
    await setOfferState(userId, offerId, "ready");
    return offerId;
  }

  it("reads a post up in its group: every lot, its price and state, and when it closes", async () => {
    const lots = [await auction(), await auction(), await auction()];
    const { postNo } = await createFacebookPost(userId, collectionId, lots, "Merkury 1950");
    await publishOfferOrPost(userId, lots[0], "https://www.facebook.com/groups/2626/posts/1");
    const endsAt = new Date(Date.now() + 6 * 60 * 60 * 1000);
    await prisma.offer.updateMany({ where: { id: { in: lots } }, data: { endsAt } });
    await patchOffer(userId, lots[1], { price: "12.50" });
    await setOfferState(userId, lots[2], "withdrawn");

    const post = await getPhonePost(userId, collectionId, postNo);
    assert.ok(post);
    assert.equal(post.postNo, postNo);
    assert.equal(post.title, "Merkury 1950");
    assert.deepEqual(post.group, { name: "Znaczki — aukcje", archived: false });
    assert.equal(post.stage, "up");
    // The withdrawn lot no longer runs, so it does not count towards the close.
    assert.deepEqual(post.closes, { from: endsAt.toISOString(), to: endsAt.toISOString() });
    assert.equal(post.proposal, null);
    assert.deepEqual(
      post.lots.map((l) => ({ offerId: l.offerId, lotNo: l.lotNo, state: l.state, price: l.price })),
      [
        { offerId: lots[0], lotNo: 1, state: "active", price: { label: "Start", amount: "3.00", currency: "PLN" } },
        { offerId: lots[1], lotNo: 2, state: "active", price: { label: "Bid", amount: "12.50", currency: "PLN" } },
        { offerId: lots[2], lotNo: 3, state: "withdrawn", price: { label: "Start", amount: "3.00", currency: "PLN" } },
      ]
    );
  });

  it("says no closing time for a post not yet up", async () => {
    const { postNo } = await createFacebookPost(userId, collectionId, [await auction(), await auction()], "Ready post");
    const post = await getPhonePost(userId, collectionId, postNo);
    assert.equal(post?.stage, "ready");
    assert.equal(post?.closes, null);
    assert.deepEqual(post?.lots.map((l) => l.lotNo), [1, 2]);
  });

  // Publishing from the phone (#2629): the moves read off the kit the phone is given, the lot the
  // publish is asked through, and the desk's own publish — so the desk sees the post up with that link.
  it("publishes a Ready post from the phone: submitted for approval, then approved with its closing time", async () => {
    const lots = [await auction(), await auction()];
    const { postNo } = await createFacebookPost(userId, collectionId, lots, "From the phone");
    const ready = await getPhonePost(userId, collectionId, postNo);
    assert.ok(ready);
    assert.deepEqual(ready.kit.lots.map((l) => l.offerId), lots);
    assert.equal(ready.photos.layout, "text");
    const moves = facebookPostMoves(ready.kit.lots);
    assert.ok(moves.activate && moves.submit && !moves.approve);

    const pendingLink = "https://www.facebook.com/groups/2626/pending_posts/77";
    await publishOfferOrPost(userId, facebookPostPublishVia(ready.kit.lots, false)!, pendingLink, "pending");
    const waiting = await getPhonePost(userId, collectionId, postNo);
    assert.equal(waiting?.stage, "pending");
    const waitingMoves = facebookPostMoves(waiting!.kit.lots);
    assert.ok(waitingMoves.approve && waitingMoves.reject && !waitingMoves.activate);
    // *Approved* starts from the pending post's link, as the desk's dialog does.
    assert.equal(facebookPostLink(waiting!.kit.lots), pendingLink);

    const endsAt = new Date(Date.now() + 3 * 24 * 60 * 60 * 1000);
    const finalLink = "https://www.facebook.com/groups/2626/posts/78";
    await publishOfferOrPost(userId, facebookPostPublishVia(waiting!.kit.lots, true)!, finalLink, "active", endsAt);
    const up = await getPhonePost(userId, collectionId, postNo);
    assert.equal(up?.stage, "up");
    assert.deepEqual(up?.closes, { from: endsAt.toISOString(), to: endsAt.toISOString() });
    const rows = await prisma.offer.findMany({ where: { id: { in: lots } }, select: { state: true, url: true } });
    assert.deepEqual(
      rows.map((r) => [r.state, r.url]),
      [
        ["active", finalLink],
        ["active", finalLink],
      ]
    );
  });

  it("takes a post the group rejected back to Ready from the phone, its pending link cleared", async () => {
    const lots = [await auction(), await auction()];
    const { postNo } = await createFacebookPost(userId, collectionId, lots, "Rejected");
    await publishOfferOrPost(userId, lots[0], "https://www.facebook.com/groups/2626/pending_posts/79", "pending");
    const waiting = await getPhonePost(userId, collectionId, postNo);
    const pendingLot = waiting!.kit.lots.find((l) => l.state === "pending");
    assert.ok(pendingLot);
    await rejectOfferOrPost(userId, pendingLot.offerId);
    const back = await getPhonePost(userId, collectionId, postNo);
    assert.equal(back?.stage, "ready");
    assert.ok(facebookPostMoves(back!.kit.lots).activate);
    assert.equal(facebookPostLink(back!.kit.lots), null);
  });

  // Bids lot by lot on the post's screen (#2630): each through the offer's own price write, the one
  // `patchOfferAction(…, "price")` makes for the phone and the desk, so the desk's post read shows them
  // as recorded bids with their times. A sold lot has no field.
  it("records bids on lots 2, 5 and 9 from the post's screen, and gives a sold lot no field", async () => {
    const lots: string[] = [];
    for (let i = 0; i < 10; i++) lots.push(await auction());
    const { postId, postNo } = await createFacebookPost(userId, collectionId, lots, "Ten lots");
    await publishOfferOrPost(userId, lots[0], "https://www.facebook.com/groups/2626/posts/80");
    await prisma.offer.updateMany({
      where: { id: { in: lots } },
      data: { endsAt: new Date(Date.now() + 6 * 60 * 60 * 1000) },
    });
    await prisma.offer.update({ where: { id: lots[6] }, data: { state: "sold" } });

    const up = await getPhonePost(userId, collectionId, postNo);
    assert.ok(up);
    const byNo = new Map(up.lots.map((l) => [l.lotNo, l]));
    assert.deepEqual(byNo.get(2)?.bidding, { closed: false, hasBid: false, priceCheckedAt: null });
    assert.equal(byNo.get(7)?.state, "sold");
    assert.equal(byNo.get(7)?.bidding, null);

    const before = Date.now();
    const bids = new Map([
      [2, "11.00"],
      [5, "7.50"],
      [9, "23.00"],
    ]);
    for (const [lotNo, bid] of bids) await patchOffer(userId, byNo.get(lotNo)!.offerId, { price: bid });

    const after = await getPhonePost(userId, collectionId, postNo);
    for (const lot of after!.lots) {
      const bid = bids.get(lot.lotNo);
      if (bid) {
        assert.deepEqual(lot.price, { label: "Bid", amount: bid, currency: "PLN" });
        assert.equal(lot.bidding?.hasBid, true);
        assert.ok(lot.bidding?.priceCheckedAt && Date.parse(lot.bidding.priceCheckedAt) >= before - 1000);
      } else if (lot.lotNo !== 7) {
        assert.deepEqual(lot.bidding, { closed: false, hasBid: false, priceCheckedAt: null });
      }
    }

    // The desk's post read: the three recorded bids, each with when it was recorded.
    const desk = await getFacebookPostKit(postId);
    const recorded = desk!.lots
      .filter((l) => l.price !== "0.00")
      .map((l) => ({ lotNo: l.lotNo, price: l.price, timed: l.priceCheckedAt !== null }));
    assert.deepEqual(recorded, [
      { lotNo: 2, price: "11.00", timed: true },
      { lotNo: 5, price: "7.50", timed: true },
      { lotNo: 9, price: "23.00", timed: true },
    ]);
  });

  it("finds no post the collection does not number, and none for somebody else", async () => {
    assert.equal(await getPhonePost(userId, collectionId, 9999), null);
    await assert.rejects(getPhonePost(otherUserId, collectionId, 1));
    assert.equal(await getPhonePost(otherUserId, otherCollectionId, 1), null);
  });
});
