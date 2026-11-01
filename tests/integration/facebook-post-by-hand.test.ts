import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer, type NewOfferInput } from "../../src/lib/offers";
import { createFacebookGroup, setFacebookGroupArchived } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  addFacebookLots,
  createEmptyFacebookPost,
  createFacebookLot,
  deleteFacebookPost,
  getFacebookPostScreen,
  listFacebookLotCandidates,
  listFacebookPostsPaginated,
  publishOfferOrPost,
} from "../../src/lib/facebook-posts";

// A Facebook post made by hand (#2291): empty, with its group, title and layout, before it has any lot;
// then its lots made one by one on its screen (`createFacebookLot`) — each a new offer on Facebook in the
// post's group, numbered as the post's next lot in the same write, so a refused lot is no offer and no
// post of one is made for it and thrown away. The screen's buttons are pure
// (`tests/unit/facebook-post-rules.test.ts`).

describe("a Facebook post made by hand, its lots made on its screen (#2291)", () => {
  let userId: string;
  let collectionId: string;
  let facebookId: string;
  let otherPlatformId: string;
  let stampId: string;
  let conditionId: string;
  let groupId: string;
  let otherGroupId: string;

  before(async () => {
    const ts = Date.now();
    userId = `test-user-fbbyhand-${ts}`;
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
        data: { slug: `col-fbbyhand-${ts}`, name: `fbbyhand-${ts}`, baseCurrency: "PLN", ownerId: userId },
      })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "PLN" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    otherPlatformId = (
      await prisma.platform.create({ data: { collectionId, name: "Allegro-ish", platformCurrency: "PLN" } })
    ).id;
    stampId = (await prisma.stamp.create({ data: { collectionId, name: "Mercury" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    const group = (name: string, n: number) =>
      createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name,
        url: `https://www.facebook.com/groups/${n}`,
      });
    groupId = (await group("Znaczki — ręcznie", 229101)).id;
    otherGroupId = (await group("Filatelistyka", 229102)).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.facebookPost.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  const copy = async () => (await createItem(userId, collectionId, { stampId, conditionId, forSale: true })).id;

  /** What the offer form sends for a lot — on another platform and in another group on purpose, which
   *  the post overrides. */
  function lotInput(overrides: Partial<NewOfferInput> = {}): NewOfferInput {
    return {
      platformId: otherPlatformId,
      url: null,
      price: "0.00",
      startingPrice: "3.00",
      currency: "PLN",
      listingDate: null,
      facebookGroupId: otherGroupId,
      listingType: "auction",
      ...overrides,
    };
  }

  const nextPostNo = async () =>
    (await prisma.collection.findUniqueOrThrow({ where: { id: collectionId }, select: { nextFacebookPostNo: true } }))
      .nextFacebookPostNo;

  it("makes an empty post with its group, title and layout, shown with no lots and listed as being prepared", async () => {
    const made = await createEmptyFacebookPost(userId, collectionId, {
      groupId,
      title: "  PRL 1951–62, blocks ",
      layout: "captions",
    });
    const row = await prisma.facebookPost.findUniqueOrThrow({ where: { id: made.postId } });
    assert.equal(row.postNo, made.postNo);
    assert.equal(row.title, "PRL 1951–62, blocks");
    assert.equal(row.layout, "captions");
    assert.equal(row.groupId, groupId);
    assert.equal(row.titleFollowsOffer, false, "a post made by hand keeps its own title");

    const screen = await getFacebookPostScreen(userId, made.postId);
    assert.ok(screen, "an empty post has a screen");
    assert.equal(screen.kit.lots.length, 0);
    assert.equal(screen.kit.group.id, groupId);
    assert.equal(screen.platform.id, facebookId);

    const preparing = await listFacebookPostsPaginated(userId, collectionId, { stage: "preparing" });
    const listed = preparing.items.find((p) => p.postId === made.postId);
    assert.ok(listed, "the stage filter finds a post with no lot as being prepared");
    assert.equal(listed.lotCount, 0);
    assert.equal(listed.stage, "preparing");
    const ready = await listFacebookPostsPaginated(userId, collectionId, { stage: "ready" });
    assert.ok(!ready.items.some((p) => p.postId === made.postId), "and never as ready");
    const notUp = await listFacebookPostsPaginated(userId, collectionId, { notUp: true });
    assert.ok(notUp.items.some((p) => p.postId === made.postId), "Add to post… offers it");
  });

  it("refuses a post with no title or in an archived group", async () => {
    await assert.rejects(
      () => createEmptyFacebookPost(userId, collectionId, { groupId, title: "  ", layout: null }),
      /needs a title/
    );
    const archived = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Old group",
        url: "https://www.facebook.com/groups/229103",
      })
    ).id;
    await setFacebookGroupArchived(userId, archived, true);
    await assert.rejects(
      () => createEmptyFacebookPost(userId, collectionId, { groupId: archived, title: "Old", layout: null }),
      /archived/
    );
  });

  it("makes each new lot an offer on Facebook in the post's group, numbered next, with no post of one burnt", async () => {
    const post = await createEmptyFacebookPost(userId, collectionId, { groupId, title: "Blocks", layout: null });
    const before = await nextPostNo();

    const first = await createFacebookLot(userId, post.postId, lotInput(), { seedItemIds: [await copy()] });
    assert.equal(first.lotNo, 1);
    assert.equal(first.postNo, post.postNo);
    const second = await createFacebookLot(userId, post.postId, lotInput(), {
      seedItemIds: [await copy(), await copy()],
      seedPerCopy: true,
    });
    assert.equal(second.lotNo, 2);

    assert.equal(await nextPostNo(), before, "no post of one was made and thrown away");
    const offers = await prisma.offer.findMany({
      where: { id: { in: [first.offerId, second.offerId] } },
      orderBy: { facebookLotNo: "asc" },
      select: {
        platformId: true,
        facebookGroupId: true,
        facebookPostId: true,
        facebookLotNo: true,
        state: true,
        _count: { select: { sets: true } },
      },
    });
    for (const o of offers) {
      assert.equal(o.platformId, facebookId, "on Facebook whatever the form named");
      assert.equal(o.facebookGroupId, groupId, "in the post's group");
      assert.equal(o.facebookPostId, post.postId);
    }
    assert.deepEqual(offers.map((o) => o.state), ["preparing", "preparing"], "every new offer starts Preparing (#2322)");
    assert.deepEqual(offers.map((o) => o._count.sets), [1, 2], "the copies picked, packaged as asked");
    const row = await prisma.facebookPost.findUniqueOrThrow({ where: { id: post.postId } });
    assert.equal(row.title, "Blocks", "the post keeps its title");
  });

  it("keeps a new lot to the post's type unless the group mixes them, refusing it whole", async () => {
    const post = await createEmptyFacebookPost(userId, collectionId, { groupId, title: "Quick buys", layout: null });
    await createFacebookLot(userId, post.postId, lotInput({ listingType: "fixed", price: "20.00", startingPrice: null }), {
      seedItemIds: [await copy()],
    });
    const offersBefore = await prisma.offer.count({ where: { collectionId } });
    const postNoBefore = await nextPostNo();
    await assert.rejects(
      async () => createFacebookLot(userId, post.postId, lotInput(), { seedItemIds: [await copy()] }),
      /The new lot is an auction and this post's lots are quick buys/
    );
    assert.equal(await prisma.offer.count({ where: { collectionId } }), offersBefore, "no offer is left behind");
    assert.equal(await nextPostNo(), postNoBefore);
  });

  it("gives the post's auctions one closing time", async () => {
    const post = await createEmptyFacebookPost(userId, collectionId, { groupId, title: "Auctions", layout: null });
    const closes = new Date("2026-11-08T19:00:00Z");
    const a = await createFacebookLot(userId, post.postId, lotInput({ endsAt: closes }), { seedItemIds: [await copy()] });
    const b = await createFacebookLot(userId, post.postId, lotInput({ endsAt: new Date("2026-11-09T19:00:00Z") }), {
      seedItemIds: [await copy()],
    });
    const ends = await prisma.offer.findMany({ where: { id: { in: [a.offerId, b.offerId] } }, select: { endsAt: true } });
    for (const e of ends) assert.deepEqual(e.endsAt, closes, "the post's first auction's");
  });

  it("makes no lot in a post that is up", async () => {
    const post = await createEmptyFacebookPost(userId, collectionId, { groupId, title: "Up", layout: null });
    const lot = await createFacebookLot(userId, post.postId, lotInput(), { seedItemIds: [await copy()] });
    await prisma.offer.update({ where: { id: lot.offerId }, data: { state: "ready" } });
    await publishOfferOrPost(userId, lot.offerId, "https://www.facebook.com/groups/229101/posts/1", "active");
    const offersBefore = await prisma.offer.count({ where: { collectionId } });
    await assert.rejects(
      async () => createFacebookLot(userId, post.postId, lotInput(), { seedItemIds: [await copy()] }),
      /is up, so it takes no new lots/
    );
    assert.equal(await prisma.offer.count({ where: { collectionId } }), offersBefore);
  });

  it("takes offers that exist of either type while it has no lot, and is deleted while empty", async () => {
    const post = await createEmptyFacebookPost(userId, collectionId, { groupId, title: "Either", layout: null });
    const quickBuy = await createOffer(
      userId,
      collectionId,
      lotInput({ platformId: facebookId, facebookGroupId: groupId, listingType: "fixed", price: "20.00", startingPrice: null }),
      { seedItemIds: [await copy()] }
    );
    const candidates = await listFacebookLotCandidates(userId, collectionId, post.postId);
    assert.ok(candidates.some((c) => c.offerId === quickBuy), "a quick buy is a candidate for an empty post");
    const added = await addFacebookLots(userId, post.postId, [quickBuy]);
    assert.deepEqual(added.added.map((x) => x.lotNo), [1]);

    const empty = await createEmptyFacebookPost(userId, collectionId, { groupId, title: "Gone", layout: null });
    assert.deepEqual(await deleteFacebookPost(userId, empty.postId), { postNo: empty.postNo, offerCount: 0 });
    assert.equal(await prisma.facebookPost.count({ where: { id: empty.postId } }), 0);
  });
});
