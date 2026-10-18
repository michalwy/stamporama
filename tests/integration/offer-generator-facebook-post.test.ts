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
      state: "preparing",
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
    const result = await commitOfferGeneration(
      userId,
      collectionId,
      { ...input, postTitle: "Germany 1960" },
      preview.fingerprint
    );
    assert.equal(result.createdOffers, 3);
    assert.ok(result.post, "a post was made");
    const post = await prisma.facebookPost.findUniqueOrThrow({
      where: { id: result.post.postId },
      select: { postNo: true, title: true, groupId: true },
    });
    assert.deepEqual(post, { postNo: result.post.postNo, title: "Germany 1960", groupId });

    // Lot N is the preview's Nth line.
    const order = preview.lines.map((line) => line.sets[0][0].id);
    for (const [index, itemId] of order.entries()) {
      const offer = await offerOf(itemId);
      assert.equal(offer.facebookPostId, result.post.postId);
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
        state: "preparing",
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
    const lots = await prisma.offer.findMany({ where: { facebookPostId: result.post!.postId }, select: { id: true } });
    assert.equal(lots.length, 2);
    assert.ok(!lots.some((lot) => lot.id === existing));
    const kept = await prisma.offer.findUniqueOrThrow({ where: { id: existing }, select: { facebookPostId: true } });
    assert.equal(kept.facebookPostId, null, "the offer that only received a set is in no post");
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

  it("makes no post without the option", async () => {
    const pair = [await copy(), await copy()];
    const input = singles(pair);
    const preview = await previewOfferGeneration(userId, collectionId, input);
    const result = await commitOfferGeneration(userId, collectionId, input, preview.fingerprint);
    assert.equal(result.createdOffers, 2);
    assert.equal(result.post, null);
    for (const itemId of pair) assert.equal((await offerOf(itemId)).facebookPostId, null);
  });
});
