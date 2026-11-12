import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { prisma } from "../../src/lib/db";
import { createItem } from "../../src/lib/items";
import { createOffer } from "../../src/lib/offers";
import { createFacebookGroup } from "../../src/lib/facebook-groups";
import { FACEBOOK_GROUP_DEFAULTS } from "../../src/lib/facebook-group-rules";
import {
  commitOfferGeneration,
  previewOfferGeneration,
  type GeneratorInput,
} from "../../src/lib/offer-generator";

// Generate offers on Facebook straight into a new post (#2030): the offers a pass creates become the
// lots of one new post in the bar's group, in the preview's order; an existing offer that only receives
// sets stays where it is; a pass the post would refuse writes nothing; and without the option nothing
// changes. Each case makes stamps of its own and passes its own copies, so the cases never meet.

const ts = Date.now();

describe("Generate offers into a new post (#2030)", () => {
  let userId: string;
  let collectionId: string;
  let areaId: string;
  let conditionId: string;
  let facebookId: string;
  let colnectId: string;
  let groupId: string;
  let nextStamp = 0;
  const endsAt = "2026-11-01T19:00:00.000Z";

  /** A for-sale copy in hand, of a stamp of its own. */
  async function copy(stampId?: string): Promise<string> {
    nextStamp += 1;
    const id =
      stampId ??
      (
        await prisma.stamp.create({
          data: {
            collectionId,
            name: `Stamp ${nextStamp}`,
            issuedYear: 1960,
            stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
          },
        })
      ).id;
    return (await createItem(userId, collectionId, { stampId: id, conditionId, forSale: true, deliveryState: "delivered" })).id;
  }

  function singles(itemIds: string[], extra: Partial<GeneratorInput> = {}): GeneratorInput {
    return {
      platformId: facebookId,
      mode: "singles",
      packaging: "multi",
      itemIds,
      filters: {},
      targets: {},
      skip: [],
      facebook: { facebookGroupId: groupId, endsAt },
      ...extra,
    };
  }

  async function offerOf(itemId: string) {
    return prisma.offer.findFirstOrThrow({
      where: { collectionId, sets: { some: { items: { some: { itemId } } } } },
      select: { id: true, facebookPostId: true, facebookLotNo: true, endsAt: true },
    });
  }

  before(async () => {
    userId = `test-user-genpost-${ts}`;
    await prisma.user.create({
      data: {
        id: userId,
        name: `Test User genpost-${ts}`,
        email: `test-genpost-${ts}@example.com`,
        emailVerified: true,
        createdAt: new Date(),
        updatedAt: new Date(),
      },
    });
    collectionId = (
      await prisma.collection.create({
        data: { slug: `col-genpost-${ts}`, name: "Generate into a post", baseCurrency: "EUR", ownerId: userId },
      })
    ).id;
    areaId = (await prisma.collectionArea.create({ data: { collectionId, name: "Germany" } })).id;
    conditionId = (
      await prisma.stampCondition.create({ data: { collectionId, name: "Used", abbreviation: "U", sortOrder: 0 } })
    ).id;
    facebookId = (
      await prisma.platform.create({ data: { collectionId, name: "Facebook", platformCurrency: "EUR" } })
    ).id;
    await prisma.platform.update({ where: { id: facebookId }, data: { platformModule: "facebook" } });
    colnectId = (
      await prisma.platform.create({ data: { collectionId, name: "Colnect", platformCurrency: "EUR" } })
    ).id;
    groupId = (
      await createFacebookGroup(userId, collectionId, {
        ...FACEBOOK_GROUP_DEFAULTS,
        name: "Znaczki — aukcje",
        url: "https://www.facebook.com/groups/123456",
        startingPriceMode: "amount",
        startingPriceValue: 4,
        custom: ["startingPrice"],
      })
    ).id;
  });

  after(async () => {
    await prisma.offer.deleteMany({ where: { collection: { ownerId: userId } } });
    await prisma.collection.deleteMany({ where: { ownerId: userId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  });

  it("makes the new offers the lots of one new post, in the preview's order, and names it", async () => {
    const copies = [await copy(), await copy(), await copy()];
    const input = singles(copies);
    const preview = await previewOfferGeneration(userId, collectionId, input);
    assert.equal(preview.lines.length, 3);
    const { nextFacebookPostNo } = await prisma.collection.findUniqueOrThrow({ where: { id: collectionId } });
    const result = await commitOfferGeneration(
      userId,
      collectionId,
      { ...input, postTitle: "Germany 1960" },
      preview.fingerprint
    );
    assert.equal(result.createdOffers, 3);
    assert.equal(result.posts.length, 1, "one post was made");
    const [made] = result.posts;
    const post = await prisma.facebookPost.findUniqueOrThrow({
      where: { id: made.postId },
      select: { postNo: true, title: true, groupId: true },
    });
    assert.deepEqual(post, { postNo: made.postNo, title: "Germany 1960", groupId });
    assert.equal(post.postNo, nextFacebookPostNo, "no post of one was made for them on the way (#2116)");

    // Lot N is the preview's Nth line.
    const order = preview.lines.map((line) => line.sets[0][0].id);
    for (const [index, itemId] of order.entries()) {
      const offer = await offerOf(itemId);
      assert.equal(offer.facebookPostId, made.postId);
      assert.equal(offer.facebookLotNo, index + 1, `lot ${index + 1}`);
      assert.equal(offer.endsAt?.toISOString(), endsAt, "the auctions share one closing time");
    }
  });

  it("leaves an existing offer that only receives sets where it is", async () => {
    const shared = (
      await prisma.stamp.create({
        data: {
          collectionId,
          name: `Stamp shared ${ts}`,
          issuedYear: 1960,
          stampAreaLinks: { create: [{ collectionAreaId: areaId, isPrimary: true }] },
        },
      })
    ).id;
    const existing = await createOffer(
      userId,
      collectionId,
      {
        platformId: facebookId,
        url: null,
        price: "0.00",
        currency: "",
        listingDate: null,
        facebookGroupId: groupId,
      },
      { seedItemIds: [await copy(shared)] }
    );
    const receiving = await copy(shared);
    const fresh = [await copy(), await copy()];
    const input = singles([receiving, ...fresh]);
    const preview = await previewOfferGeneration(userId, collectionId, input);
    assert.ok(
      preview.lines.some((line) => line.target.kind === "existing" && line.target.offerId === existing),
      "the shared stamp goes to the existing offer"
    );
    const result = await commitOfferGeneration(
      userId,
      collectionId,
      { ...input, postTitle: "Mixed pass" },
      preview.fingerprint
    );
    assert.equal(result.createdOffers, 2);
    assert.equal(result.changedOffers, 1);
    const lots = await prisma.offer.findMany({ where: { facebookPostId: result.posts[0].postId }, select: { id: true } });
    assert.equal(lots.length, 2);
    assert.ok(!lots.some((lot) => lot.id === existing));
    const kept = await prisma.offer.findUniqueOrThrow({
      where: { id: existing },
      select: { facebookPostId: true, facebookPost: { select: { _count: { select: { lots: true } } } } },
    });
    assert.notEqual(kept.facebookPostId, result.posts[0].postId, "the offer that only received a set stays where it was");
    assert.equal(kept.facebookPost?._count.lots, 1, "in its post of one");
  });

  it("writes nothing when the post would be refused", async () => {
    const posts = await prisma.facebookPost.count({ where: { collectionId } });

    const pair = [await copy(), await copy()];
    const input = singles(pair);
    const preview = await previewOfferGeneration(userId, collectionId, input);
    await assert.rejects(
      commitOfferGeneration(userId, collectionId, { ...input, postTitle: "  " }, preview.fingerprint),
      /needs a title/
    );
    await assert.rejects(
      commitOfferGeneration(
        userId,
        collectionId,
        { ...input, postTitle: "One lot", skip: [preview.lines[0].id] },
        preview.fingerprint
      ),
      /at least two new offers/
    );

    // Off Facebook there is no post to make.
    const elsewhere = [await copy(), await copy()];
    const colnect = singles(elsewhere, { platformId: colnectId, facebook: { facebookGroupId: null, endsAt: null } });
    const colnectPreview = await previewOfferGeneration(userId, collectionId, colnect);
    await assert.rejects(
      commitOfferGeneration(userId, collectionId, { ...colnect, postTitle: "Colnect" }, colnectPreview.fingerprint),
      /Only Facebook offers/
    );

    for (const itemId of [...pair, ...elsewhere]) {
      assert.equal(await prisma.offer.count({ where: { sets: { some: { items: { some: { itemId } } } } } }), 0);
    }
    assert.equal(await prisma.facebookPost.count({ where: { collectionId } }), posts);
  });

  it("splits the new offers into posts by the limit on lots — filled to it, or evenly (#2480)", async () => {
    const generate = async (split: "fill" | "even" | undefined) => {
      const copies: string[] = [];
      for (let i = 0; i < 7; i++) copies.push(await copy());
      const input = singles(copies);
      const preview = await previewOfferGeneration(userId, collectionId, input);
      assert.equal(preview.lines.length, 7);
      const result = await commitOfferGeneration(
        userId,
        collectionId,
        { ...input, postTitle: "Germany 1960", maxLotsPerPost: 3, ...(split ? { postSplit: split } : {}) },
        preview.fingerprint
      );
      assert.equal(result.createdOffers, 7);
      const posts: { title: string | null; lotNos: (number | null)[] }[] = [];
      for (const made of result.posts) {
        const post = await prisma.facebookPost.findUniqueOrThrow({
          where: { id: made.postId },
          select: { title: true, titleFollowsOffer: true, lots: { select: { id: true, facebookLotNo: true }, orderBy: { facebookLotNo: "asc" } } },
        });
        assert.equal(post.titleFollowsOffer, false, "titled as the pass named it");
        posts.push({ title: post.title, lotNos: post.lots.map((lot) => lot.facebookLotNo) });
      }
      // The lots run through the posts in the preview's order.
      const order = preview.lines.map((line) => line.sets[0][0].id);
      const postOrder = await Promise.all(order.map(async (itemId) => (await offerOf(itemId)).facebookPostId));
      assert.deepEqual(
        postOrder,
        result.posts.flatMap((made, index) => Array(posts[index].lotNos.length).fill(made.postId))
      );
      return posts;
    };

    // Filled to the limit — the default — the last post takes the rest, here a single lot.
    assert.deepEqual(await generate(undefined), [
      { title: "Germany 1960 (1/3)", lotNos: [1, 2, 3] },
      { title: "Germany 1960 (2/3)", lotNos: [1, 2, 3] },
      { title: "Germany 1960 (3/3)", lotNos: [1] },
    ]);
    assert.deepEqual(await generate("even"), [
      { title: "Germany 1960 (1/3)", lotNos: [1, 2, 3] },
      { title: "Germany 1960 (2/3)", lotNos: [1, 2] },
      { title: "Germany 1960 (3/3)", lotNos: [1, 2] },
    ]);
  });

  it("makes one post, titled as typed, when the pass fits under the limit (#2480)", async () => {
    const pair = [await copy(), await copy()];
    const input = singles(pair);
    const preview = await previewOfferGeneration(userId, collectionId, input);
    const result = await commitOfferGeneration(
      userId,
      collectionId,
      { ...input, postTitle: "Fits", maxLotsPerPost: 40, postSplit: "even" },
      preview.fingerprint
    );
    assert.equal(result.posts.length, 1);
    const post = await prisma.facebookPost.findUniqueOrThrow({ where: { id: result.posts[0].postId }, select: { title: true } });
    assert.equal(post.title, "Fits");
  });

  it("refuses a limit that is not a whole number from 1, writing nothing (#2480)", async () => {
    const pair = [await copy(), await copy()];
    const input = singles(pair);
    const preview = await previewOfferGeneration(userId, collectionId, input);
    await assert.rejects(
      commitOfferGeneration(userId, collectionId, { ...input, postTitle: "Bad", maxLotsPerPost: 0 }, preview.fingerprint),
      /whole number from 1/
    );
    for (const itemId of pair) {
      assert.equal(await prisma.offer.count({ where: { sets: { some: { items: { some: { itemId } } } } } }), 0);
    }
  });

  it("makes no post without the option", async () => {
    const pair = [await copy(), await copy()];
    const input = singles(pair);
    const preview = await previewOfferGeneration(userId, collectionId, input);
    const result = await commitOfferGeneration(userId, collectionId, input, preview.fingerprint);
    assert.equal(result.createdOffers, 2);
    assert.deepEqual(result.posts, []);
    const posts = await Promise.all(pair.map(async (itemId) => (await offerOf(itemId)).facebookPostId));
    assert.ok(posts.every((p) => p !== null), "each new offer is a post of its own (#2116)");
    assert.notEqual(posts[0], posts[1]);
  });
});
